import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { AICostDailyRow } from '@/types/database'
import type { WorkbenchCallerContext } from './context'

const { summarizeCostRows, getAICostReport } = await import('./ai-cost-report')

function row(overrides: Partial<AICostDailyRow>): AICostDailyRow {
  return {
    day: '2026-10-02',
    task: 'chat',
    provider: 'openai',
    model: 'gpt-x',
    operation: 'generate_chat',
    calls: 1,
    failed_calls: 0,
    unpriced_calls: 0,
    byo_llm_calls: 0,
    input_tokens: 1000,
    cached_input_tokens: 0,
    cache_reported_input_tokens: 1000,
    output_tokens: 100,
    cost_usd: 0.01,
    ...overrides,
  }
}

describe('summarizeCostRows', () => {
  it('totals per task and per model, most expensive first, from string numerics too', () => {
    const period = summarizeCostRows(
      [
        row({ task: 'chat', calls: 10, input_tokens: '20000', cached_input_tokens: '15000', cache_reported_input_tokens: '20000', cost_usd: '0.50' }),
        row({ task: 'conversation_summary', model: 'gpt-mini', calls: 3, cost_usd: 0.9 }),
        row({ task: 'chat', provider: 'gemini', model: 'flash', calls: 2, cost_usd: 0.1, cached_input_tokens: 0, cache_reported_input_tokens: 0 }),
      ],
      '2026-10-01',
      'This month'
    )

    expect(period.total.calls).toBe(15)
    expect(period.total.costUsd).toBeCloseTo(1.5)
    expect(period.byTask.map((t) => [t.key, t.label, t.calls])).toEqual([
      ['conversation_summary', 'Conversation summary', 3],
      ['chat', 'Ember chat', 12],
    ])
    // 15000 of 20000 -- the gemini row reports no cache figure, so it doesn't dilute the share
    expect(period.byTask[1].cachedPct).toBe(75)
    expect(period.byModel.map((m) => m.key)).toEqual(['openai/gpt-mini', 'openai/gpt-x', 'gemini/flash'])
  })

  it('leaves out days before the period and shows null cached share when no provider reports it', () => {
    const period = summarizeCostRows(
      [row({ day: '2026-09-30', calls: 5 }), row({ task: 'unattributed', cache_reported_input_tokens: 0, unpriced_calls: 1 })],
      '2026-10-01',
      'This month'
    )
    expect(period.total.calls).toBe(1)
    expect(period.byTask[0]).toMatchObject({ label: 'Unattributed (logged before task tracking)', cachedPct: null, unpricedCalls: 1 })
  })
})

describe('getAICostReport', () => {
  const ctx = (role: string, supabase = createFakeSupabase({})) => ({ profile: { role }, supabase }) as unknown as WorkbenchCallerContext

  it('is admin only', async () => {
    await expect(getAICostReport(ctx('curator'))).rejects.toThrow('Only the platform admin')
  })

  it('reads once from the earlier of month start and 30 days ago', async () => {
    const supabase = createFakeSupabase({ ai_cost_daily: [{ data: [row({ day: '2026-10-03' })], error: null }] })
    const report = await getAICostReport(ctx('admin', supabase), new Date('2026-10-04T12:00:00Z'))
    expect(report.thisMonth.since).toBe('2026-10-01')
    expect(report.last30Days.since).toBe('2026-09-05')
    expect(report.thisMonth.total.calls).toBe(1)
    expect(report.last30Days.total.calls).toBe(1)
  })
})

describe('ai cost report migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261011100001_ai_cost_report.sql'), 'utf-8')

  it('reads logs as the caller, so the admin-only log policy applies', () => {
    expect(sql).toMatch(/create or replace view ai_cost_daily with \(security_invoker = true\)/)
  })

  it('adds a cached input price', () => {
    expect(sql).toMatch(/add column if not exists cached_input_cost_per_million numeric/)
  })
})
