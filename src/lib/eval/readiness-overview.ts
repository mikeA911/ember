import 'server-only'
import { AuthError } from '@/lib/auth'
import { summarizeResults } from './scoring'
import type { EmberReadinessVerdict, EvalDatasetStatus, EvalResult } from '@/types/database'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

// Admin -> Ember readiness (Ember Readiness, Stage 1 --
// docs/dev-request-ember-readiness-and-knowledge-gaps.md). One row per eval
// dataset, with the latest completed run's headline metrics, so a platform
// admin can see which Projects Ember has been checked against and which
// need a run or a review. Running and drilling in still happens on the
// existing /evals pages.

type ResultRow = Pick<
  EvalResult,
  | 'eval_run_id'
  | 'status'
  | 'retrieval_hit'
  | 'retrieval_recall'
  | 'retrieval_mrr'
  | 'generation_score'
  | 'grounding_score'
  | 'outcome_score'
  | 'latency_ms'
  | 'input_tokens'
  | 'output_tokens'
  | 'estimated_cost'
  | 'human_reviewed_at'
>

export interface ReadinessRunSummary {
  id: string
  name: string | null
  completedAt: string | null
  isBaseline: boolean
  caseCount: number
  failedCount: number
  hitAtK: number | null
  avgOutcomeScore: number | null
  unreviewedCount: number
}

export interface ReadinessDatasetRow {
  datasetId: string
  name: string
  status: EvalDatasetStatus
  version: number
  projectId: string | null
  projectName: string | null
  caseCount: number
  latestRun: ReadinessRunSummary | null
  // The Project's current curator judgement (Stage 2), when there is one.
  curatorJudgement: { confidencePercent: number; verdict: EmberReadinessVerdict; reviewDueAt: string } | null
}

export interface EmberReadinessOverview {
  datasets: ReadinessDatasetRow[]
  failedRunCount: number
  runsNeedingReview: number
}

export interface ReadinessOverviewInput {
  datasets: { id: string; name: string; status: EvalDatasetStatus; version: number; project_id: string | null }[]
  projects: { id: string; name: string }[]
  cases: { dataset_id: string }[]
  runs: { id: string; dataset_id: string; name: string | null; status: string; is_baseline: boolean; completed_at: string | null }[]
  results: ResultRow[]
  // project_ember_readiness rows, newest first.
  judgements?: { project_id: string; confidence_percent: number; verdict: EmberReadinessVerdict; review_due_at: string }[]
}

// Pure, so the roll-up is unit-testable without a database. runs must be
// newest first (the first completed run per dataset is its latest).
export function buildReadinessOverview({ datasets, projects, cases, runs, results, judgements = [] }: ReadinessOverviewInput): EmberReadinessOverview {
  const projectNameById = new Map(projects.map((p) => [p.id, p.name]))
  const judgementByProject = new Map<string, (typeof judgements)[number]>()
  for (const j of judgements) if (!judgementByProject.has(j.project_id)) judgementByProject.set(j.project_id, j)

  const caseCountByDataset = new Map<string, number>()
  for (const c of cases) caseCountByDataset.set(c.dataset_id, (caseCountByDataset.get(c.dataset_id) ?? 0) + 1)

  const resultsByRun = new Map<string, ResultRow[]>()
  for (const r of results) {
    const list = resultsByRun.get(r.eval_run_id) ?? []
    list.push(r)
    resultsByRun.set(r.eval_run_id, list)
  }

  const latestRunByDataset = new Map<string, (typeof runs)[number]>()
  for (const run of runs) {
    if (run.status === 'completed' && !latestRunByDataset.has(run.dataset_id)) latestRunByDataset.set(run.dataset_id, run)
  }

  const unreviewed = (runId: string) => (resultsByRun.get(runId) ?? []).filter((r) => r.human_reviewed_at === null).length

  const rows: ReadinessDatasetRow[] = datasets.map((d) => {
    const run = latestRunByDataset.get(d.id)
    let latestRun: ReadinessRunSummary | null = null
    if (run) {
      const summary = summarizeResults(resultsByRun.get(run.id) ?? [])
      latestRun = {
        id: run.id,
        name: run.name,
        completedAt: run.completed_at,
        isBaseline: run.is_baseline,
        caseCount: summary.caseCount,
        failedCount: summary.failedCount,
        hitAtK: summary.hitAtK,
        avgOutcomeScore: summary.avgOutcomeScore,
        unreviewedCount: unreviewed(run.id),
      }
    }
    const judgement = d.project_id ? judgementByProject.get(d.project_id) : undefined
    return {
      datasetId: d.id,
      name: d.name,
      status: d.status,
      version: d.version,
      projectId: d.project_id,
      projectName: d.project_id ? (projectNameById.get(d.project_id) ?? null) : null,
      caseCount: caseCountByDataset.get(d.id) ?? 0,
      latestRun,
      curatorJudgement: judgement
        ? { confidencePercent: judgement.confidence_percent, verdict: judgement.verdict, reviewDueAt: judgement.review_due_at }
        : null,
    }
  })

  const completedRunIds = runs.filter((r) => r.status === 'completed').map((r) => r.id)
  return {
    datasets: rows,
    failedRunCount: runs.filter((r) => r.status === 'failed').length,
    runsNeedingReview: completedRunIds.filter((id) => unreviewed(id) > 0).length,
  }
}

export async function getEmberReadinessOverview(ctx: WorkbenchCallerContext): Promise<EmberReadinessOverview> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can view Ember readiness')
  const { supabase } = ctx

  const [{ data: datasets, error: datasetsError }, { data: cases, error: casesError }, { data: runs, error: runsError }] =
    await Promise.all([
      supabase.from('eval_datasets').select('id, name, status, version, project_id').neq('status', 'archived').order('name'),
      supabase.from('eval_cases').select('dataset_id'),
      supabase
        .from('eval_runs')
        .select('id, dataset_id, name, status, is_baseline, completed_at')
        .order('created_at', { ascending: false }),
    ])
  if (datasetsError) throw datasetsError
  if (casesError) throw casesError
  if (runsError) throw runsError

  const projectIds = [...new Set((datasets ?? []).map((d) => d.project_id).filter((id): id is string => id !== null))]
  const completedRunIds = (runs ?? []).filter((r) => r.status === 'completed').map((r) => r.id)

  const [{ data: projects, error: projectsError }, { data: results, error: resultsError }, { data: judgements, error: judgementsError }] = await Promise.all([
    projectIds.length > 0 ? supabase.from('projects').select('id, name').in('id', projectIds) : Promise.resolve({ data: [], error: null }),
    completedRunIds.length > 0
      ? supabase
          .from('eval_results')
          .select(
            'eval_run_id, status, retrieval_hit, retrieval_recall, retrieval_mrr, generation_score, grounding_score, outcome_score, latency_ms, input_tokens, output_tokens, estimated_cost, human_reviewed_at'
          )
          .in('eval_run_id', completedRunIds)
      : Promise.resolve({ data: [], error: null }),
    projectIds.length > 0
      ? supabase
          .from('project_ember_readiness')
          .select('project_id, confidence_percent, verdict, review_due_at')
          .in('project_id', projectIds)
          .order('set_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ])
  if (projectsError) throw projectsError
  if (resultsError) throw resultsError
  // Curator judgements are an extra column; if they can't be read (e.g. the
  // Stage 2 migration not applied yet) show the table without them.
  if (judgementsError) console.error('Ember readiness judgements unavailable', judgementsError)

  return buildReadinessOverview({
    datasets: datasets ?? [],
    projects: projects ?? [],
    cases: cases ?? [],
    runs: runs ?? [],
    results: (results ?? []) as ResultRow[],
    judgements: judgementsError ? [] : (judgements ?? []),
  })
}
