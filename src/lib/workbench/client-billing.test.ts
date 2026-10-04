import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { getPlatformRatePct, setPlatformRatePct, setClientProjectFee, monthlyEquivalent, validateFee } = await import('./client-billing')

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
    createAdminClientMock.mockReturnValue(createFakeSupabase({ projects: [{ data: { owner_id: 'builder-1' }, error: null }] }))
    const supabase = createFakeSupabase({ agency_builders: [{ data: null, error: null }] })
    await expect(setClientProjectFee(ctxWith(supabase), 'proj-1', { amount: 100, currency: 'USD', period: 'monthly' })).rejects.toThrow(
      "Only this builder's agency"
    )
  })

  it("records a new fee at today's platform rate", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: { owner_id: 'builder-1' }, error: null }],
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
      builder_share_pct: 10,
    })
  })

  it("lets the agency set the builder's share, and checks the builder of record after the agency took the project over", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: { owner_id: 'agency-1', builder_id: 'builder-1' }, error: null }],
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
    expect(insert?.args).toMatchObject({ platform_rate_pct: 10, builder_share_pct: 15 })
  })

  it("rejects a builder's share outside 0-100", async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({}))
    await expect(
      setClientProjectFee(ctxWith(createFakeSupabase({}), { role: 'admin' }), 'proj-1', { amount: 1, currency: 'USD', period: 'monthly', builderSharePct: 120 })
    ).rejects.toThrow("Builder's share must be between 0 and 100")
  })

  it('keeps the recorded rate when correcting an existing fee', async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({}))
    const supabase = createFakeSupabase({ client_project_fees: [{ data: { platform_rate_pct: 8 }, error: null }] })
    await setClientProjectFee(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'proj-1', { amount: 30000, currency: 'PHP', period: 'monthly' })
    const update = supabase._calls.find((c) => c.table === 'client_project_fees' && c.method === 'update')
    expect(update?.args).toEqual({ amount: 30000, currency: 'PHP', billing_period: 'monthly', set_by: 'admin-1' })
  })
})
