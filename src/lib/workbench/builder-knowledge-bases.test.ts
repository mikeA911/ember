import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { setBuilderKnowledgeBases } = await import('./builder-knowledge-bases')

beforeEach(() => createAdminClientMock.mockReset())

const ctx = (role = 'admin') => ({ user: { id: 'admin-1' }, profile: { role }, supabase: createFakeSupabase({}) }) as unknown as WorkbenchCallerContext

describe('setBuilderKnowledgeBases', () => {
  it('is admin only', async () => {
    await expect(setBuilderKnowledgeBases(ctx('curator'), 'builder-1', ['kb-a'])).rejects.toThrow('Only the platform admin')
  })

  it('only assigns to builders', async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({ profiles: [{ data: { id: 'u-1', role: 'member' }, error: null }] }))
    await expect(setBuilderKnowledgeBases(ctx(), 'u-1', ['kb-a'])).rejects.toThrow('only be assigned to a builder')
  })

  it('refuses a knowledge base that is not active', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        profiles: [{ data: { id: 'builder-1', role: 'consultant' }, error: null }],
        knowledge_bases: [{ data: [{ id: 'kb-a' }], error: null }],
      })
    )
    await expect(setBuilderKnowledgeBases(ctx(), 'builder-1', ['kb-a', 'kb-old'])).rejects.toThrow('Not an active knowledge base: kb-old')
  })

  it("records the assignment and syncs the builder's workspace, leaving the builder's own attachments alone", async () => {
    const admin = createFakeSupabase({
      profiles: [{ data: { id: 'builder-1', role: 'consultant' }, error: null }],
      knowledge_bases: [{ data: [{ id: 'kb-a' }, { id: 'kb-b' }], error: null }],
      // workspaceIdsOf: owned builder_lab projects, then which were promoted.
      projects: [{ data: [{ id: 'ws-1' }], error: null }],
      workstream_promotions: [{ data: [], error: null }],
      project_knowledge_bases: [
        {
          data: [
            { id: 'link-old', knowledge_base_id: 'kb-old', purpose: 'assigned_by_platform' },
            { id: 'link-own', knowledge_base_id: 'kb-own', purpose: null },
            { id: 'link-a', knowledge_base_id: 'kb-a', purpose: 'assigned_by_platform' },
          ],
          error: null,
        },
      ],
    })
    createAdminClientMock.mockReturnValue(admin)

    await setBuilderKnowledgeBases(ctx(), 'builder-1', ['kb-a', 'kb-b'])

    expect(admin._calls).toContainEqual({ table: 'profiles', method: 'update', args: { assigned_kbs: ['kb-a', 'kb-b'] } })
    const deletes = admin._calls.filter((c) => c.table === 'project_knowledge_bases' && c.method === 'delete')
    expect(deletes).toHaveLength(1)
    expect(admin._calls).toContainEqual({
      table: 'project_knowledge_bases',
      method: 'insert',
      args: [{ project_id: 'ws-1', knowledge_base_id: 'kb-b', purpose: 'assigned_by_platform', attached_by: 'admin-1' }],
    })
  })
})
