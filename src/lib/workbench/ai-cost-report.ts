import 'server-only'
import { AuthError } from '@/lib/auth'
import { AI_TASKS } from '@/lib/ai/tasks'
import type { AICostDailyRow } from '@/types/database'
import type { WorkbenchCallerContext } from './context'

// Admin AI cost report (20261011100001_ai_cost_report.sql): spend per task
// and per model from the ai_cost_daily view. Read through the caller's own
// client -- the view is security_invoker, so ai_operation_logs' admin-only
// RLS applies.

export interface AICostLine {
  key: string
  label: string
  calls: number
  failedCalls: number
  unpricedCalls: number
  byoLlmCalls: number
  inputTokens: number
  cachedInputTokens: number
  // Share of input served from the provider's cache, among calls whose
  // provider reports it; null when none do.
  cachedPct: number | null
  outputTokens: number
  costUsd: number
}

export interface AICostPeriod {
  label: string
  since: string
  total: AICostLine
  byTask: AICostLine[]
  byModel: AICostLine[]
}

export interface AICostReport {
  thisMonth: AICostPeriod
  last30Days: AICostPeriod
}

function taskLabel(task: string): string {
  if (task === 'unattributed') return 'Unattributed (logged before task tracking)'
  return (AI_TASKS as Record<string, string>)[task] ?? task
}

function emptyLine(key: string, label: string) {
  return { key, label, calls: 0, failedCalls: 0, unpricedCalls: 0, byoLlmCalls: 0, inputTokens: 0, cachedInputTokens: 0, cacheReported: 0, outputTokens: 0, costUsd: 0 }
}

type Accumulator = ReturnType<typeof emptyLine>

function add(acc: Accumulator, row: AICostDailyRow) {
  acc.calls += row.calls
  acc.failedCalls += row.failed_calls
  acc.unpricedCalls += row.unpriced_calls
  acc.byoLlmCalls += row.byo_llm_calls
  // bigint/numeric columns can arrive as strings from PostgREST.
  acc.inputTokens += Number(row.input_tokens)
  acc.cachedInputTokens += Number(row.cached_input_tokens)
  acc.cacheReported += Number(row.cache_reported_input_tokens)
  acc.outputTokens += Number(row.output_tokens)
  acc.costUsd += Number(row.cost_usd)
}

function finish({ cacheReported, ...acc }: Accumulator): AICostLine {
  return { ...acc, cachedPct: cacheReported > 0 ? Math.round((acc.cachedInputTokens / cacheReported) * 100) : null }
}

// Pure, so the shaping is testable without a database. Most expensive first.
export function summarizeCostRows(rows: AICostDailyRow[], since: string, label: string): AICostPeriod {
  const inPeriod = rows.filter((r) => r.day >= since)
  const total = emptyLine('total', 'Total')
  const byTask = new Map<string, Accumulator>()
  const byModel = new Map<string, Accumulator>()
  for (const r of inPeriod) {
    add(total, r)
    const task = byTask.get(r.task) ?? emptyLine(r.task, taskLabel(r.task))
    add(task, r)
    byTask.set(r.task, task)
    const modelKey = `${r.provider}/${r.model}`
    const model = byModel.get(modelKey) ?? emptyLine(modelKey, `${r.provider} · ${r.model}`)
    add(model, r)
    byModel.set(modelKey, model)
  }
  const sorted = (m: Map<string, Accumulator>) =>
    [...m.values()].map(finish).sort((a, b) => b.costUsd - a.costUsd || b.calls - a.calls)
  return { label, since, total: finish(total), byTask: sorted(byTask), byModel: sorted(byModel) }
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export async function getAICostReport(ctx: WorkbenchCallerContext, now = new Date()): Promise<AICostReport> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can view AI costs')
  // UTC days, matching the view.
  const monthStart = isoDay(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)))
  const thirtyDaysAgo = isoDay(new Date(now.getTime() - 29 * 24 * 60 * 60 * 1000))
  const since = monthStart < thirtyDaysAgo ? monthStart : thirtyDaysAgo

  const { data, error } = await ctx.supabase.from('ai_cost_daily').select('*').gte('day', since)
  if (error) throw error
  const rows = (data ?? []) as AICostDailyRow[]
  return {
    thisMonth: summarizeCostRows(rows, monthStart, 'This month'),
    last30Days: summarizeCostRows(rows, thirtyDaysAgo, 'Last 30 days'),
  }
}
