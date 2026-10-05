import { describe, it, expect } from 'vitest'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const { buildReadinessOverview, getEmberReadinessOverview } = await import('./readiness-overview')

function result(overrides: Record<string, unknown>) {
  return {
    eval_run_id: 'run-new',
    status: 'completed',
    retrieval_hit: true,
    retrieval_recall: 1,
    retrieval_mrr: 1,
    generation_score: null,
    grounding_score: null,
    outcome_score: 0.8,
    latency_ms: 100,
    input_tokens: 10,
    output_tokens: 10,
    estimated_cost: null,
    human_reviewed_at: null,
    ...overrides,
  } as Parameters<typeof buildReadinessOverview>[0]['results'][number]
}

describe('buildReadinessOverview', () => {
  it('summarizes each dataset against its latest completed run', () => {
    const overview = buildReadinessOverview({
      datasets: [
        { id: 'ds-ng911', name: 'Cebu NG911', status: 'active', version: 2, project_id: 'p-ng911' },
        { id: 'ds-global', name: 'Wiki Benchmark', status: 'draft', version: 1, project_id: null },
      ],
      projects: [{ id: 'p-ng911', name: 'cebu-ng911' }],
      cases: [{ dataset_id: 'ds-ng911' }, { dataset_id: 'ds-ng911' }, { dataset_id: 'ds-global' }],
      // Newest first: run-new is the latest completed run; run-running is
      // newer but not completed, so it is ignored.
      runs: [
        { id: 'run-running', dataset_id: 'ds-ng911', name: null, status: 'running', is_baseline: false, completed_at: null },
        { id: 'run-new', dataset_id: 'ds-ng911', name: 'gpt', status: 'completed', is_baseline: false, completed_at: '2026-10-05T00:00:00Z' },
        { id: 'run-old', dataset_id: 'ds-ng911', name: 'base', status: 'completed', is_baseline: true, completed_at: '2026-10-01T00:00:00Z' },
        { id: 'run-failed', dataset_id: 'ds-global', name: null, status: 'failed', is_baseline: false, completed_at: null },
      ],
      results: [
        result({ retrieval_hit: true, human_reviewed_at: '2026-10-05T01:00:00Z' }),
        result({ retrieval_hit: false, outcome_score: 0.4 }),
        result({ eval_run_id: 'run-old', human_reviewed_at: '2026-10-02T00:00:00Z' }),
      ],
      // Newest first: the first row per Project is its current judgement.
      judgements: [
        { project_id: 'p-ng911', confidence_percent: 70, verdict: 'needs_more_sources', review_due_at: '2026-12-30T00:00:00Z' },
        { project_id: 'p-ng911', confidence_percent: 40, verdict: 'needs_more_sources', review_due_at: '2026-11-30T00:00:00Z' },
      ],
    })

    expect(overview.failedRunCount).toBe(1)
    expect(overview.runsNeedingReview).toBe(1)

    const ng911 = overview.datasets.find((d) => d.datasetId === 'ds-ng911')!
    expect(ng911).toMatchObject({ projectName: 'cebu-ng911', caseCount: 2 })
    expect(ng911.latestRun).toMatchObject({ id: 'run-new', caseCount: 2, hitAtK: 0.5, unreviewedCount: 1, isBaseline: false })
    expect(ng911.latestRun!.avgOutcomeScore).toBeCloseTo(0.6)

    const global = overview.datasets.find((d) => d.datasetId === 'ds-global')!
    expect(ng911.curatorJudgement).toEqual({ confidencePercent: 70, verdict: 'needs_more_sources', reviewDueAt: '2026-12-30T00:00:00Z' })
    expect(global).toMatchObject({ projectId: null, projectName: null, caseCount: 1, latestRun: null, curatorJudgement: null })
  })
})

describe('getEmberReadinessOverview', () => {
  it('refuses anyone but the platform admin', async () => {
    const ctx = { profile: { role: 'curator' }, supabase: {} } as unknown as WorkbenchCallerContext
    await expect(getEmberReadinessOverview(ctx)).rejects.toThrow('Only the platform admin')
  })
})
