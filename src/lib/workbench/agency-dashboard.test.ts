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

const empty = {
  presentations: [],
  promotions: [],
  viewerMembers: [],
  fees: [],
  pendingPromotionRows: [],
  platformRatePct: 10,
}

const noFee = { proposed_fee_amount: null, proposed_fee_currency: null, proposed_fee_period: null }

describe('assembleAgencyDashboard', () => {
  it('splits a builder into workspace proposals and the client projects promoted from them', () => {
    const result = assembleAgencyDashboard({
      ...empty,
      viewerIsAdmin: true,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-1', 'b1@example.com'), person('builder-2', 'b2@example.com')],
      roster: [{ builder_id: 'builder-1', agency_id: 'agency-1' }],
      projects: [
        { id: 'p-workspace', name: 'B1 Workspace', status: 'active', owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' },
        { id: 'p-acme', name: 'Acme', status: 'active', owner_id: 'builder-1', updated_at: '2026-09-10T00:00:00Z' },
      ],
      workstreams: [
        { id: 'ws-acme', project_id: 'p-workspace', name: 'Acme', status: 'completed', updated_at: '2026-09-05T00:00:00Z' },
        { id: 'ws-globex', project_id: 'p-workspace', name: 'Globex', status: 'active', updated_at: '2026-09-25T00:00:00Z' },
        { id: 'ws-old', project_id: 'p-workspace', name: 'Old', status: 'archived', updated_at: '2026-08-01T00:00:00Z' },
        { id: 'ws-delivery', project_id: 'p-acme', name: 'Delivery', status: 'active', updated_at: '2026-09-20T00:00:00Z' },
      ],
      updates: [update('ws-globex', { confidence: 'at_risk' })],
      presentations: [{ workstream_id: 'ws-globex', status: 'review_open' }],
      promotions: [
        {
          id: 'promo-1',
          workstream_id: 'ws-acme',
          submitted_by: 'builder-1',
          status: 'approved',
          client_emails: ['jane@acme.com'],
          ...noFee,
          created_project_id: 'p-acme',
          decided_at: '2026-09-10T00:00:00Z',
          created_at: '2026-09-06T00:00:00Z',
        },
      ],
      viewerMembers: [{ project_id: 'p-acme' }, { project_id: 'p-acme' }],
      fees: [{ project_id: 'p-acme', amount: 120000, currency: 'PHP', billing_period: 'annual', platform_rate_pct: 10 }],
    })

    const [builder] = result.agencies[0].builders
    expect(builder.proposals.map((p) => p.name)).toEqual(['Globex', 'Acme'])
    expect(builder.proposals[0]).toMatchObject({ presentationStatus: 'review_open', promotionStatus: null })
    expect(builder.proposals[1]).toMatchObject({ promotionStatus: 'approved' })
    expect(builder.clientProjects).toEqual([
      expect.objectContaining({
        id: 'p-acme',
        clientViewerCount: 2,
        createdAt: '2026-09-10T00:00:00Z',
        workstreamCount: 1,
        activeWorkstreamCount: 1,
        lastActivityAt: '2026-09-20T00:00:00Z',
        fee: { amount: 120000, currency: 'PHP', period: 'annual', platformRatePct: 10, monthlyAmount: 10000, platformMonthly: 1000 },
      }),
    ])
    expect(builder.lastActivityAt).toBe('2026-09-25T00:00:00Z')
    expect(builder.attention).toBe('at_risk')
    expect(result.unassigned.map((b) => b.builderId)).toEqual(['builder-2'])
  })

  it("attaches a pending client-project request to the builder who submitted it", () => {
    const pendingRow = {
      id: 'promo-2',
      workstreamName: 'Globex',
      projectName: 'B1 Workspace',
      submitterEmail: 'b1@example.com',
      approvedArtifactCount: 1,
      clientEmails: ['sam@globex.com'],
      proposedFee: null,
      createdAt: '2026-09-26T00:00:00Z',
    }
    const result = assembleAgencyDashboard({
      ...empty,
      viewerIsAdmin: false,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-1', 'b1@example.com')],
      roster: [{ builder_id: 'builder-1', agency_id: 'agency-1' }],
      projects: [],
      workstreams: [],
      updates: [],
      promotions: [
        {
          id: 'promo-2',
          workstream_id: 'ws-globex',
          submitted_by: 'builder-1',
          status: 'pending',
          client_emails: ['sam@globex.com'],
          ...noFee,
          created_project_id: null,
          decided_at: null,
          created_at: '2026-09-26T00:00:00Z',
        },
      ],
      pendingPromotionRows: [pendingRow],
    })
    expect(result.agencies[0].builders[0].pendingPromotions).toEqual([pendingRow])
  })

  it('ranks blocked above a help request above at risk', () => {
    const base = {
      ...empty,
      viewerIsAdmin: false,
      agencies: [person('agency-1', 'a@example.com')],
      builders: [person('builder-1', 'b1@example.com')],
      roster: [{ builder_id: 'builder-1', agency_id: 'agency-1' }],
      projects: [{ id: 'p1', name: 'Workspace', status: 'active' as const, owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' }],
      workstreams: [
        { id: 'ws-1', project_id: 'p1', name: 'A', status: 'active' as const, updated_at: '2026-09-01T00:00:00Z' },
        { id: 'ws-2', project_id: 'p1', name: 'B', status: 'active' as const, updated_at: '2026-09-01T00:00:00Z' },
      ],
    }
    const help = assembleAgencyDashboard({ ...base, updates: [update('ws-1', { confidence: 'at_risk' }), update('ws-2', { help_requested: 'Need a mentor' })] })
    expect(help.agencies[0].builders[0].attention).toBe('help_requested')

    const blocked = assembleAgencyDashboard({ ...base, updates: [update('ws-1', { confidence: 'blocked' }), update('ws-2', { help_requested: 'Need a mentor' })] })
    expect(blocked.agencies[0].builders[0].attention).toBe('blocked')
  })

  it('never lists unassigned builders for a curator', () => {
    const result = assembleAgencyDashboard({
      ...empty,
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

  it("loads a curator's builders, their projects, proposals and shared updates", async () => {
    const admin = createFakeSupabase({
      agency_builders: [{ data: [{ builder_id: 'builder-1', agency_id: 'agency-1' }], error: null }],
      profiles: [{ data: [person('builder-1', 'b1@example.com')], error: null }],
      projects: [{ data: [{ id: 'p1', name: 'Workspace', status: 'active', owner_id: 'builder-1', updated_at: '2026-09-01T00:00:00Z' }], error: null }],
      workstream_promotions: [{ data: [], error: null }],
      project_workstreams: [{ data: [{ id: 'ws-1', project_id: 'p1', name: 'Acme', status: 'active', updated_at: '2026-09-02T00:00:00Z' }], error: null }],
      project_members: [{ data: [], error: null }],
      builder_progress_updates: [{ data: [update('ws-1')], error: null }],
      presentations: [{ data: [{ workstream_id: 'ws-1', status: 'draft' }], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await getAgencyDashboard(ctxWith(createFakeSupabase({})))

    expect(admin._calls).toContainEqual({ table: 'profiles', method: 'eq', args: { column: 'role', value: 'consultant' } })
    expect(admin._calls).toContainEqual({ table: 'builder_progress_updates', method: 'eq', args: { column: 'status', value: 'active' } })
    const [builder] = result.agencies[0].builders
    expect(builder.proposals).toEqual([expect.objectContaining({ name: 'Acme', presentationStatus: 'draft' })])
    expect(builder.proposals[0].latestUpdate?.currentStage).toBe('Specifying')
    expect(builder.clientProjects).toEqual([])
    expect(result.platformRatePct).toBe(10)
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

  it('accepts the platform admin as an agency', async () => {
    const supabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'builder-1', role: 'consultant' }, { id: 'admin-1', role: 'admin' }], error: null }],
      agency_builders: [{ data: null, error: null }],
    })
    await assignBuilderToAgency(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', 'admin-1')
    const upsert = supabase._calls.find((c) => c.table === 'agency_builders' && c.method === 'upsert')
    expect(upsert?.args).toMatchObject({ agency_id: 'admin-1' })
  })

  it('rejects an agency that is not a curator account', async () => {
    const supabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'builder-1', role: 'consultant' }, { id: 'other-1', role: 'consultant' }], error: null }],
    })
    await expect(assignBuilderToAgency(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'builder-1', 'other-1')).rejects.toThrow(
      'An agency must be a curator or admin account'
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
