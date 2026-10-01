import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { assembleAgencyDashboard, getAgencyDashboard, assignBuilderToAgency } = await import('./agency-dashboard')

beforeEach(() => {
  createAdminClientMock.mockReset()
})

function ctxWith(supabase: unknown, opts: { userId?: string; role?: string } = {}): WorkbenchCallerContext {
  return {
    user: { id: opts.userId ?? 'agency-1' },
    profile: { role: opts.role ?? 'curator', email: 'agency1@example.com', full_name: 'Agency One', is_active: true },
    supabase,
  } as unknown as WorkbenchCallerContext
}

const person = (id: string, email: string) => ({ id, email, full_name: null, is_active: true })

const update = (workstreamId: string, overrides: Record<string, unknown> = {}) => ({
  workstream_id: workstreamId,
  current_stage: 'Specifying',
  progress: 'Drafted scope',
  next_step: 'Customer sign-off',
  help_requested: null,
  confidence: 'on_track' as const,
  updated_at: '2026-09-20T00:00:00Z',
  ...overrides,
})

describe('assembleAgencyDashboard', () => {
  it("groups builders under their agency with one row per client project, newest activity first", () => {
    const result = assembleAgencyDashboard({
      viewerIsAdmin: true,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-1', 'b1@example.com'), person('builder-2', 'b2@example.com')],
      roster: [{ builder_id: 'builder-1', agency_id: 'agency-1' }],
      projects: [
        { id: 'p-acme', name: 'Acme', status: 'active', owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' },
        { id: 'p-globex', name: 'Globex', status: 'review', owner_id: 'builder-1', updated_at: '2026-09-10T00:00:00Z' },
      ],
      workstreams: [
        { id: 'ws-1', project_id: 'p-acme', name: 'Discovery', status: 'active', updated_at: '2026-09-25T00:00:00Z' },
        { id: 'ws-2', project_id: 'p-acme', name: 'Old', status: 'completed', updated_at: '2026-08-01T00:00:00Z' },
      ],
      updates: [update('ws-1', { confidence: 'at_risk' })],
    })

    expect(result.agencies).toHaveLength(1)
    const [builder] = result.agencies[0].builders
    expect(builder.builderId).toBe('builder-1')
    expect(builder.projects.map((p) => p.name)).toEqual(['Acme', 'Globex'])
    expect(builder.projects[0]).toMatchObject({ workstreamCount: 2, activeWorkstreamCount: 1, lastActivityAt: '2026-09-25T00:00:00Z' })
    expect(builder.projects[0].latestUpdate).toMatchObject({ workstreamName: 'Discovery', confidence: 'at_risk' })
    expect(builder.projects[1].latestUpdate).toBeNull()
    expect(builder.lastActivityAt).toBe('2026-09-25T00:00:00Z')
    expect(builder.attention).toBe('at_risk')
    expect(result.unassigned.map((b) => b.builderId)).toEqual(['builder-2'])
  })

  it('ranks blocked above a help request above at risk', () => {
    const base = {
      viewerIsAdmin: false,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-1', 'b1@example.com')],
      roster: [{ builder_id: 'builder-1', agency_id: 'agency-1' }],
      projects: [
        { id: 'p1', name: 'One', status: 'active' as const, owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' },
        { id: 'p2', name: 'Two', status: 'active' as const, owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' },
      ],
      workstreams: [
        { id: 'ws-1', project_id: 'p1', name: 'A', status: 'active', updated_at: '2026-09-01T00:00:00Z' },
        { id: 'ws-2', project_id: 'p2', name: 'B', status: 'active', updated_at: '2026-09-01T00:00:00Z' },
      ],
    }
    const help = assembleAgencyDashboard({ ...base, updates: [update('ws-1', { confidence: 'at_risk' }), update('ws-2', { help_requested: 'Need a mentor' })] })
    expect(help.agencies[0].builders[0].attention).toBe('help_requested')

    const blocked = assembleAgencyDashboard({ ...base, updates: [update('ws-1', { confidence: 'blocked' }), update('ws-2', { help_requested: 'Need a mentor' })] })
    expect(blocked.agencies[0].builders[0].attention).toBe('blocked')
  })

  it('never lists unassigned builders for a curator', () => {
    const result = assembleAgencyDashboard({
      viewerIsAdmin: false,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-9', 'b9@example.com')],
      roster: [],
      projects: [],
      workstreams: [],
      updates: [],
    })
    expect(result.unassigned).toEqual([])
    expect(result.agencies[0].builders).toEqual([])
  })
})

describe('getAgencyDashboard', () => {
  it('rejects a caller who is neither curator nor admin', async () => {
    await expect(getAgencyDashboard(ctxWith(createFakeSupabase({}), { role: 'consultant' }))).rejects.toThrow('Requires curator or admin role')
  })

  it("scopes a curator to their own roster and reads nothing more when it's empty", async () => {
    const admin = createFakeSupabase({ agency_builders: [{ data: [], error: null }] })
    createAdminClientMock.mockReturnValue(admin)

    const result = await getAgencyDashboard(ctxWith(createFakeSupabase({})))

    expect(admin._calls).toContainEqual({ table: 'agency_builders', method: 'eq', args: { column: 'agency_id', value: 'agency-1' } })
    expect(admin._calls.some((c) => c.table === 'projects')).toBe(false)
    expect(result.agencies).toEqual([{ agencyId: 'agency-1', email: 'agency1@example.com', fullName: 'Agency One', builders: [] }])
  })

  it("loads a curator's builders, their non-archived projects and shared updates", async () => {
    const admin = createFakeSupabase({
      agency_builders: [{ data: [{ builder_id: 'builder-1', agency_id: 'agency-1' }], error: null }],
      profiles: [{ data: [person('builder-1', 'b1@example.com')], error: null }],
      projects: [{ data: [{ id: 'p1', name: 'Acme', status: 'active', owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' }], error: null }],
      project_workstreams: [{ data: [{ id: 'ws-1', project_id: 'p1', name: 'Discovery', status: 'active', updated_at: '2026-09-02T00:00:00Z' }], error: null }],
      builder_progress_updates: [{ data: [update('ws-1')], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await getAgencyDashboard(ctxWith(createFakeSupabase({})))

    expect(admin._calls).toContainEqual({ table: 'profiles', method: 'eq', args: { column: 'role', value: 'consultant' } })
    expect(admin._calls).toContainEqual({ table: 'builder_progress_updates', method: 'eq', args: { column: 'status', value: 'active' } })
    const [builder] = result.agencies[0].builders
    expect(builder.projects).toHaveLength(1)
    expect(builder.projects[0].latestUpdate?.currentStage).toBe('Specifying')
  })
})

describe('assignBuilderToAgency', () => {
  it('rejects anyone but the platform admin', async () => {
    await expect(assignBuilderToAgency(ctxWith(createFakeSupabase({})), 'builder-1', 'agency-1')).rejects.toThrow('Only the platform admin')
  })

  it('removes the roster row when the agency is cleared', async () => {
    const supabase = createFakeSupabase({ agency_builders: [{ data: null, error: null }] })
    await assignBuilderToAgency(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', null)
    expect(supabase._calls.some((c) => c.table === 'agency_builders' && c.method === 'delete')).toBe(true)
  })

  it('rejects an agency that is not a curator account', async () => {
    const supabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'builder-1', role: 'consultant' }, { id: 'other-1', role: 'consultant' }], error: null }],
    })
    await expect(assignBuilderToAgency(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', 'other-1')).rejects.toThrow(
      'An agency must be a curator account'
    )
  })

  it('upserts the roster row for a consultant and a curator', async () => {
    const supabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'builder-1', role: 'consultant' }, { id: 'agency-1', role: 'curator' }], error: null }],
      agency_builders: [{ data: null, error: null }],
    })
    await assignBuilderToAgency(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', 'agency-1')
    const upsert = supabase._calls.find((c) => c.table === 'agency_builders' && c.method === 'upsert')
    expect(upsert?.args).toEqual({ builder_id: 'builder-1', agency_id: 'agency-1', assigned_by: 'admin-1' })
  })
})
