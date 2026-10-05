import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import type { Database, EmberReadinessVerdict, ProjectEmberReadiness, ProjectEmberReadinessSignals } from '@/types/database'

// Ember Readiness, Stage 2 (docs/dev-request-ember-readiness-and-knowledge-
// gaps.md): how ready Ember is for a Project. Two signals stay separate --
// the curator's confidence (a judgement) and the measured score (the latest
// admin eval run) -- with a verdict a person sets on top. Never blended
// into one number.

export const REVIEW_PERIOD_DAYS = [30, 60, 90, 180] as const
export const DEFAULT_REVIEW_PERIOD_DAYS = 90
// A measured score this many points below the one recorded when the
// judgement was set marks it for review.
export const SCORE_DROP_POINTS = 15
// Curator confidence and measured score further apart than this are shown
// as disagreeing rather than one being picked.
export const DISAGREEMENT_POINTS = 25

export type ReadinessDisplayVerdict = EmberReadinessVerdict | 'not_assessed'

export interface ReadinessJudgement {
  confidencePercent: number
  verdict: EmberReadinessVerdict
  rationale: string
  setBy: string | null
  setAt: string
  reviewDueAt: string
  // 0..100 when an eval run existed at the time; null otherwise.
  measuredPctAtSet: number | null
}

export interface ReadinessMeasured {
  runId: string
  datasetName: string | null
  measuredAt: string | null
  questions: number
  passed: number
  // 0..100
  pct: number
}

export interface ReadinessCoverage {
  sourceCount: number
  searchableSourceCount: number
  wikiArticleCount: number
  lastSourceAddedAt: string | null
}

export interface ReadinessStatus {
  verdict: ReadinessDisplayVerdict
  reviewDue: boolean
  reviewReasons: string[]
  // Set when curator confidence and measured score disagree by more than
  // DISAGREEMENT_POINTS.
  disagreement: string | null
}

export interface ProjectReadiness {
  projectId: string
  current: ReadinessJudgement | null
  history: ReadinessJudgement[]
  measured: ReadinessMeasured | null
  coverage: ReadinessCoverage
  status: ReadinessStatus
}

function toJudgement(row: ProjectEmberReadiness): ReadinessJudgement {
  const atSet = row.measured_score_at_set === null ? null : Number(row.measured_score_at_set)
  return {
    confidencePercent: row.confidence_percent,
    verdict: row.verdict,
    rationale: row.rationale,
    setBy: row.set_by,
    setAt: row.set_at,
    reviewDueAt: row.review_due_at,
    measuredPctAtSet: atSet === null || Number.isNaN(atSet) ? null : Math.round(atSet * 100),
  }
}

function toMeasured(signals: ProjectEmberReadinessSignals | undefined): ReadinessMeasured | null {
  if (!signals?.measured_run_id || !signals.measured_questions) return null
  const passed = signals.measured_passed ?? 0
  return {
    runId: signals.measured_run_id,
    datasetName: signals.measured_dataset_name,
    measuredAt: signals.measured_at,
    questions: signals.measured_questions,
    passed,
    pct: Math.round((passed / signals.measured_questions) * 100),
  }
}

function toCoverage(signals: ProjectEmberReadinessSignals | undefined): ReadinessCoverage {
  return {
    sourceCount: signals?.source_count ?? 0,
    searchableSourceCount: signals?.searchable_source_count ?? 0,
    wikiArticleCount: signals?.wiki_article_count ?? 0,
    lastSourceAddedAt: signals?.last_source_added_at ?? null,
  }
}

// Pure, so the staleness and disagreement rules are unit-testable.
export function computeReadinessStatus(current: ReadinessJudgement | null, measured: ReadinessMeasured | null, now: Date): ReadinessStatus {
  if (!current) return { verdict: 'not_assessed', reviewDue: false, reviewReasons: [], disagreement: null }

  const reviewReasons: string[] = []
  if (new Date(current.reviewDueAt).getTime() <= now.getTime()) reviewReasons.push('The review date has passed.')
  if (measured && current.measuredPctAtSet !== null && current.measuredPctAtSet - measured.pct >= SCORE_DROP_POINTS) {
    reviewReasons.push(`The measured score fell from ${current.measuredPctAtSet}% to ${measured.pct}% since this was set.`)
  }

  let disagreement: string | null = null
  if (measured && Math.abs(current.confidencePercent - measured.pct) > DISAGREEMENT_POINTS) {
    disagreement =
      current.confidencePercent > measured.pct
        ? `Curator confidence (${current.confidencePercent}%) is well above the measured score (${measured.pct}%).`
        : `The measured score (${measured.pct}%) is well above curator confidence (${current.confidencePercent}%).`
  }

  return { verdict: current.verdict, reviewDue: reviewReasons.length > 0, reviewReasons, disagreement }
}

async function fetchSignals(supabase: SupabaseClient<Database>, projectIds: string[]) {
  if (projectIds.length === 0) return new Map<string, ProjectEmberReadinessSignals>()
  const { data, error } = await supabase.rpc('project_ember_readiness_signals', { pids: projectIds })
  if (error) throw error
  return new Map((data ?? []).map((row) => [row.project_id, row]))
}

// Readiness for each Project the caller can see (project_ember_readiness
// and the signals function are both member-scoped, so a Project the caller
// doesn't belong to just comes back "not assessed" with empty coverage).
export async function listProjectReadiness(
  supabase: SupabaseClient<Database>,
  projectIds: string[],
  { historyLimit = 0, now = new Date() }: { historyLimit?: number; now?: Date } = {}
): Promise<Map<string, ProjectReadiness>> {
  const result = new Map<string, ProjectReadiness>()
  if (projectIds.length === 0) return result

  const [{ data: rows, error }, signalsById] = await Promise.all([
    supabase.from('project_ember_readiness').select('*').in('project_id', projectIds).order('set_at', { ascending: false }),
    fetchSignals(supabase, projectIds),
  ])
  if (error) throw error

  const rowsByProject = new Map<string, ProjectEmberReadiness[]>()
  for (const row of rows ?? []) {
    const list = rowsByProject.get(row.project_id) ?? []
    list.push(row)
    rowsByProject.set(row.project_id, list)
  }

  for (const projectId of projectIds) {
    const judgements = (rowsByProject.get(projectId) ?? []).map(toJudgement)
    const current = judgements[0] ?? null
    const signals = signalsById.get(projectId)
    const measured = toMeasured(signals)
    result.set(projectId, {
      projectId,
      current,
      history: judgements.slice(1, 1 + historyLimit),
      measured,
      coverage: toCoverage(signals),
      status: computeReadinessStatus(current, measured, now),
    })
  }
  return result
}

export async function getProjectReadiness(supabase: SupabaseClient<Database>, projectId: string): Promise<ProjectReadiness> {
  const map = await listProjectReadiness(supabase, [projectId], { historyLimit: 5 })
  return map.get(projectId)!
}

export interface SetReadinessInput {
  confidencePercent: number
  verdict: EmberReadinessVerdict
  rationale: string
  reviewPeriodDays: number
}

export class ReadinessValidationError extends Error {}

// Project owner/curator or platform admin only -- the same can_curate_project
// bar the insert policy enforces; checked here too for a clear message.
export async function setProjectReadiness(ctx: WorkbenchCallerContext, projectId: string, input: SetReadinessInput): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator') {
      throw new AuthError("Requires this project's owner or curator role (or platform admin) to set Ember readiness")
    }
  }

  const confidence = Math.round(input.confidencePercent)
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100) {
    throw new ReadinessValidationError('Confidence must be between 0 and 100')
  }
  if (input.verdict !== 'ready' && input.verdict !== 'needs_more_sources') {
    throw new ReadinessValidationError('Choose a verdict')
  }
  const rationale = input.rationale.trim()
  if (!rationale) throw new ReadinessValidationError('Say why, so the team knows what this is based on')
  if (rationale.length > 2000) throw new ReadinessValidationError('Keep the rationale under 2,000 characters')
  if (!(REVIEW_PERIOD_DAYS as readonly number[]).includes(input.reviewPeriodDays)) {
    throw new ReadinessValidationError('Choose a review period')
  }

  const reviewDueAt = new Date(Date.now() + input.reviewPeriodDays * 24 * 60 * 60 * 1000).toISOString()
  const { error } = await ctx.supabase.from('project_ember_readiness').insert({
    project_id: projectId,
    confidence_percent: confidence,
    verdict: input.verdict,
    rationale,
    review_due_at: reviewDueAt,
    set_by: ctx.user.id,
  })
  if (error) throw error
}
