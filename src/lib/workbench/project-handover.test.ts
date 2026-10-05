import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

vi.mock('@/lib/knowledge-bases', () => ({ requireActiveKnowledgeBase: vi.fn() }))
const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { handOverLiveProjectToAgency, isOwnBuilderLabProject } = await import('./projects')

beforeEach(() => {
  createAdminClientMock.mockReset()
})

// At go-live a builder's Project passes to their agency; the builder stays
// on as curator and as the builder of record.
describe('handOverLiveProjectToAgency', () => {
  it("makes the builder's agency the owner and keeps the builder as curator and builder of record", async () => {
    const admin = createFakeSupabase({
      projects: [
        { data: { owner_id: 'builder-1', builder_id: null }, error: null },
        { data: null, error: null },
      ],
      agency_builders: [{ data: { agency_id: 'agency-1' }, error: null }],
      project_members: [
        { data: null, error: null },
        { data: null, error: null },
      ],
    })
    createAdminClientMock.mockReturnValue(admin)

    expect(await handOverLiveProjectToAgency('p-1')).toEqual({ agencyId: 'agency-1' })

    const calls = admin._calls
    expect(calls).toContainEqual({ table: 'projects', method: 'update', args: { owner_id: 'agency-1', builder_id: 'builder-1' } })
    expect(calls).toContainEqual({
      table: 'project_members',
      method: 'upsert',
      args: { project_id: 'p-1', user_id: 'agency-1', role: 'owner', status: 'active' },
    })
    expect(calls).toContainEqual({ table: 'project_members', method: 'update', args: { role: 'curator' } })
    expect(calls).toContainEqual({ table: 'project_members', method: 'eq', args: { column: 'user_id', value: 'builder-1' } })
  })

  it('keeps an existing builder of record', async () => {
    const admin = createFakeSupabase({
      projects: [{ data: { owner_id: 'builder-2', builder_id: 'builder-1' }, error: null }],
      agency_builders: [{ data: { agency_id: 'agency-1' }, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    await handOverLiveProjectToAgency('p-1')
    expect(admin._calls).toContainEqual({ table: 'projects', method: 'update', args: { owner_id: 'agency-1', builder_id: 'builder-1' } })
  })

  it("leaves a project alone when its owner is on no agency's roster", async () => {
    const admin = createFakeSupabase({
      projects: [{ data: { owner_id: 'curator-1', builder_id: null }, error: null }],
      agency_builders: [{ data: null, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    expect(await handOverLiveProjectToAgency('p-1')).toBeNull()
    expect(admin._calls.some((c) => c.method === 'update' || c.method === 'upsert')).toBe(false)
  })
})

describe('isOwnBuilderLabProject', () => {
  const ctx = (userId: string, project: unknown) =>
    ({ user: { id: userId }, supabase: createFakeSupabase({ projects: [{ data: project, error: null }] }) }) as never

  it("counts a taken-over Live project as the builder's, not the agency's", async () => {
    const project = { owner_id: 'agency-1', builder_id: 'builder-1', portfolio_category: 'builder_lab' }
    expect(await isOwnBuilderLabProject(ctx('builder-1', project), 'p-1')).toBe(true)
    expect(await isOwnBuilderLabProject(ctx('agency-1', project), 'p-1')).toBe(false)
  })

  it("counts the builder's own workspace", async () => {
    expect(await isOwnBuilderLabProject(ctx('builder-1', { owner_id: 'builder-1', builder_id: null, portfolio_category: 'builder_lab' }), 'p-1')).toBe(true)
  })
})
