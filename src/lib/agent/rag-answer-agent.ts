import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, GraphVersionDefinition, GraphTerminationReason, RetrievedEvidenceItem } from '@/types/database'
import type { AIProvider } from '@/lib/ai/provider'
import { AIProviderError } from '@/lib/ai/provider'
import { getProviderByName, assertModelCapability } from '@/lib/ai'
import { buildRagRetryGraph } from '@/lib/graph/rag-retry-graph'
import type { RagGraphState, RagGraphEvaluation } from '@/lib/graph/state'
import { MAX_GRAPH_ITERATIONS } from '@/lib/graph/errors'
import { AgentValidationError } from './errors'

export const RAG_ANSWER_AGENT_SLUG = 'rag-answer-agent'

export interface AnswerQuestionInput {
  // Absent = the Agent's current active_version_id -- so asking a question
  // always exercises whatever version is live, same convention as running
  // an eval against "the active graph version" elsewhere in this codebase.
  agentVersionId?: string
  question: string
  requestedBy: string
  projectId?: string | null
}

export interface AnswerQuestionResult {
  answer: string | null
  evidence: RetrievedEvidenceItem[]
  evaluation: RagGraphEvaluation | null
  graphRunId: string
  terminationReason: GraphTerminationReason | null
}

// Live ad hoc question -> a single RAG Retry graph invocation, packaged as
// the RAG Answer Agent. Deliberately does NOT insert an eval_results row --
// that table grades a case against a stored eval_dataset; a live question
// isn't one, and reusing it would corrupt every benchmark comparison view.
// The graph_runs row (agent_id/agent_version_id set, eval_run_id/
// eval_case_id null) is the only execution record this produces.
export async function answerQuestion(supabase: SupabaseClient<Database>, input: AnswerQuestionInput): Promise<AnswerQuestionResult> {
  let agentId: string | undefined
  let agentVersionId = input.agentVersionId

  if (!agentVersionId) {
    const { data: agent, error } = await supabase
      .from('agents')
      .select('id, active_version_id')
      .eq('slug', RAG_ANSWER_AGENT_SLUG)
      .single()
    if (error || !agent || !agent.active_version_id) throw error ?? new AgentValidationError('RAG Answer Agent has no active version')
    agentId = agent.id
    agentVersionId = agent.active_version_id
  }

  // agentId is only unset here when the caller supplied agentVersionId
  // directly -- version.agent_id (below) covers that case in the same
  // query that already fetches the rest of the version row, rather than a
  // second agent_versions round trip just for the id.
  const { data: version, error: versionError } = await supabase.from('agent_versions').select('*').eq('id', agentVersionId).single()
  if (versionError || !version) throw versionError ?? new AgentValidationError('Agent version not found')
  agentId = agentId ?? version.agent_id

  const { data: graphVersion, error: graphVersionError } = await supabase
    .from('graph_versions')
    .select('*')
    .eq('id', version.graph_version_id)
    .single()
  if (graphVersionError || !graphVersion) throw graphVersionError ?? new AgentValidationError('Graph version not found')

  const definition = graphVersion.definition as GraphVersionDefinition
  const maxIterations = Math.min(version.termination_policy.maxIterations ?? definition.maxIterations, MAX_GRAPH_ITERATIONS)
  const acceptanceThresholds = definition.acceptanceThresholds
  const sourcePolicy = version.source_policy

  // Validated once, before any API call -- same convention as
  // executeEvalRun (src/lib/eval/run.ts).
  const [{ data: generationModelRow }, { data: embeddingModelRow }] = await Promise.all([
    supabase.from('ai_models').select('*').eq('id', version.generation_model_id).single(),
    supabase.from('ai_models').select('*').eq('id', version.embedding_model_id).single(),
  ])
  if (!generationModelRow || !embeddingModelRow) throw new AgentValidationError('Agent version references a missing model')
  assertModelCapability(generationModelRow, 'generation')
  assertModelCapability(embeddingModelRow, 'embedding')

  const [{ data: generationProviderRow }, { data: embeddingProviderRow }] = await Promise.all([
    supabase.from('ai_providers').select('name').eq('id', version.generation_provider_id).single(),
    supabase.from('ai_providers').select('name').eq('id', version.embedding_provider_id).single(),
  ])
  if (!generationProviderRow || !embeddingProviderRow) throw new AgentValidationError('Agent version references a missing provider')

  const { data: graphRun, error: graphRunError } = await supabase
    .from('graph_runs')
    .insert({
      graph_id: graphVersion.graph_id,
      graph_version_id: graphVersion.id,
      project_id: input.projectId ?? null,
      eval_run_id: null,
      eval_case_id: null,
      agent_id: agentId,
      agent_version_id: agentVersionId,
      status: 'running',
      initial_input: { question: input.question },
      final_output: null,
      iteration_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      termination_reason: null,
      error_code: null,
      error_message: null,
      created_by: input.requestedBy,
    })
    .select()
    .single()
  if (graphRunError || !graphRun) throw graphRunError ?? new Error('Failed to create graph run')

  const generationProvider = await getProviderByName(supabase, generationProviderRow.name, {
    task: 'agent_run',
    graphRunId: graphRun.id,
    requestedBy: input.requestedBy,
  })
  const embeddingProvider =
    embeddingProviderRow.name === generationProviderRow.name
      ? generationProvider
      : await getProviderByName(supabase, embeddingProviderRow.name, { task: 'agent_run', graphRunId: graphRun.id, requestedBy: input.requestedBy })

  let judge: { provider: AIProvider; model: string; evalCase: { question: string; expected_answer: null; expected_concepts: null; scoring_criteria: null } } | undefined
  if (version.evaluator_provider_id && version.evaluator_model_id) {
    const [{ data: evaluatorModelRow }, { data: evaluatorProviderRow }] = await Promise.all([
      supabase.from('ai_models').select('*').eq('id', version.evaluator_model_id).single(),
      supabase.from('ai_providers').select('name').eq('id', version.evaluator_provider_id).single(),
    ])
    if (evaluatorModelRow && evaluatorProviderRow) {
      assertModelCapability(evaluatorModelRow, 'generation')
      assertModelCapability(evaluatorModelRow, 'structured_output')
      const evaluatorProvider =
        evaluatorProviderRow.name === generationProviderRow.name
          ? generationProvider
          : await getProviderByName(supabase, evaluatorProviderRow.name, { task: 'agent_run', graphRunId: graphRun.id, requestedBy: input.requestedBy })
      judge = {
        provider: evaluatorProvider,
        model: evaluatorModelRow.model_id,
        evalCase: { question: input.question, expected_answer: null, expected_concepts: null, scoring_criteria: null },
      }
    }
  }

  const initialState: RagGraphState = {
    originalQuery: input.question,
    currentQuery: input.question,
    retrievedEvidence: [],
    generatedAnswer: null,
    evaluation: null,
    failureType: null,
    iteration: 0,
    maxIterations,
    terminationReason: null,
    traceContext: { graphRunId: graphRun.id, projectId: input.projectId ?? undefined },
  }

  try {
    const compiled = buildRagRetryGraph({
      supabase,
      graphRunId: graphRun.id,
      embeddingProvider,
      embeddingModel: embeddingModelRow.model_id,
      retrievalConfig: {
        evidenceSource: sourcePolicy.evidenceSource,
        topK: sourcePolicy.topK,
        threshold: sourcePolicy.threshold,
      },
      generationProvider,
      generationModel: generationModelRow.model_id,
      judge,
      // A live ad hoc question has no golden evidence to check retrieval
      // against -- same "no expected evidence" tolerance an eval case with
      // empty expected_article_ids/expected_chunk_ids already exercises.
      expectedArticleIds: [],
      expectedChunkIds: [],
      acceptanceThresholds,
    })

    const finalState = (await compiled.invoke(initialState)) as RagGraphState

    await supabase
      .from('graph_runs')
      .update({
        status: 'completed',
        final_output: { generatedAnswer: finalState.generatedAnswer, evaluation: finalState.evaluation },
        iteration_count: finalState.iteration,
        termination_reason: finalState.terminationReason,
        completed_at: new Date().toISOString(),
      })
      .eq('id', graphRun.id)

    return {
      answer: finalState.generatedAnswer,
      evidence: finalState.retrievedEvidence,
      evaluation: finalState.evaluation,
      graphRunId: graphRun.id,
      terminationReason: finalState.terminationReason,
    }
  } catch (err) {
    const errorCode = err instanceof AIProviderError ? err.errorCode : 'unknown'
    const errorMessage = err instanceof Error ? err.message : String(err)
    await supabase
      .from('graph_runs')
      .update({
        status: 'failed',
        termination_reason: 'provider_error',
        error_code: errorCode,
        error_message: errorMessage,
        completed_at: new Date().toISOString(),
      })
      .eq('id', graphRun.id)
    throw err
  }
}
