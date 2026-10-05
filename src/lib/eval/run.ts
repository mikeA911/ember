import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, EvalCase, EvalRunConfig, FailureClassification, GraphVersionDefinition } from '@/types/database'
import type { AIProvider } from '@/lib/ai/provider'
import { AIProviderError } from '@/lib/ai/provider'
import { getProviderByName, resolveModel, assertModelCapability } from '@/lib/ai'
import { retrieveEvidence } from './retrieval'
import { computeRetrievalMetrics } from './scoring'
import { generateAnswer } from './generation'
import { judgeAnswer } from './judge'
import { buildEvalError } from './failures'
import { buildRagRetryGraph } from '@/lib/graph/rag-retry-graph'
import type { RagGraphState } from '@/lib/graph/state'
import { MAX_GRAPH_ITERATIONS, GraphValidationError } from '@/lib/graph/errors'

// retrieve() -> generate() -> score(), run synchronously per case inside the
// Server Action that launched it -- same pattern as chunk enrichment in
// Milestone 1. No agent, no graph, no retry; that's Milestone 4. A case that
// throws anywhere in its pipeline still gets an eval_results row
// (status='failed', structured error) rather than silently vanishing from
// the run -- see the brief's explicit test for this.
export async function executeEvalRun(supabase: SupabaseClient<Database>, runId: string, requestedBy: string) {
  const { data: run, error: runError } = await supabase.from('eval_runs').select('*').eq('id', runId).single()
  if (runError || !run) throw runError ?? new Error('Run not found')

  const config = run.config as EvalRunConfig

  // Validated once, before any API call is made -- not scattered
  // provider-name checks throughout the pipeline (see assertModelCapability).
  const { model: generationModelRow } = await resolveModel(supabase, config.generation.provider, config.generation.model)
  assertModelCapability(generationModelRow, 'generation')
  const { model: embeddingModelRow } = await resolveModel(supabase, config.embedding.provider, config.embedding.model)
  assertModelCapability(embeddingModelRow, 'embedding')
  let evaluatorModelRow = null
  if (config.evaluator.type === 'llm_judge' && config.evaluator.provider && config.evaluator.model) {
    const { model } = await resolveModel(supabase, config.evaluator.provider, config.evaluator.model)
    assertModelCapability(model, 'generation')
    assertModelCapability(model, 'structured_output')
    evaluatorModelRow = model
  }

  // Stage 3: fetched unconditionally now (previously graph-mode only) so a
  // project-scoped dataset's single-pass runs also tag retrieved evidence
  // layer:'project'|'platform' -- see RetrievalConfig.projectId.
  const { data: dataset } = await supabase.from('eval_datasets').select('project_id').eq('id', run.dataset_id).single()
  const datasetProjectId: string | null = dataset?.project_id ?? null

  await supabase.from('eval_runs').update({ status: 'running', started_at: new Date().toISOString() }).eq('id', runId)

  try {
    const { data: cases, error: casesError } = await supabase
      .from('eval_cases')
      .select('*')
      .eq('dataset_id', run.dataset_id)
      .order('created_at', { ascending: true })
    if (casesError) throw casesError

    const generationProvider = await getProviderByName(supabase, config.generation.provider, { task: 'eval_run', evalRunId: runId, requestedBy })
    const embeddingProvider =
      config.embedding.provider === config.generation.provider
        ? generationProvider
        : await getProviderByName(supabase, config.embedding.provider, { task: 'eval_run', evalRunId: runId, requestedBy })

    for (const evalCase of cases ?? []) {
      await runCase(supabase, runId, evalCase, config, {
        generationProvider,
        generationModel: config.generation.model,
        embeddingProvider,
        embeddingModel: config.embedding.model,
        evaluatorModelId: evaluatorModelRow ? config.evaluator.model! : null,
        requestedBy,
        projectId: datasetProjectId,
      })
    }

    await supabase.from('eval_runs').update({ status: 'completed', completed_at: new Date().toISOString() }).eq('id', runId)
  } catch (err) {
    await supabase
      .from('eval_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: err instanceof Error ? err.message : String(err),
      })
      .eq('id', runId)
    throw err
  }
}

interface RunCaseModels {
  generationProvider: AIProvider
  generationModel: string
  embeddingProvider: AIProvider
  embeddingModel: string
  evaluatorModelId: string | null
  requestedBy: string
  projectId: string | null
}

async function runCase(
  supabase: SupabaseClient<Database>,
  runId: string,
  evalCase: EvalCase,
  config: EvalRunConfig,
  models: RunCaseModels
) {
  if (config.execution?.mode === 'graph') {
    await runCaseViaGraph(supabase, runId, evalCase, config, models)
    return
  }

  const startedAt = Date.now()

  try {
    const retrieval = await retrieveEvidence(supabase, models.embeddingProvider, models.embeddingModel, evalCase.question, {
      evidenceSource: config.retrieval.evidence_source,
      topK: config.retrieval.top_k,
      threshold: config.retrieval.threshold,
      projectId: models.projectId ?? undefined,
    })

    const metrics = computeRetrievalMetrics(retrieval.evidence, evalCase.expected_article_ids ?? [], evalCase.expected_chunk_ids ?? [])

    const generation = await generateAnswer(models.generationProvider, models.generationModel, evalCase.question, retrieval.evidence)

    let judge: Awaited<ReturnType<typeof judgeAnswer>> | null = null
    if (models.evaluatorModelId && config.evaluator.provider) {
      const evalProviderWithContext = await getProviderByName(supabase, config.evaluator.provider, {
        task: 'eval_run',
        evalRunId: runId,
        evalCaseId: evalCase.id,
        requestedBy: models.requestedBy,
      })
      judge = await judgeAnswer(evalProviderWithContext, models.evaluatorModelId, evalCase, retrieval.evidence, generation.answer)
    }

    const failureClassification: FailureClassification | null =
      metrics.hit === false ? 'retrieval_failure' : judge && judge.outcomeScore < 0.5 ? 'unknown' : null

    const { error: insertError } = await supabase.from('eval_results').insert({
      eval_run_id: runId,
      eval_case_id: evalCase.id,
      status: 'completed',
      error: null,
      generated_answer: generation.answer,
      retrieved_evidence: retrieval.evidence,
      retrieval_hit: metrics.hit,
      retrieval_recall: metrics.recall,
      retrieval_mrr: metrics.mrr,
      generation_score: judge?.generationScore ?? null,
      grounding_score: judge?.groundingScore ?? null,
      outcome_score: judge?.outcomeScore ?? null,
      overall_score: judge ? (judge.generationScore + judge.groundingScore + judge.outcomeScore) / 3 : null,
      latency_ms: Date.now() - startedAt,
      input_tokens: generation.inputTokens,
      output_tokens: generation.outputTokens,
      estimated_cost: null,
      evaluator_details: judge?.details ?? null,
      failure_classification: failureClassification,
      human_reviewed_by: null,
      human_reviewed_at: null,
      human_accepted: null,
      human_generation_score: null,
      human_grounding_score: null,
      human_outcome_score: null,
      human_failure_classification: null,
      human_notes: null,
      graph_run_id: null,
      iteration_count: null,
    })
    if (insertError) throw insertError
  } catch (err) {
    await supabase.from('eval_results').insert({
      eval_run_id: runId,
      eval_case_id: evalCase.id,
      status: 'failed',
      error: buildEvalError('pipeline', err),
      generated_answer: null,
      retrieved_evidence: null,
      retrieval_hit: null,
      retrieval_recall: null,
      retrieval_mrr: null,
      generation_score: null,
      grounding_score: null,
      outcome_score: null,
      overall_score: null,
      latency_ms: Date.now() - startedAt,
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      evaluator_details: null,
      failure_classification: null,
      human_reviewed_by: null,
      human_reviewed_at: null,
      human_accepted: null,
      human_generation_score: null,
      human_grounding_score: null,
      human_outcome_score: null,
      human_failure_classification: null,
      human_notes: null,
      graph_run_id: null,
      iteration_count: null,
    })
  }
}

// Graph-mode execution: wraps the RAG Retry graph (src/lib/graph/) around
// the same case, creating a graph_runs row for the trace and mapping the
// FINAL state into the exact same eval_results shape the single-pass path
// writes -- the results table, scoring, and comparison UI need no changes
// to understand a graph-mode result. latency/tokens are summed across every
// iteration; retrieval_hit/scores are from the last iteration (the one that
// actually determined the outcome).
//
// Providers are resolved once per case here (not once per node invocation)
// -- ai_operation_logs.graph_run_id is populated correctly, but
// graph_steps.ai_operation_log_id linkage to a *specific* node's AI call is
// intentionally not wired for M4 (the column exists for a future milestone
// to populate precisely; the trace's core value -- which nodes ran, their
// input/output/latency/status/iteration -- doesn't depend on it).
async function runCaseViaGraph(
  supabase: SupabaseClient<Database>,
  runId: string,
  evalCase: EvalCase,
  config: EvalRunConfig,
  models: RunCaseModels
) {
  const startedAt = Date.now()
  const execution = config.execution!

  if (!execution.graphId || !execution.graphVersionId) {
    throw new GraphValidationError('Graph execution mode requires graphId and graphVersionId')
  }

  const { data: graphVersion, error: graphVersionError } = await supabase
    .from('graph_versions')
    .select('*')
    .eq('id', execution.graphVersionId)
    .single()
  if (graphVersionError || !graphVersion) throw graphVersionError ?? new GraphValidationError('Graph version not found')

  const definition = graphVersion.definition as GraphVersionDefinition
  const maxIterations = Math.min(execution.maxIterations ?? definition.maxIterations, MAX_GRAPH_ITERATIONS)
  const acceptanceThresholds = execution.acceptanceThresholds ?? definition.acceptanceThresholds

  const expectedArticleIds = evalCase.expected_article_ids ?? []
  const expectedChunkIds = evalCase.expected_chunk_ids ?? []

  const { data: graphRun, error: graphRunError } = await supabase
    .from('graph_runs')
    .insert({
      graph_id: execution.graphId,
      graph_version_id: execution.graphVersionId,
      project_id: models.projectId,
      eval_run_id: runId,
      eval_case_id: evalCase.id,
      // Milestone 5B -- set when this run is "an Agent's evaluation suite"
      // (the Agent detail page's "Run evaluation suite" control), null for
      // a bare graph-mode run with no Agent involved. Both optional and
      // both-or-neither on EvalRunExecutionConfig -- absent here reproduces
      // every pre-M5B run's exact behavior.
      agent_id: execution.agentId ?? null,
      agent_version_id: execution.agentVersionId ?? null,
      status: 'running',
      initial_input: { question: evalCase.question },
      final_output: null,
      iteration_count: 0,
      started_at: new Date().toISOString(),
      completed_at: null,
      termination_reason: null,
      error_code: null,
      error_message: null,
      created_by: models.requestedBy,
    })
    .select()
    .single()
  if (graphRunError || !graphRun) throw graphRunError ?? new Error('Failed to create graph run')

  let judge: { provider: AIProvider; model: string; evalCase: Pick<EvalCase, 'question' | 'expected_answer' | 'expected_concepts' | 'scoring_criteria'> } | undefined
  if (models.evaluatorModelId && config.evaluator.provider) {
    const evalProviderWithContext = await getProviderByName(supabase, config.evaluator.provider, {
      task: 'eval_run',
      evalRunId: runId,
      evalCaseId: evalCase.id,
      graphRunId: graphRun.id,
      requestedBy: models.requestedBy,
    })
    judge = { provider: evalProviderWithContext, model: models.evaluatorModelId, evalCase }
  }

  const initialState: RagGraphState = {
    originalQuery: evalCase.question,
    currentQuery: evalCase.question,
    retrievedEvidence: [],
    generatedAnswer: null,
    evaluation: null,
    failureType: null,
    iteration: 0,
    maxIterations,
    terminationReason: null,
    traceContext: {
      graphRunId: graphRun.id,
      projectId: models.projectId ?? undefined,
      evalRunId: runId,
      evalCaseId: evalCase.id,
    },
  }

  try {
    const compiled = buildRagRetryGraph({
      supabase,
      graphRunId: graphRun.id,
      embeddingProvider: models.embeddingProvider,
      embeddingModel: models.embeddingModel,
      retrievalConfig: {
        evidenceSource: config.retrieval.evidence_source,
        topK: config.retrieval.top_k,
        threshold: config.retrieval.threshold,
        projectId: models.projectId ?? undefined,
      },
      generationProvider: models.generationProvider,
      generationModel: models.generationModel,
      judge,
      expectedArticleIds,
      expectedChunkIds,
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

    const ev = finalState.evaluation
    const failureClassification: FailureClassification | null =
      ev?.retrieval?.hit === false ? 'retrieval_failure' : ev && ev.outcome !== null && ev.outcome < 0.5 ? 'unknown' : null

    const { error: insertError } = await supabase.from('eval_results').insert({
      eval_run_id: runId,
      eval_case_id: evalCase.id,
      status: 'completed',
      error: null,
      generated_answer: finalState.generatedAnswer,
      retrieved_evidence: finalState.retrievedEvidence,
      retrieval_hit: ev?.retrieval?.hit ?? null,
      retrieval_recall: ev?.retrieval?.recall ?? null,
      retrieval_mrr: ev?.retrieval?.mrr ?? null,
      generation_score: ev?.generation ?? null,
      grounding_score: ev?.grounding ?? null,
      outcome_score: ev?.outcome ?? null,
      overall_score: ev && ev.generation !== null && ev.grounding !== null && ev.outcome !== null ? (ev.generation + ev.grounding + ev.outcome) / 3 : null,
      latency_ms: Date.now() - startedAt,
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      evaluator_details: ev?.details ?? null,
      failure_classification: failureClassification,
      human_reviewed_by: null,
      human_reviewed_at: null,
      human_accepted: null,
      human_generation_score: null,
      human_grounding_score: null,
      human_outcome_score: null,
      human_failure_classification: null,
      human_notes: null,
      graph_run_id: graphRun.id,
      iteration_count: finalState.iteration,
    })
    if (insertError) throw insertError
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

    await supabase.from('eval_results').insert({
      eval_run_id: runId,
      eval_case_id: evalCase.id,
      status: 'failed',
      error: buildEvalError('pipeline', err),
      generated_answer: null,
      retrieved_evidence: null,
      retrieval_hit: null,
      retrieval_recall: null,
      retrieval_mrr: null,
      generation_score: null,
      grounding_score: null,
      outcome_score: null,
      overall_score: null,
      latency_ms: Date.now() - startedAt,
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      evaluator_details: null,
      failure_classification: null,
      human_reviewed_by: null,
      human_reviewed_at: null,
      human_accepted: null,
      human_generation_score: null,
      human_grounding_score: null,
      human_outcome_score: null,
      human_failure_classification: null,
      human_notes: null,
      graph_run_id: graphRun.id,
      iteration_count: null,
    })
  }
}
