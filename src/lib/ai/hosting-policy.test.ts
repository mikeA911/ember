import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

let adminFake: unknown
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake }))

const { aiHostingForProject, aiHostingForProjects, aiHostingForWorkstream, aiHostingForDocuments } = await import('./hosting-policy')

describe('aiHostingForProject', () => {
  it('requires Sandz-hosted AI for a Live client Project (has a client fee record)', async () => {
    adminFake = createFakeSupabase({
      projects: [{ data: [{ id: 'p-client' }], error: null }],
      client_project_fees: [{ data: [{ project_id: 'p-client' }], error: null }],
    })
    expect(await aiHostingForProject('p-client')).toBe('self_hosted_only')
  })

  it('leaves a pre-live client Project unrestricted (presales)', async () => {
    adminFake = createFakeSupabase({ projects: [{ data: [], error: null }] })
    expect(await aiHostingForProject('p-client')).toBe('any')
  })

  it('leaves a Live internal or foundation Project unrestricted (no client fee record)', async () => {
    adminFake = createFakeSupabase({
      projects: [{ data: [{ id: 'p-supabase-stack' }], error: null }],
      client_project_fees: [{ data: [], error: null }],
    })
    expect(await aiHostingForProject('p-supabase-stack')).toBe('any')
  })

  it('filters on Live status', async () => {
    adminFake = createFakeSupabase({ projects: [{ data: [], error: null }] })
    await aiHostingForProject('p-1')
    const calls = (adminFake as { _calls: { table: string; method: string; args: unknown }[] })._calls
    expect(calls).toContainEqual({ table: 'projects', method: 'eq', args: { column: 'status', value: 'live' } })
  })
})

describe('aiHostingForProjects', () => {
  it('is restricted when any one of the Projects is a Live client Project', async () => {
    adminFake = createFakeSupabase({
      projects: [{ data: [{ id: 'p-live-internal' }, { id: 'p-live-client' }], error: null }],
      client_project_fees: [{ data: [{ project_id: 'p-live-client' }], error: null }],
    })
    expect(await aiHostingForProjects(['p-workspace', 'p-live-internal', 'p-live-client'])).toBe('self_hosted_only')
  })

  it('is unrestricted for no Projects', async () => {
    adminFake = createFakeSupabase({})
    expect(await aiHostingForProjects([])).toBe('any')
  })
})

describe('aiHostingForWorkstream', () => {
  it("follows the Workstream's Project", async () => {
    adminFake = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'p-client' }, error: null }],
      projects: [{ data: [{ id: 'p-client' }], error: null }],
      client_project_fees: [{ data: [{ project_id: 'p-client' }], error: null }],
    })
    expect(await aiHostingForWorkstream('ws-1')).toBe('self_hosted_only')
  })
})

describe('aiHostingForDocuments', () => {
  it('is restricted when a Live client Project uses the knowledge base holding the documents', async () => {
    adminFake = createFakeSupabase({
      documents: [{ data: [{ doc_type: 'kb-client' }], error: null }],
      project_knowledge_bases: [{ data: [{ project_id: 'p-client' }], error: null }],
      workstream_knowledge_bases: [{ data: [], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
      projects: [{ data: [{ id: 'p-client' }], error: null }],
      client_project_fees: [{ data: [{ project_id: 'p-client' }], error: null }],
    })
    expect(await aiHostingForDocuments(['doc-1'])).toBe('self_hosted_only')
  })
})

describe('service-role reads are metadata only', () => {
  it('selects ids, statuses and fee-row existence only', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/ai/hosting-policy.ts'), 'utf-8')
    const selects = [...src.matchAll(/\.select\('([^']+)'\)/g)].map((m) => m[1])
    expect(selects.length).toBeGreaterThan(0)
    for (const s of selects) expect(['id', 'project_id', 'workstream_id'], s).toContain(s)
  })
})
