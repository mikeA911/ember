'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { executeEvalRun } from '@/lib/eval/run'
import type { EvalDifficulty, EvalRunConfig, FailureClassification } from '@/types/database'
import { EvalValidationError } from '@/lib/eval/errors'

export async function createDatasetAction(input: { name: string; description: string; knowledgeBaseId: string | null }) {
  const { user, supabase } = await requireRole('curator')

  const { data, error } = await supabase
    .from('eval_datasets')
    .insert({
      name: input.name,
      description: input.description || null,
      version: 1,
      status: 'draft',
      knowledge_base_id: input.knowledgeBaseId,
      created_by: user.id,
    })
    .select()
    .single()
  if (error) throw error

  revalidatePath('/evals')
  return { datasetId: data.id }
}

export async function activateDatasetAction(datasetId: string) {
  const { supabase } = await requireRole('curator')

  const { count } = await supabase.from('eval_cases').select('id', { count: 'exact', head: true }).eq('dataset_id', datasetId)
  if (!count) throw new EvalValidationError('Add at least one case before activating a dataset')

  const { error } = await supabase.from('eval_datasets').update({ status: 'active' }).eq('id', datasetId)
  if (error) throw error
  revalidatePath(`/evals/datasets/${datasetId}`)
}

export async function archiveDatasetAction(datasetId: string) {
  const { supabase } = await requireRole('curator')
  const { error } = await supabase.from('eval_datasets').update({ status: 'archived' }).eq('id', datasetId)
  if (error) throw error
  revalidatePath(`/evals/datasets/${datasetId}`)
}

export interface CaseInput {
  question: string
  expectedAnswer: string
  expectedConcepts: string[]
  expectedArticleIds: string[]
  expectedChunkIds: string[]
  scoringCriteria: string
  tags: string[]
  difficulty: EvalDifficulty | null
}

export async function createCaseAction(datasetId: string, input: CaseInput) {
  const { supabase } = await requireRole('curator')

  const { error } = await supabase.from('eval_cases').insert({
    dataset_id: datasetId,
    question: input.question,
    expected_answer: input.expectedAnswer || null,
    expected_concepts: input.expectedConcepts.length ? input.expectedConcepts : null,
    expected_article_ids: input.expectedArticleIds.length ? input.expectedArticleIds : null,
    expected_chunk_ids: input.expectedChunkIds.length ? input.expectedChunkIds : null,
    scoring_criteria: input.scoringCriteria || null,
    tags: input.tags.length ? input.tags : null,
    difficulty: input.difficulty,
  })
  if (error) throw error
  revalidatePath(`/evals/datasets/${datasetId}`)
}

export async function deleteCaseAction(caseId: string, datasetId: string) {
  const { supabase } = await requireRole('curator')
  const { error } = await supabase.from('eval_cases').delete().eq('id', caseId)
  if (error) throw error
  revalidatePath(`/evals/datasets/${datasetId}`)
}

export async function createAndRunEvalAction(input: {
  datasetId: string
  name: string
  config: EvalRunConfig
}) {
  // Platform-admin only (Ember Readiness, Stage 1 --
  // docs/dev-request-ember-readiness-and-knowledge-gaps.md). An admin may
  // test-run a draft dataset before it is activated. RLS enforces the
  // same boundary independently (20261012100001_eval_operations_admin_only.sql).
  const { user, supabase } = await requireRole('admin')

  const { data: dataset, error: datasetError } = await supabase
    .from('eval_datasets')
    .select('version, status')
    .eq('id', input.datasetId)
    .single()
  if (datasetError || !dataset) throw datasetError ?? new Error('Dataset not found')

  const { data: run, error: runError } = await supabase
    .from('eval_runs')
    .insert({
      dataset_id: input.datasetId,
      dataset_version: dataset.version,
      name: input.name || null,
      status: 'pending',
      config: input.config,
      is_baseline: false,
      started_at: null,
      completed_at: null,
      error_message: null,
      created_by: user.id,
    })
    .select()
    .single()
  if (runError || !run) throw runError ?? new Error('Failed to create run')

  // Synchronous, like chunk enrichment in Milestone 1 -- eval datasets are
  // small (10-15 cases) by design at this milestone. A background job queue
  // is future-milestone (Runs/Tracing) territory, not needed yet.
  await executeEvalRun(supabase, run.id, user.id)

  revalidatePath('/evals')
  revalidatePath(`/evals/runs/${run.id}`)
  return { runId: run.id }
}

export async function markBaselineAction(runId: string, datasetId: string) {
  const { supabase } = await requireRole('admin')

  await supabase.from('eval_runs').update({ is_baseline: false }).eq('dataset_id', datasetId).eq('is_baseline', true)
  const { error } = await supabase.from('eval_runs').update({ is_baseline: true }).eq('id', runId)
  if (error) throw error

  revalidatePath(`/evals/runs/${runId}`)
}

export interface HumanReviewInput {
  accepted: boolean
  generationScore: number | null
  groundingScore: number | null
  outcomeScore: number | null
  failureClassification: FailureClassification | null
  notes: string
}

// Never touches the automated score columns -- see the human_* columns'
// comment in the migration. This is the one place a human's judgment is
// recorded, alongside the automated evaluation, not instead of it.
export async function submitHumanReviewAction(resultId: string, runId: string, input: HumanReviewInput) {
  const { user, supabase } = await requireRole('admin')

  const { error } = await supabase
    .from('eval_results')
    .update({
      human_reviewed_by: user.id,
      human_reviewed_at: new Date().toISOString(),
      human_accepted: input.accepted,
      human_generation_score: input.generationScore,
      human_grounding_score: input.groundingScore,
      human_outcome_score: input.outcomeScore,
      human_failure_classification: input.failureClassification,
      human_notes: input.notes || null,
    })
    .eq('id', resultId)
  if (error) throw error

  revalidatePath(`/evals/runs/${runId}`)
}
