import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const {
  submitWorkstreamForPromotion,
  listPendingWorkstreamPromotions,
  listPendingWorkstreamPromotionsForProject,
  approveWorkstreamPromotion,
  rejectWorkstreamPromotion,
} = await import('./workstream-promotions')

beforeEach(() => {
  createAdminClientMock.mockReset()
})

function ctxWith(supabase: unknown, opts: { userId?: string; role?: string } = {}): WorkbenchCallerContext {
  return {
    user: { id: opts.userId ?? 'builder-1' },
    profile: { role: opts.role ?? 'consultant' },
    supabase,
  } as unknown as WorkbenchCallerContext
}

describe('submitWorkstreamForPromotion', () => {
  it('rejects a caller who is not an active member of this workstream\'s project', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: null, error: null }],
    })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')).rejects.toThrow('active member')
  })

  it('lets any active member submit, not just the Project owner (Enterprise team case)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
      workstream_artifacts: [{ data: [{ id: 'art-1' }], error: null }],
      workstream_promotions: [
        { data: null, error: null },
        { data: { id: 'promo-1' }, error: null },
      ],
    })
    const result = await submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')
    expect(result).toEqual({ promotionId: 'promo-1' })
  })

  it('rejects a workstream that is not completed', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'active' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
    })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')).rejects.toThrow('Only a completed workstream')
  })

  it('rejects a workstream with no approved artifacts', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
    })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')).rejects.toThrow('At least one approved artifact')
  })

  it('rejects a duplicate pending/approved promotion for the same workstream', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      workstream_artifacts: [{ data: [{ id: 'art-1' }], error: null }],
      workstream_promotions: [{ data: { id: 'existing-promo-1' }, error: null }],
    })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')).rejects.toThrow('already has a pending or approved promotion')
  })

  it('accepts a valid submission from the Project owner (Builder solo-Project case)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      workstream_artifacts: [{ data: [{ id: 'art-1' }], error: null }],
      workstream_promotions: [
        { data: null, error: null }, // no existing promotion
        { data: { id: 'promo-1' }, error: null }, // the insert
      ],
    })
    const result = await submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')
    expect(result).toEqual({ promotionId: 'promo-1' })
    const insert = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ workstream_id: 'ws-1', submitted_by: 'builder-1' })
  })
})

describe('submitWorkstreamForPromotion -- client emails', () => {
  const completedWorkstream = {
    project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
    project_members: [{ data: { role: 'owner' }, error: null }],
    workstream_artifacts: [{ data: [{ id: 'art-1' }], error: null }],
  }

  it('stores the client emails trimmed, lowercased and de-duplicated', async () => {
    const supabase = createFakeSupabase({
      ...completedWorkstream,
      workstream_promotions: [
        { data: null, error: null },
        { data: { id: 'promo-1' }, error: null },
      ],
    })
    await submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1', [' Jane@Acme.com ', 'jane@acme.com', '', 'sam@acme.com'])
    const insert = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ client_emails: ['jane@acme.com', 'sam@acme.com'] })
  })

  it('stores the maintenance fee the builder agreed with the client', async () => {
    const supabase = createFakeSupabase({
      ...completedWorkstream,
      workstream_promotions: [
        { data: null, error: null },
        { data: { id: 'promo-1' }, error: null },
      ],
    })
    await submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1', [], { amount: 25000.456, currency: 'PHP', period: 'monthly' })
    const insert = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ proposed_fee_amount: 25000.46, proposed_fee_currency: 'PHP', proposed_fee_period: 'monthly' })
  })

  it('rejects a malformed client email before writing anything', async () => {
    const supabase = createFakeSupabase(completedWorkstream)
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1', ['not-an-email'])).rejects.toThrow('Not a valid email address')
    expect(supabase._calls.some((c) => c.method === 'insert')).toBe(false)
  })
})

describe('listPendingWorkstreamPromotions', () => {
  it('returns an empty array when nothing is pending', async () => {
    const supabase = createFakeSupabase({ workstream_promotions: [{ data: [], error: null }] })
    const result = await listPendingWorkstreamPromotions(ctxWith(supabase))
    expect(result).toEqual([])
  })

  it('shapes pending promotions with workstream/project/submitter metadata via the admin client', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: [{ id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', client_emails: ['jane@acme.com'], created_at: '2026-09-06' }], error: null }],
    })
    const admin = createFakeSupabase({
      project_workstreams: [{ data: [{ id: 'ws-1', name: 'Acme Order Automation', project_id: 'proj-1' }], error: null }],
      projects: [{ data: [{ id: 'proj-1', name: 'builder1 — Builder Workspace' }], error: null }],
      profiles: [{ data: [{ id: 'builder-1', email: 'builder1@example.com' }], error: null }],
      workstream_artifacts: [{ data: [{ workstream_id: 'ws-1' }, { workstream_id: 'ws-1' }], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await listPendingWorkstreamPromotions(ctxWith(supabase))

    expect(result).toEqual([
      {
        id: 'promo-1',
        workstreamName: 'Acme Order Automation',
        projectName: 'builder1 — Builder Workspace',
        submitterEmail: 'builder1@example.com',
        approvedArtifactCount: 2,
        clientEmails: ['jane@acme.com'],
        proposedFee: null,
        createdAt: '2026-09-06',
      },
    ])
  })
})

describe('listPendingWorkstreamPromotionsForProject', () => {
  it('returns an empty array when the project has no workstreams', async () => {
    const supabase = createFakeSupabase({ project_workstreams: [{ data: [], error: null }] })
    const result = await listPendingWorkstreamPromotionsForProject(ctxWith(supabase), 'proj-1')
    expect(result).toEqual([])
  })

  it('scopes the promotion list to this project\'s own workstreams (RLS narrows the rest)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: [{ id: 'ws-1' }, { id: 'ws-2' }], error: null }],
      workstream_promotions: [{ data: [{ id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'member-1', client_emails: [], created_at: '2026-09-06' }], error: null }],
    })
    const admin = createFakeSupabase({
      project_workstreams: [{ data: [{ id: 'ws-1', name: 'VL Policy FAQ', project_id: 'proj-1' }], error: null }],
      projects: [{ data: [{ id: 'proj-1', name: 'HR Team Project' }], error: null }],
      profiles: [{ data: [{ id: 'member-1', email: 'member@example.com' }], error: null }],
      workstream_artifacts: [{ data: [{ workstream_id: 'ws-1' }], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await listPendingWorkstreamPromotionsForProject(ctxWith(supabase), 'proj-1')

    expect(result).toEqual([
      {
        id: 'promo-1',
        workstreamName: 'VL Policy FAQ',
        projectName: 'HR Team Project',
        submitterEmail: 'member@example.com',
        approvedArtifactCount: 1,
        clientEmails: [],
        proposedFee: null,
        createdAt: '2026-09-06',
      },
    ])
    const inQuery = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'eq')
    expect(inQuery).toBeDefined()
  })
})

describe('approveWorkstreamPromotion', () => {
  it('rejects the submitter deciding their own promotion, even if they hold owner/curator on that Project', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending' }, error: null }],
    })
    await expect(approveWorkstreamPromotion(ctxWith(supabase, { userId: 'builder-1', role: 'consultant' }), 'promo-1')).rejects.toThrow(
      'cannot decide a promotion you submitted yourself'
    )
  })

  it('rejects a caller who is neither admin nor this Project\'s own owner/curator', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'member-1', status: 'pending' }, error: null }],
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(approveWorkstreamPromotion(ctxWith(supabase, { userId: 'other-1', role: 'consultant' }), 'promo-1')).rejects.toThrow(
      'owner or curator role'
    )
  })

  it('is a no-op on a promotion that is no longer pending', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', submitted_by: 'someone-else', status: 'approved' }, error: null }],
    })
    await expect(approveWorkstreamPromotion(ctxWith(supabase, { role: 'admin' }), 'promo-1')).rejects.toThrow('already been decided')
  })

  function builderProposalAdmin(overrides: Record<string, { data: unknown; error: null }[]> = {}) {
    return createFakeSupabase({
      project_workstreams: [
        { data: { id: 'ws-1', name: 'Acme Order Automation', project_id: 'workspace-1' }, error: null },
        { data: { id: 'new-ws-1' }, error: null }, // new workstream insert
      ],
      projects: [
        { data: { owner_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null }, // source project
        { data: { id: 'new-proj-1' }, error: null }, // new project insert
      ],
      workstream_artifacts: [
        { data: [{ artifact_type: 'design_note', title: 'Architecture', external_tool: null, content: 'text', external_url: null, notes: null, created_by: 'builder-1' }], error: null },
      ],
      agency_builders: [{ data: { agency_id: 'agency-1' }, error: null }],
      ...overrides,
    })
  }

  it('turns a builder\'s accepted proposal into a client Project the builder owns, with their agency as curator (admin deciding)', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending', client_emails: [] }, error: null },
        { data: [{ id: 'promo-1' }], error: null }, // decision update
      ],
    })
    const admin = builderProposalAdmin()
    createAdminClientMock.mockReturnValue(admin)

    const result = await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'operator-1', role: 'admin' }), 'promo-1')

    expect(result).toEqual({ createdProjectId: 'new-proj-1', clientViewers: [] })
    const projectInsert = admin._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(projectInsert?.args).toMatchObject({ name: 'Acme Order Automation', owner_id: 'builder-1', portfolio_category: 'builder_lab' })
    const memberInsert = admin._calls.find((c) => c.table === 'project_members' && c.method === 'insert')
    expect(memberInsert?.args).toMatchObject({ project_id: 'new-proj-1', user_id: 'agency-1', role: 'curator', status: 'active' })
    const artifactInsert = admin._calls.find((c) => c.table === 'workstream_artifacts' && c.method === 'insert')
    expect(artifactInsert?.args).toMatchObject([expect.objectContaining({ workstream_id: 'new-ws-1', title: 'Architecture', status: 'approved' })])
    const decisionUpdate = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'update')
    expect(decisionUpdate?.args).toMatchObject({ status: 'approved', decided_by: 'operator-1', created_project_id: 'new-proj-1' })
  })

  it('records the proposed fee, split for a builder-found client: Ember\'s cut and the builder keeps the rest', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        {
          data: {
            id: 'promo-1',
            workstream_id: 'ws-1',
            submitted_by: 'builder-1',
            status: 'pending',
            client_emails: [],
            proposed_fee_amount: 1200,
            proposed_fee_currency: 'USD',
            proposed_fee_period: 'annual',
          },
          error: null,
        },
        { data: [{ id: 'promo-1' }], error: null },
      ],
    })
    const admin = builderProposalAdmin({ settings: [{ data: { value: { platformRatePct: 12.5 } }, error: null }] })
    createAdminClientMock.mockReturnValue(admin)

    await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'operator-1', role: 'admin' }), 'promo-1')

    const feeInsert = admin._calls.find((c) => c.table === 'client_project_fees' && c.method === 'insert')
    expect(feeInsert?.args).toEqual({
      project_id: 'new-proj-1',
      amount: 1200,
      currency: 'USD',
      billing_period: 'annual',
      platform_rate_pct: 12.5,
      builder_share_pct: 87.5,
      set_by: 'operator-1',
    })
  })

  it('lets the builder\'s own agency decide, without being a member of the builder\'s workspace', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending', client_emails: [] }, error: null },
        { data: [{ id: 'promo-1' }], error: null },
      ],
      agency_builders: [{ data: { builder_id: 'builder-1' }, error: null }],
    })
    createAdminClientMock.mockReturnValue(builderProposalAdmin())

    const result = await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'agency-1', role: 'curator' }), 'promo-1')

    expect(result.createdProjectId).toBe('new-proj-1')
    expect(supabase._calls.some((c) => c.table === 'project_members')).toBe(false)
  })

  it('rejects a curator who is not this builder\'s agency', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending' }, error: null }],
      agency_builders: [{ data: null, error: null }],
      project_workstreams: [{ data: { project_id: 'workspace-1' }, error: null }],
      project_members: [{ data: null, error: null }],
    })
    await expect(approveWorkstreamPromotion(ctxWith(supabase, { userId: 'agency-2', role: 'curator' }), 'promo-1')).rejects.toThrow(
      "the builder's agency"
    )
  })

  it('adds the client as viewers -- an existing account directly, a new one with a temporary password', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        {
          data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending', client_emails: ['jane@acme.com', 'sam@acme.com'] },
          error: null,
        },
        { data: [{ id: 'promo-1' }], error: null },
      ],
    })
    const fake = builderProposalAdmin({
      projects: [
        { data: { owner_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null },
        { data: { id: 'new-proj-1' }, error: null },
        { data: null, error: null }, // enrollInOrganizationHome: no org home
      ],
      profiles: [
        { data: { id: 'jane-1' }, error: null }, // jane exists
        { data: null, error: null }, // sam doesn't
        { data: null, error: null }, // sam's profile insert
      ],
    })
    const createUser = vi.fn().mockResolvedValue({ data: { user: { id: 'sam-1' } }, error: null })
    const admin = Object.assign(fake, { auth: { admin: { createUser } } })
    createAdminClientMock.mockReturnValue(admin)

    const result = await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'operator-1', role: 'admin' }), 'promo-1')

    expect(result.clientViewers).toEqual([
      { email: 'jane@acme.com', status: 'added' },
      { email: 'sam@acme.com', status: 'created', password: expect.any(String) },
    ])
    expect(createUser).toHaveBeenCalledWith(expect.objectContaining({ email: 'sam@acme.com', email_confirm: true }))
    const profileInsert = admin._calls.find((c) => c.table === 'profiles' && c.method === 'insert')
    expect(profileInsert?.args).toMatchObject({ id: 'sam-1', role: 'member' })
    const viewerUpserts = admin._calls.filter((c) => c.table === 'project_members' && c.method === 'upsert').map((c) => c.args)
    expect(viewerUpserts).toEqual([
      { project_id: 'new-proj-1', user_id: 'jane-1', role: 'viewer', status: 'active' },
      { project_id: 'new-proj-1', user_id: 'sam-1', role: 'viewer', status: 'active' },
    ])
  })

  it('lets an ordinary team\'s own curator decide -- platform role merely consultant, project role curator (HR Manager case)', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'member-1', status: 'pending' }, error: null },
        { data: [{ id: 'promo-1' }], error: null }, // decision update
      ],
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }], // requirePromotionDecider's own lookup
      project_members: [{ data: { role: 'curator' }, error: null }], // getActiveProjectRole
    })
    const admin = createFakeSupabase({
      project_workstreams: [
        { data: { id: 'ws-1', name: 'VL Policy FAQ', project_id: 'proj-1' }, error: null },
        { data: { id: 'new-ws-1' }, error: null },
      ],
      projects: [
        { data: { owner_id: 'hr-manager-1', portfolio_category: 'other' }, error: null },
        { data: { id: 'new-proj-1' }, error: null },
      ],
      workstream_artifacts: [{ data: [], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'hr-manager-1', role: 'consultant' }), 'promo-1')

    expect(result).toEqual({ createdProjectId: 'new-proj-1', clientViewers: [] })
    const projectInsert = admin._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(projectInsert?.args).toEqual({ name: 'VL Policy FAQ', project_type: 'consulting', owner_id: 'hr-manager-1' })
    const memberInsert = admin._calls.find((c) => c.table === 'project_members' && c.method === 'insert')
    expect(memberInsert?.args).toMatchObject({ project_id: 'new-proj-1', user_id: 'member-1', role: 'consultant', status: 'active' })
  })
})

describe('Builder edition rules (20261028100001)', () => {
  const builderWorkspace = (project: Record<string, unknown>, overrides: Record<string, { data: unknown; error: null }[]> = {}) =>
    createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1', project_id: 'proj-1', status: 'completed' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
      projects: [{ data: project, error: null }],
      workstream_artifacts: [{ data: [{ id: 'art-1' }], error: null }],
      workstream_promotions: [
        { data: null, error: null },
        { data: { id: 'promo-1' }, error: null },
      ],
      ...overrides,
    })

  it("only lets a builder's Project's builder of record request promotion -- not a builder they invited", async () => {
    const supabase = builderWorkspace({ owner_id: 'builder-1', builder_id: null, portfolio_category: 'builder_lab' })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase, { userId: 'invited-1' }), 'ws-1', [], null, true)).rejects.toThrow(
      'Only the builder who owns this work'
    )
  })

  it("requires the builder to confirm their client agreed", async () => {
    const supabase = builderWorkspace({ owner_id: 'builder-1', builder_id: null, portfolio_category: 'builder_lab' })
    await expect(submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1')).rejects.toThrow('client has agreed')
  })

  it('lets the builder of record request promotion from a client Project the agency took over at go-live', async () => {
    const supabase = builderWorkspace({ owner_id: 'agency-1', builder_id: 'builder-1', portfolio_category: 'builder_lab' })
    const result = await submitWorkstreamForPromotion(ctxWith(supabase), 'ws-1', [], null, true)
    expect(result).toEqual({ promotionId: 'promo-1' })
    const insert = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ submitted_by: 'builder-1', client_agreed_at: expect.any(String) })
  })

  it("approves the platform admin's own promotion straight away, with the admin as owner and builder", async () => {
    const supabase = builderWorkspace(
      { owner_id: 'admin-1', builder_id: null, portfolio_category: 'other' },
      {
        project_members: [{ data: { role: 'owner' }, error: null }],
        workstream_promotions: [
          { data: null, error: null },
          { data: { id: 'promo-1' }, error: null },
          { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'admin-1', status: 'pending', client_emails: [] }, error: null },
        ],
      }
    )
    const admin = createFakeSupabase({
      project_workstreams: [
        { data: { id: 'ws-1', name: 'Ember Pilot', project_id: 'proj-1' }, error: null },
        { data: { id: 'new-ws-1' }, error: null },
      ],
      projects: [
        { data: { owner_id: 'admin-1', builder_id: null, portfolio_category: 'other' }, error: null },
        { data: { id: 'new-proj-1' }, error: null },
      ],
      workstream_artifacts: [{ data: [], error: null }],
      agency_builders: [{ data: null, error: null }],
      workstream_promotions: [{ data: [{ id: 'promo-1' }], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await submitWorkstreamForPromotion(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'ws-1', [], null, true)

    expect(result).toEqual({ promotionId: 'promo-1', createdProjectId: 'new-proj-1', clientViewers: [] })
    const projectInsert = admin._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(projectInsert?.args).toMatchObject({ owner_id: 'admin-1', builder_id: 'admin-1', client_source: 'ember' })
    expect(admin._calls.some((c) => c.table === 'project_members' && c.method === 'insert')).toBe(false)
    const decisionUpdate = admin._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'update')
    expect(decisionUpdate?.args).toMatchObject({ status: 'approved', decided_by: 'admin-1', created_project_id: 'new-proj-1' })
  })

  it("makes the builder of record the new Project's owner and builder when promoting from a client Project after go-live", async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending', client_emails: [] }, error: null },
        { data: [{ id: 'promo-1' }], error: null },
      ],
    })
    const admin = createFakeSupabase({
      project_workstreams: [
        { data: { id: 'ws-1', name: 'Phase 2', project_id: 'client-proj-1' }, error: null },
        { data: { id: 'new-ws-1' }, error: null },
      ],
      projects: [
        { data: { owner_id: 'agency-1', builder_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null },
        { data: { id: 'new-proj-1' }, error: null },
      ],
      workstream_artifacts: [{ data: [], error: null }],
      agency_builders: [{ data: { agency_id: 'agency-1' }, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'agency-1', role: 'admin' }), 'promo-1')

    const projectInsert = admin._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(projectInsert?.args).toMatchObject({ owner_id: 'builder-1', builder_id: 'builder-1', portfolio_category: 'builder_lab' })
  })

  it("records the fee at the builder's own cut", async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        {
          data: {
            id: 'promo-1',
            workstream_id: 'ws-1',
            submitted_by: 'builder-1',
            status: 'pending',
            client_emails: [],
            proposed_fee_amount: 500,
            proposed_fee_currency: 'USD',
            proposed_fee_period: 'monthly',
          },
          error: null,
        },
        { data: [{ id: 'promo-1' }], error: null },
      ],
    })
    const admin = builderProposalAdminFor({ builder_billing_shares: [{ data: { share_pct: null, platform_rate_pct: 6 }, error: null }] })
    createAdminClientMock.mockReturnValue(admin)

    await approveWorkstreamPromotion(ctxWith(supabase, { userId: 'operator-1', role: 'admin' }), 'promo-1')

    const feeInsert = admin._calls.find((c) => c.table === 'client_project_fees' && c.method === 'insert')
    expect(feeInsert?.args).toMatchObject({ platform_rate_pct: 6, builder_share_pct: 94 })
    const projectInsert = admin._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(projectInsert?.args).toMatchObject({ client_source: 'builder' })
  })

  it("never lets another curator on a builder's Project decide -- only the agency or the admin", async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending' }, error: null }],
      project_workstreams: [{ data: { project_id: 'client-proj-1' }, error: null }],
      projects: [{ data: { portfolio_category: 'builder_lab' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    await expect(approveWorkstreamPromotion(ctxWith(supabase, { userId: 'invited-1', role: 'consultant' }), 'promo-1')).rejects.toThrow(
      "Only the builder's agency or the platform admin"
    )
  })
})

function builderProposalAdminFor(overrides: Record<string, { data: unknown; error: null }[]> = {}) {
  return createFakeSupabase({
    project_workstreams: [
      { data: { id: 'ws-1', name: 'Acme Order Automation', project_id: 'workspace-1' }, error: null },
      { data: { id: 'new-ws-1' }, error: null },
    ],
    projects: [
      { data: { owner_id: 'builder-1', portfolio_category: 'builder_lab' }, error: null },
      { data: { id: 'new-proj-1' }, error: null },
    ],
    workstream_artifacts: [{ data: [], error: null }],
    agency_builders: [{ data: { agency_id: 'agency-1' }, error: null }],
    ...overrides,
  })
}

describe('rejectWorkstreamPromotion', () => {
  it('rejects the submitter deciding their own promotion', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'builder-1', status: 'pending' }, error: null }],
    })
    await expect(rejectWorkstreamPromotion(ctxWith(supabase, { userId: 'builder-1' }), 'promo-1')).rejects.toThrow(
      'cannot decide a promotion you submitted yourself'
    )
  })

  it('rejects a caller who is neither admin nor this Project\'s own owner/curator', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [{ data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'member-1', status: 'pending' }, error: null }],
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(rejectWorkstreamPromotion(ctxWith(supabase, { userId: 'other-1', role: 'consultant' }), 'promo-1')).rejects.toThrow(
      'owner or curator role'
    )
  })

  it('flips status to rejected with no side effects on Projects/Workstreams', async () => {
    const supabase = createFakeSupabase({
      workstream_promotions: [
        { data: { id: 'promo-1', workstream_id: 'ws-1', submitted_by: 'member-1', status: 'pending' }, error: null },
        { data: [{ id: 'promo-1' }], error: null },
      ],
    })
    await rejectWorkstreamPromotion(ctxWith(supabase, { userId: 'operator-1', role: 'admin' }), 'promo-1', 'Not viable yet')
    const decisionUpdate = supabase._calls.find((c) => c.table === 'workstream_promotions' && c.method === 'update')
    expect(decisionUpdate?.args).toMatchObject({ status: 'rejected', decided_by: 'operator-1', decision_reason: 'Not viable yet' })
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })
})
