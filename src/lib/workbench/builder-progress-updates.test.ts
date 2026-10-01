import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { shareBuilderUpdate, withdrawBuilderUpdate, listBuilderOperationsRows } = await import('./builder-progress-updates')

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

const validInput = {
  currentStage: 'Specifying',
  opportunityLabel: 'Acme alias',
  progress: 'Drafted the endpoint inventory',
  nextStep: 'Get sign-off on scope',
  helpRequested: null,
  confidence: 'on_track' as const,
}

describe('shareBuilderUpdate', () => {
  it('rejects an anonymous caller', async () => {
    const supabase = createFakeSupabase({})
    await expect(shareBuilderUpdate(ctxWith(supabase, { role: 'anonymous' }), 'ws-1', validInput)).rejects.toThrow(
      'Create an account'
    )
  })

  it("rejects a caller who is not this workstream's own Project owner", async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(shareBuilderUpdate(ctxWith(supabase), 'ws-1', validInput)).rejects.toThrow(
      "Only this workstream's own Project owner"
    )
  })

  it('lets a platform admin share on any workstream (admin bypass)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: null, error: null }],
      builder_progress_updates: [
        { data: null, error: null }, // no existing update
        { data: null, error: null }, // insert
      ],
    })
    await shareBuilderUpdate(ctxWith(supabase, { userId: 'admin-1', role: 'admin' }), 'ws-1', validInput)
    const insert = supabase._calls.find((c) => c.table === 'builder_progress_updates' && c.method === 'insert')
    expect(insert).toBeDefined()
  })

  it('rejects missing required fields', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      builder_progress_updates: [{ data: null, error: null }],
    })
    await expect(shareBuilderUpdate(ctxWith(supabase), 'ws-1', { ...validInput, progress: '   ' })).rejects.toThrow(
      'Progress is required'
    )
  })

  it('inserts a new update when none exists yet', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      builder_progress_updates: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    })
    await shareBuilderUpdate(ctxWith(supabase), 'ws-1', validInput)
    const insert = supabase._calls.find((c) => c.table === 'builder_progress_updates' && c.method === 'insert')
    expect(insert?.args).toMatchObject({
      workstream_id: 'ws-1',
      submitted_by: 'builder-1',
      current_stage: 'Specifying',
      progress: 'Drafted the endpoint inventory',
      next_step: 'Get sign-off on scope',
      confidence: 'on_track',
      status: 'active',
    })
  })

  it('replaces an existing update in place (upsert-by-workstream, not a history row)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      builder_progress_updates: [
        { data: { id: 'update-1' }, error: null },
        { data: null, error: null },
      ],
    })
    await shareBuilderUpdate(ctxWith(supabase), 'ws-1', { ...validInput, currentStage: 'Building' })
    const update = supabase._calls.find((c) => c.table === 'builder_progress_updates' && c.method === 'update')
    expect(update?.args).toMatchObject({ current_stage: 'Building', status: 'active' })
    const insert = supabase._calls.find((c) => c.table === 'builder_progress_updates' && c.method === 'insert')
    expect(insert).toBeUndefined()
  })
})

describe('withdrawBuilderUpdate', () => {
  it('rejects a non-owner caller', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(withdrawBuilderUpdate(ctxWith(supabase), 'ws-1')).rejects.toThrow(
      "Only this workstream's own Project owner"
    )
  })

  it('flips status to withdrawn', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      builder_progress_updates: [{ data: [{ id: 'update-1' }], error: null }],
    })
    await withdrawBuilderUpdate(ctxWith(supabase), 'ws-1')
    const update = supabase._calls.find((c) => c.table === 'builder_progress_updates' && c.method === 'update')
    expect(update?.args).toEqual({ status: 'withdrawn' })
  })

  it('rejects withdrawing when there is no active update', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'proj-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
      builder_progress_updates: [{ data: [], error: null }],
    })
    await expect(withdrawBuilderUpdate(ctxWith(supabase), 'ws-1')).rejects.toThrow('No active update to withdraw')
  })
})

describe('listBuilderOperationsRows', () => {
  it('rejects a caller who is neither curator nor admin', async () => {
    const supabase = createFakeSupabase({})
    await expect(listBuilderOperationsRows(ctxWith(supabase, { role: 'consultant' }))).rejects.toThrow(
      'Requires curator or admin role'
    )
  })

  it('returns an empty array when there are no builder_lab Projects', async () => {
    const supabase = createFakeSupabase({})
    const admin = createFakeSupabase({ projects: [{ data: [], error: null }] })
    createAdminClientMock.mockReturnValue(admin)
    const result = await listBuilderOperationsRows(ctxWith(supabase, { role: 'admin' }))
    expect(result).toEqual([])
  })

  it('shapes a row with account state, activity, workstream count, latest active update, and per-builder spend -- still omitting milestone fields', async () => {
    const supabase = createFakeSupabase({})
    const admin = createFakeSupabase({
      projects: [{ data: [{ id: 'proj-1', owner_id: 'builder-1' }], error: null }],
      profiles: [{ data: [{ id: 'builder-1', email: 'builder1@example.com', is_active: true }], error: null }],
      project_workstreams: [
        {
          data: [
            { id: 'ws-1', project_id: 'proj-1', name: 'Acme Order Automation', status: 'active', updated_at: '2026-09-05T00:00:00Z' },
            { id: 'ws-2', project_id: 'proj-1', name: 'Old Workstream', status: 'completed', updated_at: '2026-09-01T00:00:00Z' },
          ],
          error: null,
        },
      ],
      builder_progress_updates: [
        {
          data: [
            {
              workstream_id: 'ws-1',
              current_stage: 'Specifying',
              opportunity_label: 'Acme alias',
              progress: 'Drafted the endpoint inventory',
              next_step: 'Get sign-off on scope',
              help_requested: null,
              confidence: 'on_track',
              updated_at: '2026-09-05T00:00:00Z',
            },
          ],
          error: null,
        },
      ],
      // getBuilderSpendSummary's own three lookups -- all empty, so this
      // builder falls back to the platform default allowance with nothing
      // spent yet.
      builder_ai_allowances: [{ data: null, error: null }],
      builder_credit_grants: [{ data: [], error: null }],
      ai_operation_logs: [{ data: [], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await listBuilderOperationsRows(ctxWith(supabase, { role: 'curator' }))

    expect(result).toEqual([
      {
        builderId: 'builder-1',
        builderEmail: 'builder1@example.com',
        isActive: true,
        lastActivityAt: '2026-09-05T00:00:00Z',
        activeWorkstreamCount: 1,
        latestUpdate: {
          workstreamName: 'Acme Order Automation',
          currentStage: 'Specifying',
          opportunityLabel: 'Acme alias',
          progress: 'Drafted the endpoint inventory',
          nextStep: 'Get sign-off on scope',
          helpRequested: null,
          confidence: 'on_track',
          updatedAt: '2026-09-05T00:00:00Z',
        },
        spend: {
          allowanceUsd: 20,
          creditsUsd: 0,
          spentThisPeriodUsd: 0,
          remainingUsd: 20,
          warningThresholdPct: 80,
          stopAtAllowance: true,
        },
      },
    ])
    expect(result[0]).not.toHaveProperty('milestoneEvidenceStatus')
  })

  it('rolls every client Project a builder owns into one row', async () => {
    const supabase = createFakeSupabase({})
    const admin = createFakeSupabase({
      projects: [
        {
          data: [
            { id: 'proj-1', owner_id: 'builder-1' },
            { id: 'proj-2', owner_id: 'builder-1' },
          ],
          error: null,
        },
      ],
      profiles: [{ data: [{ id: 'builder-1', email: 'builder1@example.com', is_active: true }], error: null }],
      project_workstreams: [
        {
          data: [
            { id: 'ws-1', project_id: 'proj-1', name: 'Acme', status: 'active', updated_at: '2026-09-05T00:00:00Z' },
            { id: 'ws-2', project_id: 'proj-2', name: 'Globex', status: 'active', updated_at: '2026-09-08T00:00:00Z' },
          ],
          error: null,
        },
      ],
      builder_progress_updates: [{ data: [], error: null }],
      builder_ai_allowances: [{ data: null, error: null }],
      builder_credit_grants: [{ data: [], error: null }],
      ai_operation_logs: [{ data: [], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await listBuilderOperationsRows(ctxWith(supabase, { role: 'curator' }))

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ builderId: 'builder-1', activeWorkstreamCount: 2, lastActivityAt: '2026-09-08T00:00:00Z' })
  })
})
