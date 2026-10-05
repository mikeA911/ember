import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { AIProvider } from './provider'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const { computeCost, getBuilderSpendSummary, getBuilderSpendSummaries, withAllowanceGate, BuilderAllowanceError, grantBuilderCredit, setBuilderAllowance } = await import(
  './metering'
)

function ctxWith(supabase: unknown, opts: { userId?: string; role?: string } = {}): WorkbenchCallerContext {
  return {
    user: { id: opts.userId ?? 'operator-1' },
    profile: { role: opts.role ?? 'admin' },
    supabase,
  } as unknown as WorkbenchCallerContext
}

describe('computeCost', () => {
  it('returns null when no tokens are reported at all', async () => {
    const supabase = createFakeSupabase({})
    const result = await computeCost(supabase as never, 'groq', 'llama', null, null)
    expect(result).toBeNull()
  })

  it('returns null when the provider is not found', async () => {
    const supabase = createFakeSupabase({ ai_providers: [{ data: null, error: null }] })
    const result = await computeCost(supabase as never, 'unknown-provider', 'model-1', 100, 100)
    expect(result).toBeNull()
  })

  it('returns null when pricing is not configured for the model', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
      ai_models: [{ data: { input_cost_per_million: null, output_cost_per_million: null }, error: null }],
    })
    const result = await computeCost(supabase as never, 'openai', 'gpt-4o-mini', 100, 100)
    expect(result).toBeNull()
  })

  it('computes cost from configured per-million pricing', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
      ai_models: [{ data: { input_cost_per_million: 10, output_cost_per_million: 20 }, error: null }],
    })
    const result = await computeCost(supabase as never, 'openai', 'gpt-4o-mini', 1_000_000, 500_000)
    expect(result).toBe(10 + 10) // 1M input @ $10/M + 0.5M output @ $20/M
  })

  it('charges cached input at the cached price', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
      ai_models: [{ data: { input_cost_per_million: 10, cached_input_cost_per_million: 2.5, output_cost_per_million: 20 }, error: null }],
    })
    // 0.6M uncached @ $10 + 0.4M cached @ $2.50 + 0.5M output @ $20
    expect(await computeCost(supabase as never, 'openai', 'gpt-4o-mini', 1_000_000, 500_000, 400_000)).toBeCloseTo(6 + 1 + 10)
  })

  it('charges cached input at the full input price when no cached price is set', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
      ai_models: [{ data: { input_cost_per_million: 10, cached_input_cost_per_million: null, output_cost_per_million: 20 }, error: null }],
    })
    expect(await computeCost(supabase as never, 'openai', 'gpt-4o-mini', 1_000_000, 500_000, 400_000)).toBeCloseTo(20)
  })
})

describe('getBuilderSpendSummary', () => {
  it('falls back to the platform default allowance when no row exists yet', async () => {
    const supabase = createFakeSupabase({
      builder_ai_allowances: [{ data: null, error: null }],
      builder_credit_grants: [{ data: [], error: null }],
      ai_operation_logs: [{ data: [], error: null }],
    })
    const result = await getBuilderSpendSummary(supabase as never, 'builder-1')
    expect(result).toMatchObject({ allowanceUsd: 20, warningThresholdPct: 80, stopAtAllowance: true, spentThisPeriodUsd: 0, remainingUsd: 20 })
  })

  it('uses the configured allowance row, sums credit grants, and computes remaining', async () => {
    const supabase = createFakeSupabase({
      builder_ai_allowances: [
        { data: { monthly_allowance_usd: 5, warning_threshold_pct: 90, stop_at_allowance: true, current_period_start: '2026-09-01' }, error: null },
      ],
      builder_credit_grants: [{ data: [{ amount_usd: 3 }, { amount_usd: 2 }], error: null }],
      ai_operation_logs: [{ data: [{ estimated_cost_usd: 4 }, { estimated_cost_usd: 1 }], error: null }],
    })
    const result = await getBuilderSpendSummary(supabase as never, 'builder-1')
    expect(result).toEqual({
      allowanceUsd: 5,
      creditsUsd: 5,
      spentThisPeriodUsd: 5,
      remainingUsd: 5, // (5 allowance + 5 credits) - 5 spent
      warningThresholdPct: 90,
      stopAtAllowance: true,
    })
  })

  it('treats a null estimated_cost_usd log row as zero spend, not a fabricated cost', async () => {
    const supabase = createFakeSupabase({
      builder_ai_allowances: [{ data: null, error: null }],
      builder_credit_grants: [{ data: [], error: null }],
      ai_operation_logs: [{ data: [{ estimated_cost_usd: null }], error: null }],
    })
    const result = await getBuilderSpendSummary(supabase as never, 'builder-1')
    expect(result.spentThisPeriodUsd).toBe(0)
  })
})

describe('withAllowanceGate', () => {
  function fakeProvider(): AIProvider {
    return {
      name: 'test-provider',
      generateText: vi.fn().mockResolvedValue({ text: 'ok', model: 'm', usage: {} }),
      generateStructured: vi.fn().mockResolvedValue({ data: {}, model: 'm', usage: {} }),
      generateChat: vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'm', usage: {} }),
      embed: vi.fn().mockResolvedValue({ embedding: [], model: 'm', dimensions: 0, usage: {} }),
    } as unknown as AIProvider
  }

  it('calls through to the wrapped provider when there is remaining balance', async () => {
    const provider = fakeProvider()
    const gated = withAllowanceGate(
      async () => ({ allowanceUsd: 20, creditsUsd: 0, spentThisPeriodUsd: 5, remainingUsd: 15, warningThresholdPct: 80, stopAtAllowance: true }),
      provider
    )
    await gated.generateChat({ messages: [] })
    expect(provider.generateChat).toHaveBeenCalled()
  })

  it('throws BuilderAllowanceError before the wrapped provider is ever called, once over budget with stopAtAllowance', async () => {
    const provider = fakeProvider()
    const gated = withAllowanceGate(
      async () => ({ allowanceUsd: 20, creditsUsd: 0, spentThisPeriodUsd: 25, remainingUsd: -5, warningThresholdPct: 80, stopAtAllowance: true }),
      provider
    )
    await expect(gated.generateChat({ messages: [] })).rejects.toBeInstanceOf(BuilderAllowanceError)
    expect(provider.generateChat).not.toHaveBeenCalled()
  })

  it('does not block when over budget but stopAtAllowance is false (warn-only)', async () => {
    const provider = fakeProvider()
    const gated = withAllowanceGate(
      async () => ({ allowanceUsd: 20, creditsUsd: 0, spentThisPeriodUsd: 25, remainingUsd: -5, warningThresholdPct: 80, stopAtAllowance: false }),
      provider
    )
    await gated.generateChat({ messages: [] })
    expect(provider.generateChat).toHaveBeenCalled()
  })
})

describe('grantBuilderCredit', () => {
  it('rejects a non-curator/admin caller', async () => {
    const supabase = createFakeSupabase({})
    await expect(grantBuilderCredit(ctxWith(supabase, { role: 'consultant' }), 'builder-1', 10, 'top-up')).rejects.toThrow(
      'Requires curator or admin'
    )
  })

  it('rejects a non-positive amount', async () => {
    const supabase = createFakeSupabase({})
    await expect(grantBuilderCredit(ctxWith(supabase), 'builder-1', 0, 'top-up')).rejects.toThrow('positive')
  })

  it('inserts a grant row for a curator/admin caller', async () => {
    const supabase = createFakeSupabase({ builder_credit_grants: [{ data: null, error: null }] })
    await grantBuilderCredit(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', 10, 'promo')
    const insert = supabase._calls.find((c) => c.table === 'builder_credit_grants' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ builder_id: 'builder-1', amount_usd: 10, reason: 'promo', granted_by: 'admin-1' })
  })
})

describe('setBuilderAllowance', () => {
  it('rejects a non-curator/admin caller', async () => {
    const supabase = createFakeSupabase({})
    await expect(
      setBuilderAllowance(ctxWith(supabase, { role: 'consultant' }), 'builder-1', { monthlyAllowanceUsd: 20, warningThresholdPct: 80, stopAtAllowance: true })
    ).rejects.toThrow('Requires curator or admin')
  })

  it("upserts the allowance row for the builder's own agency curator", async () => {
    const supabase = createFakeSupabase({
      agency_builders: [{ data: { builder_id: 'builder-1' }, error: null }],
      builder_ai_allowances: [{ data: null, error: null }],
    })
    await setBuilderAllowance(ctxWith(supabase, { userId: 'agency-1', role: 'curator' }), 'builder-1', {
      monthlyAllowanceUsd: 5,
      warningThresholdPct: 90,
      stopAtAllowance: false,
    })
    const upsert = supabase._calls.find((c) => c.table === 'builder_ai_allowances' && c.method === 'upsert')
    expect(upsert?.args).toMatchObject({ builder_id: 'builder-1', monthly_allowance_usd: 5, warning_threshold_pct: 90, stop_at_allowance: false })
  })
})

// Agencies manage their own builders' budgets; an enterprise on its own
// deployment is the agency. Another agency's curator never can.
describe('budget management is scoped to the builder\'s agency', () => {
  it('refuses a curator who is not the builder\'s agency', async () => {
    const supabase = createFakeSupabase({ agency_builders: [{ data: null, error: null }] })
    await expect(
      setBuilderAllowance(ctxWith(supabase, { userId: 'agency-2', role: 'curator' }), 'builder-1', {
        monthlyAllowanceUsd: 50,
        warningThresholdPct: 80,
        stopAtAllowance: true,
      })
    ).rejects.toThrow("Only the builder's agency or the platform admin")
    await expect(grantBuilderCredit(ctxWith(supabase, { userId: 'agency-2', role: 'curator' }), 'builder-1', 10, 'top-up')).rejects.toThrow(
      "Only the builder's agency or the platform admin"
    )
    expect(supabase._calls.some((c) => c.method === 'upsert' || c.method === 'insert')).toBe(false)
  })

  it('checks the roster for this builder and this curator', async () => {
    const supabase = createFakeSupabase({
      agency_builders: [{ data: { builder_id: 'builder-1' }, error: null }],
      builder_credit_grants: [{ data: null, error: null }],
    })
    await grantBuilderCredit(ctxWith(supabase, { userId: 'agency-1', role: 'curator' }), 'builder-1', 10, 'top-up')
    expect(supabase._calls).toContainEqual({ table: 'agency_builders', method: 'eq', args: { column: 'builder_id', value: 'builder-1' } })
    expect(supabase._calls).toContainEqual({ table: 'agency_builders', method: 'eq', args: { column: 'agency_id', value: 'agency-1' } })
  })
})

describe('getBuilderSpendSummaries', () => {
  it('returns nothing, without querying, for no builders', async () => {
    const supabase = createFakeSupabase({})
    expect((await getBuilderSpendSummaries(supabase as never, [])).size).toBe(0)
    expect(supabase._calls).toHaveLength(0)
  })

  it('sums each builder\'s credits and spend from their own period start, defaulting a builder with no allowance row', async () => {
    const supabase = createFakeSupabase({
      builder_ai_allowances: [
        {
          data: [{ builder_id: 'b-1', monthly_allowance_usd: 50, warning_threshold_pct: 90, stop_at_allowance: false, current_period_start: '2026-10-02' }],
          error: null,
        },
      ],
      builder_credit_grants: [{ data: [{ builder_id: 'b-1', amount_usd: 5 }, { builder_id: 'b-2', amount_usd: 3 }], error: null }],
      ai_operation_logs: [
        {
          data: [
            { requested_by: 'b-1', estimated_cost_usd: 99, created_at: '2026-10-01T12:00:00Z' }, // before b-1's period
            { requested_by: 'b-1', estimated_cost_usd: 4, created_at: '2026-10-03T00:00:00Z' },
            { requested_by: 'b-2', estimated_cost_usd: 2, created_at: '2026-10-03T00:00:00Z' },
            { requested_by: 'b-2', estimated_cost_usd: null, created_at: '2026-10-03T00:00:00Z' },
          ],
          error: null,
        },
      ],
    })
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-15T12:00:00'))
    try {
      const result = await getBuilderSpendSummaries(supabase as never, ['b-1', 'b-2'])
      expect(result.get('b-1')).toEqual({
        allowanceUsd: 50,
        creditsUsd: 5,
        spentThisPeriodUsd: 4,
        remainingUsd: 51,
        warningThresholdPct: 90,
        stopAtAllowance: false,
      })
      expect(result.get('b-2')).toEqual({
        allowanceUsd: 20,
        creditsUsd: 3,
        spentThisPeriodUsd: 2,
        remainingUsd: 21,
        warningThresholdPct: 80,
        stopAtAllowance: true,
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
