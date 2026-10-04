import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { listProjectsAwaitingApproval, rejectProjectCreation } = await import('./project-approval')

function ctxFor(id: string, role: string): WorkbenchCallerContext {
  return { user: { id }, profile: { role } } as unknown as WorkbenchCallerContext
}

const pendingProject = (id: string, ownerId: string) => ({
  id,
  name: id,
  project_type: 'consulting',
  objective: null,
  owner_id: ownerId,
  pending_members: [],
  created_at: '2026-10-04T00:00:00Z',
})

beforeEach(() => {
  createAdminClientMock.mockReset()
})

// One rule for every deployment: a creator on an agency's roster is decided
// by that agency (or the admin); a creator on no roster by any curator.
describe('listProjectsAwaitingApproval', () => {
  it('shows a curator their own builders\' projects and unrostered creators\', not another agency\'s', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [
          {
            data: [pendingProject('p-mine', 'b-mine'), pendingProject('p-other', 'b-other'), pendingProject('p-free', 'c-free')],
            error: null,
          },
        ],
        agency_builders: [
          {
            data: [
              { builder_id: 'b-mine', agency_id: 'agency-1' },
              { builder_id: 'b-other', agency_id: 'agency-2' },
            ],
            error: null,
          },
        ],
        profiles: [{ data: [], error: null }],
      })
    )

    const rows = await listProjectsAwaitingApproval(ctxFor('agency-1', 'curator'))
    expect(rows.map((r) => r.id)).toEqual(['p-mine', 'p-free'])
  })

  it('shows the admin every pending project', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: [pendingProject('p-1', 'b-1'), pendingProject('p-2', 'b-2')], error: null }],
        profiles: [{ data: [], error: null }],
      })
    )

    const rows = await listProjectsAwaitingApproval(ctxFor('admin-1', 'admin'))
    expect(rows.map((r) => r.id)).toEqual(['p-1', 'p-2'])
  })
})

describe('rejectProjectCreation -- who may decide', () => {
  const project = { id: 'p-1', name: 'P', owner_id: 'b-1', approval_status: 'pending', pending_members: [] }

  it('refuses a curator from a different agency than the creator\'s', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        projects: [{ data: project, error: null }],
        agency_builders: [{ data: { agency_id: 'agency-2' }, error: null }],
      })
    )

    await expect(rejectProjectCreation(ctxFor('agency-1', 'curator'), 'p-1', 'Needs scope')).rejects.toThrow(
      "Only the creator's agency curator or a platform admin can decide this project"
    )
  })

  it('lets any curator decide for a creator on no agency\'s roster', async () => {
    const admin = createFakeSupabase({
      projects: [
        { data: project, error: null },
        { data: { id: 'p-1' }, error: null },
      ],
      agency_builders: [{ data: null, error: null }],
      project_notes: [{ data: null, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    await rejectProjectCreation(ctxFor('curator-1', 'curator'), 'p-1', 'Needs scope')
    expect(admin._calls).toContainEqual(expect.objectContaining({ table: 'projects', method: 'update' }))
  })

  it('refuses a consultant', async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({ projects: [{ data: project, error: null }] }))

    await expect(rejectProjectCreation(ctxFor('c-1', 'consultant'), 'p-1', 'Needs scope')).rejects.toThrow(
      'Only a curator or platform admin can decide this project'
    )
  })
})
