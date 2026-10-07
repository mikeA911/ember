import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { requestMoreWorkstreams, decideWorkstreamLimitRequest, getWorkstreamAllowanceForProject } = await import('./workstream-limits')

beforeEach(() => createAdminClientMock.mockReset())

function ctxWith(supabase: unknown, role = 'consultant'): WorkbenchCallerContext {
  return { user: { id: role === 'admin' ? 'admin-1' : 'builder-1' }, profile: { role }, supabase } as unknown as WorkbenchCallerContext
}

describe('requestMoreWorkstreams', () => {
  it('needs a reason', async () => {
    await expect(requestMoreWorkstreams(ctxWith(createFakeSupabase({})), { requestedLimit: 30, reason: '  ' })).rejects.toThrow('Say why')
  })

  it('must ask for more than the current limit', async () => {
    const supabase = createFakeSupabase({ builder_workstream_limits: [{ data: null, error: null }] })
    await expect(requestMoreWorkstreams(ctxWith(supabase), { requestedLimit: 20, reason: 'Busy' })).rejects.toThrow('current limit of 20')
  })

  it('records the request with the reason', async () => {
    const supabase = createFakeSupabase({ builder_workstream_limits: [{ data: { workstream_limit: 25 }, error: null }] })
    await requestMoreWorkstreams(ctxWith(supabase), { requestedLimit: 40, reason: ' Three new clients ' })
    expect(supabase._calls).toContainEqual({
      table: 'builder_workstream_limit_requests',
      method: 'insert',
      args: { builder_id: 'builder-1', requested_limit: 40, reason: 'Three new clients' },
    })
  })
})

describe('decideWorkstreamLimitRequest', () => {
  it('is admin only', async () => {
    await expect(decideWorkstreamLimitRequest(ctxWith(createFakeSupabase({})), 'req-1', true)).rejects.toThrow('Only the platform admin')
  })

  it('raises the limit to what the builder asked for when approved', async () => {
    const supabase = createFakeSupabase({
      builder_workstream_limit_requests: [{ data: { id: 'req-1', builder_id: 'builder-1', requested_limit: 40, status: 'pending' }, error: null }],
    })
    await decideWorkstreamLimitRequest(ctxWith(supabase, 'admin'), 'req-1', true)
    expect(supabase._calls).toContainEqual({
      table: 'builder_workstream_limits',
      method: 'upsert',
      args: { builder_id: 'builder-1', workstream_limit: 40, set_by: 'admin-1' },
    })
    const update = supabase._calls.find((c) => c.table === 'builder_workstream_limit_requests' && c.method === 'update')
    expect(update?.args).toMatchObject({ status: 'approved', decided_by: 'admin-1' })
  })

  it('leaves the limit alone when declined', async () => {
    const supabase = createFakeSupabase({
      builder_workstream_limit_requests: [{ data: { id: 'req-1', builder_id: 'builder-1', requested_limit: 40, status: 'pending' }, error: null }],
    })
    await decideWorkstreamLimitRequest(ctxWith(supabase, 'admin'), 'req-1', false, 'Not yet')
    expect(supabase._calls.some((c) => c.table === 'builder_workstream_limits')).toBe(false)
    const update = supabase._calls.find((c) => c.table === 'builder_workstream_limit_requests' && c.method === 'update')
    expect(update?.args).toMatchObject({ status: 'declined', decision_note: 'Not yet' })
  })
})

describe('getWorkstreamAllowanceForProject', () => {
  it('applies no limit outside a builder workspace', async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({ projects: [{ data: { owner_id: 'u-1', portfolio_category: 'other' }, error: null }] }))
    expect(await getWorkstreamAllowanceForProject('proj-1')).toBeNull()
  })

  it('applies no limit to a client project created by promotion', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [
          { data: { owner_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null },
          { data: [{ id: 'client-1' }], error: null },
        ],
        profiles: [{ data: { role: 'consultant' }, error: null }],
        workstream_promotions: [{ data: [{ created_project_id: 'client-1' }], error: null }],
      })
    )
    expect(await getWorkstreamAllowanceForProject('client-1')).toBeNull()
  })

  it("counts the builder's workspace workstreams against the default of 20", async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [
          { data: { owner_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null },
          { data: [{ id: 'ws-proj-1' }], error: null },
        ],
        profiles: [{ data: { role: 'consultant' }, error: null }],
        workstream_promotions: [{ data: [], error: null }],
        project_workstreams: [{ data: null, error: null, count: 20 } as never],
        builder_workstream_limits: [{ data: null, error: null }],
        builder_workstream_limit_requests: [{ data: null, error: null }],
      })
    )
    expect(await getWorkstreamAllowanceForProject('ws-proj-1')).toEqual({ builderId: 'builder-1', used: 20, limit: 20, pendingRequest: null })
  })
})
