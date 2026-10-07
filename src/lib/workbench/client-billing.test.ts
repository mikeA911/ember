import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { getPlatformRatePct, setPlatformRatePct, setClientProjectFee, setBuilderRates, feeSplitFor, monthlyEquivalent, validateFee } = await import(
  './client-billing'
)

beforeEach(() => {
  createAdminClientMock.mockReset()
})

function ctxWith(supabase: unknown, opts: { userId?: string; role?: string } = {}): WorkbenchCallerContext {
  return { user: { id: opts.userId ?? 'agency-1' }, profile: { role: opts.role ?? 'curator' }, supabase } as unknown as WorkbenchCallerContext
}

describe('fees', () => {
  it('counts an annual fee as a twelfth per month', () => {
    expect(monthlyEquivalent(120000, 'annual')).toBe(10000)
    expect(monthlyEquivalent(5000, 'monthly')).toBe(5000)
  })

  it('rejects a negative amount or an unsupported currency', () => {
    expect(() => validateFee({ amount: -1, currency: 'PHP', period: 'monthly' })).toThrow('zero or more')
    expect(() => validateFee({ amount: 10, currency: 'EUR' as never, period: 'monthly' })).toThrow('PHP or USD')
  })
})

describe('platform rate', () => {
  it('defaults to 10% until the admin sets one', async () => {
    expect(await getPlatformRatePct(createFakeSupabase({ settings: [{ data: null, error: null }] }) as never)).toBe(10)
    expect(await getPlatformRatePct(createFakeSupabase({ settings: [{ data: { value: { platformRatePct: 15 } }, error: null }] }) as never)).toBe(15)
  })

  it('lets only the admin set it, within 0-100', async () => {
    await expect(setPlatformRatePct(ctxWith(createFakeSupabase({})), 12)).rejects.toThrow('Only the platform admin')
    await expect(setPlatformRatePct(ctxWith(createFakeSupabase({}), { role: 'admin' }), 120)).rejects.toThrow('between 0 and 100')

    const supabase = createFakeSupabase({ settings: [{ data: null, error: null }] })
    await setPlatformRatePct(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 12)
    const upsert = supabase._calls.find((c) => c.table === 'settings' && c.method === 'upsert')
    expect(upsert?.args).toMatchObject({ key: 'builder_billing', value: { platformRatePct: 12 }, updated_by: 'admin-1' })
  })

  it("keeps the default builder's share when only the platform rate changes", async () => {
    const supabase = createFakeSupabase({ settings: [{ data: { value: { platformRatePct: 10, builderSharePct: 7 } }, error: null }] })
    await setPlatformRatePct(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 12)
    const upsert = supabase._calls.find((c) => c.table === 'settings' && c.method === 'upsert')
    expect(upsert?.args).toMatchObject({ value: { platformRatePct: 12, builderSharePct: 7 } })
  })
})

describe('setClientProjectFee', () => {
  it("rejects a curator who isn't the project owner's agency", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({ projects: [{ data: { owner_id: 'builder-1' }, error: null }], workstream_promotions: [{ data: { id: 'promo-1' }, error: null }], })
    )
    const supabase = createFakeSupabase({ agency_builders: [{ data: null, error: null }] })
    await expect(setClientProjectFee(ctxWith(supabase), 'proj-1', { amount: 100, currency: 'USD', period: 'monthly' })).rejects.toThrow(
      "Only this builder's agency"
    )
  })

  it("records a new fee at today's platform rate", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: { owner_id: 'builder-1' }, error: null }],
        workstream_promotions: [{ data: { id: 'promo-1' }, error: null }],
        settings: [{ data: { value: { platformRatePct: 10 } }, error: null }],
      })
    )
    const supabase = createFakeSupabase({
      agency_builders: [{ data: { builder_id: 'builder-1' }, error: null }],
      client_project_fees: [{ data: null, error: null }],
    })
    await setClientProjectFee(ctxWith(supabase), 'proj-1', { amount: 25000, currency: 'PHP', period: 'monthly' })
    const insert = supabase._calls.find((c) => c.table === 'client_project_fees' && c.method === 'insert')
    expect(insert?.args).toEqual({
      project_id: 'proj-1',
      amount: 25000,
      currency: 'PHP',
      billing_period: 'monthly',
      set_by: 'agency-1',
      platform_rate_pct: 10,
      builder_share_pct: 90,
    })
  })

  it("lets the agency set the builder's share, and checks the builder of record after the agency took the project over", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: { owner_id: 'agency-1', builder_id: 'builder-1' }, error: null }],
        workstream_promotions: [{ data: { id: 'promo-1' }, error: null }],
        settings: [{ data: { value: { platformRatePct: 10, builderSharePct: 10 } }, error: null }],
      })
    )
    const supabase = createFakeSupabase({
      agency_builders: [{ data: { builder_id: 'builder-1' }, error: null }],
      client_project_fees: [{ data: null, error: null }],
    })
    await setClientProjectFee(ctxWith(supabase), 'proj-1', { amount: 25000, currency: 'PHP', period: 'monthly', builderSharePct: 15 })
    expect(supabase._calls).toContainEqual({ table: 'agency_builders', method: 'eq', args: { column: 'builder_id', value: 'builder-1' } })
    const insert = supabase._calls.find((c) => c.table === 'client_project_fees' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ platform_rate_pct: 85, builder_share_pct: 15 })
  })

  it("rejects a builder's share outside 0-100", async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({}))
    await expect(
      setClientProjectFee(ctxWith(createFakeSupabase({}), { role: 'admin' }), 'proj-1', { amount: 1, currency: 'USD', period: 'monthly', builderSharePct: 120 })
    ).rejects.toThrow("Builder's share must be between 0 and 100")
  })

  it('keeps the recorded rate when correcting an existing fee', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({ projects: [{ data: { owner_id: 'builder-1' }, error: null }], workstream_promotions: [{ data: { id: 'promo-1' }, error: null }], })
    )
    const supabase = createFakeSupabase({ client_project_fees: [{ data: { platform_rate_pct: 8 }, error: null }] })
    await setClientProjectFee(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'proj-1', { amount: 30000, currency: 'PHP', period: 'monthly' })
    const update = supabase._calls.find((c) => c.table === 'client_project_fees' && c.method === 'update')
    expect(update?.args).toEqual({ amount: 30000, currency: 'PHP', billing_period: 'monthly', set_by: 'admin-1' })
  })

  it('refuses a fee on a project that was not promoted from a workstream', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({ projects: [{ data: { owner_id: 'builder-1' }, error: null }], workstream_promotions: [{ data: null, error: null }] })
    )
    await expect(
      setClientProjectFee(ctxWith(createFakeSupabase({}), { role: 'admin' }), 'proj-1', { amount: 100, currency: 'USD', period: 'monthly' })
    ).rejects.toThrow('Only a project promoted from a workstream')
  })

  it("records a builder-found fee at the builder's own cut, and an Ember-found one at their own share", async () => {
    for (const [source, own, expected] of [
      ['builder', { share_pct: null, platform_rate_pct: 6 }, { platform_rate_pct: 6, builder_share_pct: 94 }],
      ['ember', { share_pct: 8, platform_rate_pct: null }, { platform_rate_pct: 92, builder_share_pct: 8 }],
    ] as const) {
      createAdminClientMock.mockReturnValue(
        createFakeSupabase({
          projects: [{ data: { owner_id: 'builder-1', client_source: source }, error: null }],
          workstream_promotions: [{ data: { id: 'promo-1' }, error: null }],
          settings: [{ data: { value: { platformRatePct: 10, builderSharePct: 10 } }, error: null }],
          builder_billing_shares: [{ data: own, error: null }],
        })
      )
      const supabase = createFakeSupabase({ client_project_fees: [{ data: null, error: null }] })
      await setClientProjectFee(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'proj-1', { amount: 1000, currency: 'USD', period: 'monthly' })
      const insert = supabase._calls.find((c) => c.table === 'client_project_fees' && c.method === 'insert')
      expect(insert?.args).toMatchObject(expected)
    }
  })
})

describe('feeSplitFor', () => {
  const defaults = { platformRatePct: 10, builderSharePct: 10 }

  it('gives Ember its cut and the builder the rest when the builder found the client', () => {
    expect(feeSplitFor('builder', defaults, null)).toEqual({ platformRatePct: 10, builderSharePct: 90 })
    expect(feeSplitFor('builder', defaults, { platformRatePct: 5, builderSharePct: null })).toEqual({ platformRatePct: 5, builderSharePct: 95 })
  })

  it('gives the builder their share and Ember the rest when Ember found the client', () => {
    expect(feeSplitFor('ember', defaults, null)).toEqual({ platformRatePct: 90, builderSharePct: 10 })
    expect(feeSplitFor('ember', defaults, { platformRatePct: null, builderSharePct: 7.5 })).toEqual({ platformRatePct: 92.5, builderSharePct: 7.5 })
  })
})

describe('setBuilderRates', () => {
  it('is admin only', async () => {
    await expect(setBuilderRates(ctxWith(createFakeSupabase({})), 'builder-1', { platformRatePct: 5, builderSharePct: null })).rejects.toThrow(
      'Only the platform admin'
    )
  })

  it("sets a builder's own rates, and clearing both puts them back on the defaults", async () => {
    const supabase = createFakeSupabase({})
    const ctx = ctxWith(supabase, { userId: 'admin-1', role: 'admin' })
    await setBuilderRates(ctx, 'builder-1', { platformRatePct: 5, builderSharePct: 8 })
    expect(supabase._calls).toContainEqual({
      table: 'builder_billing_shares',
      method: 'upsert',
      args: { builder_id: 'builder-1', platform_rate_pct: 5, share_pct: 8, set_by: 'admin-1' },
    })
    await setBuilderRates(ctx, 'builder-1', { platformRatePct: null, builderSharePct: null })
    expect(supabase._calls.some((c) => c.table === 'builder_billing_shares' && c.method === 'delete')).toBe(true)
  })
})
