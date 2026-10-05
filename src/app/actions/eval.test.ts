import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const requireRoleMock = vi.fn()
const executeEvalRunMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', () => ({ requireRole: (...args: unknown[]) => requireRoleMock(...args) }))
vi.mock('@/lib/eval/run', () => ({ executeEvalRun: (...args: unknown[]) => executeEvalRunMock(...args) }))

const {
  createDatasetAction,
  createCaseAction,
  createAndRunEvalAction,
  markBaselineAction,
  submitHumanReviewAction,
} = await import('./eval')

beforeEach(() => {
  requireRoleMock.mockReset()
  executeEvalRunMock.mockReset()
})

describe('createDatasetAction', () => {
  it('creates a draft dataset at version 1', async () => {
    const supabase = createFakeSupabase({
      eval_datasets: [{ data: { id: 'dataset-1' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })

    const result = await createDatasetAction({ name: 'AI Engineering Wiki Benchmark', description: '', knowledgeBaseId: null })

    expect(result).toEqual({ datasetId: 'dataset-1' })
    const insert = supabase._calls.find((c) => c.table === 'eval_datasets' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ status: 'draft', version: 1, name: 'AI Engineering Wiki Benchmark' })
  })
})

describe('createCaseAction', () => {
  it('associates expected Wiki article ids with the case', async () => {
    const supabase = createFakeSupabase({ eval_cases: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })

    await createCaseAction('dataset-1', {
      question: 'When should RAG be used instead of fine-tuning?',
      expectedAnswer: '',
      expectedConcepts: [],
      expectedArticleIds: ['article-rag', 'article-cal'],
      expectedChunkIds: [],
      scoringCriteria: '',
      tags: [],
      difficulty: null,
    })

    const insert = supabase._calls.find((c) => c.table === 'eval_cases' && c.method === 'insert')
    expect(insert?.args).toMatchObject({
      dataset_id: 'dataset-1',
      expected_article_ids: ['article-rag', 'article-cal'],
    })
  })
})

describe('createAndRunEvalAction', () => {
  it('snapshots the full run configuration onto the eval_runs row', async () => {
    const config = {
      generation: { provider: 'gemini' as const, model: 'gemini-3.5-flash' },
      embedding: { provider: 'gemini' as const, model: 'gemini-embedding-001' },
      retrieval: { evidence_source: 'wiki' as const, top_k: 5 },
      evaluator: { type: 'llm_judge' as const, provider: 'openai' as const, model: 'gpt-4o-mini' },
    }
    const supabase = createFakeSupabase({
      eval_datasets: [{ data: { version: 3, status: 'draft' }, error: null }],
      eval_runs: [{ data: { id: 'run-1' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'admin' }, supabase })
    executeEvalRunMock.mockResolvedValue(undefined)

    const result = await createAndRunEvalAction({ datasetId: 'dataset-1', name: 'gemini + wiki', config })

    expect(result).toEqual({ runId: 'run-1' })
    const insert = supabase._calls.find((c) => c.table === 'eval_runs' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ dataset_version: 3, config })
    expect(executeEvalRunMock).toHaveBeenCalledWith(supabase, 'run-1', 'user-1')
  })

  it('requires the platform admin role to run an evaluation', async () => {
    const config = {
      generation: { provider: 'gemini' as const, model: 'gemini-3.5-flash' },
      embedding: { provider: 'gemini' as const, model: 'gemini-embedding-001' },
      retrieval: { evidence_source: 'wiki' as const, top_k: 5 },
      evaluator: { type: 'none' as const },
    }
    requireRoleMock.mockRejectedValue(new Error('Requires admin role'))

    await expect(createAndRunEvalAction({ datasetId: 'dataset-1', name: '', config })).rejects.toThrow('Requires admin role')
    expect(requireRoleMock).toHaveBeenCalledWith('admin')
    expect(executeEvalRunMock).not.toHaveBeenCalled()
  })

  it('lets an admin test-run a draft dataset before it is activated', async () => {
    const config = {
      generation: { provider: 'gemini' as const, model: 'gemini-3.5-flash' },
      embedding: { provider: 'gemini' as const, model: 'gemini-embedding-001' },
      retrieval: { evidence_source: 'wiki' as const, top_k: 5 },
      evaluator: { type: 'none' as const },
    }
    const supabase = createFakeSupabase({
      eval_datasets: [{ data: { version: 1, status: 'draft' }, error: null }],
      eval_runs: [{ data: { id: 'run-2' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'admin-1' }, profile: { role: 'admin' }, supabase })
    executeEvalRunMock.mockResolvedValue(undefined)

    const result = await createAndRunEvalAction({ datasetId: 'dataset-1', name: '', config })
    expect(result).toEqual({ runId: 'run-2' })
  })
})

describe('markBaselineAction', () => {
  it('requires the platform admin role', async () => {
    requireRoleMock.mockRejectedValue(new Error('Requires admin role'))
    await expect(markBaselineAction('run-1', 'dataset-1')).rejects.toThrow('Requires admin role')
    expect(requireRoleMock).toHaveBeenCalledWith('admin')
  })
})

describe('submitHumanReviewAction', () => {
  it('writes only the human_* columns, never touching the automated score columns', async () => {
    const supabase = createFakeSupabase({ eval_results: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'reviewer-1' }, supabase })

    await submitHumanReviewAction('result-1', 'run-1', {
      accepted: false,
      generationScore: 0.4,
      groundingScore: 0.3,
      outcomeScore: 0.2,
      failureClassification: 'retrieval_failure',
      notes: 'Chunking Strategies was expected but not retrieved.',
    })

    const update = supabase._calls.find((c) => c.table === 'eval_results' && c.method === 'update')
    const args = update?.args as Record<string, unknown>
    expect(args).toMatchObject({
      human_reviewed_by: 'reviewer-1',
      human_generation_score: 0.4,
      human_failure_classification: 'retrieval_failure',
    })
    expect(args).not.toHaveProperty('generation_score')
    expect(args).not.toHaveProperty('failure_classification')
    expect(requireRoleMock).toHaveBeenCalledWith('admin')
  })

  it('allows a human to correct the automated failure classification', async () => {
    const supabase = createFakeSupabase({ eval_results: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'reviewer-1' }, supabase })

    await submitHumanReviewAction('result-1', 'run-1', {
      accepted: false,
      generationScore: null,
      groundingScore: null,
      outcomeScore: null,
      failureClassification: 'reasoning_failure',
      notes: 'Evidence was fine, the model just reasoned about it incorrectly.',
    })

    const update = supabase._calls.find((c) => c.table === 'eval_results' && c.method === 'update')
    expect(update?.args).toMatchObject({ human_failure_classification: 'reasoning_failure' })
  })
})
