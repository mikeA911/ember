import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { assignProjectBuilder } = await import('./project-builder')

beforeEach(() => createAdminClientMock.mockReset())

const ctx = (role = 'admin') => ({ user: { id: 'admin-1' }, profile: { role }, supabase: createFakeSupabase({}) }) as unknown as WorkbenchCallerContext

describe('assignProjectBuilder', () => {
  it('is admin only', async () => {
    await expect(assignProjectBuilder(ctx('curator'), 'proj-1', 'builder-1')).rejects.toThrow('Only the platform admin')
  })

  it('only assigns a builder to a project whose client Ember found', async () => {
    createAdminClientMock.mockReturnValue(createFakeSupabase({ projects: [{ data: { id: 'proj-1', client_source: 'builder' }, error: null }] }))
    await expect(assignProjectBuilder(ctx(), 'proj-1', 'builder-1')).rejects.toThrow('client Ember found')
  })

  it('makes them builder of record and curator, and re-splits the fee at their Ember-found share', async () => {
    const admin = createFakeSupabase({
      projects: [{ data: { id: 'proj-1', client_source: 'ember' }, error: null }],
      profiles: [{ data: { id: 'builder-1', role: 'consultant', is_active: true }, error: null }],
      client_project_fees: [{ data: { project_id: 'proj-1' }, error: null }],
      settings: [{ data: { value: { platformRatePct: 10, builderSharePct: 10 } }, error: null }],
      builder_billing_shares: [{ data: { share_pct: 7, platform_rate_pct: null }, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)

    await assignProjectBuilder(ctx(), 'proj-1', 'builder-1')

    expect(admin._calls).toContainEqual({ table: 'projects', method: 'update', args: { builder_id: 'builder-1', portfolio_category: 'builder_lab' } })
    expect(admin._calls).toContainEqual({
      table: 'project_members',
      method: 'upsert',
      args: { project_id: 'proj-1', user_id: 'builder-1', role: 'curator', status: 'active' },
    })
    expect(admin._calls).toContainEqual({
      table: 'client_project_fees',
      method: 'update',
      args: { platform_rate_pct: 93, builder_share_pct: 7, set_by: 'admin-1' },
    })
  })
})
