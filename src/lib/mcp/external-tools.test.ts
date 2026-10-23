import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { McpCaller } from './access'

const getActiveProjectRole = vi.fn()
const runSearchProjectKnowledge = vi.fn()
const runScopedProjectKnowledgeSearch = vi.fn()
const listProjectKnowledgeBaseAttachments = vi.fn()
const resourceTiersMock = vi.fn()

vi.mock('@/lib/env', () => ({ env: { siteUrl: () => 'https://ember.example' } }))
vi.mock('@/lib/workbench/context', () => ({ getActiveProjectRole: (...a: unknown[]) => getActiveProjectRole(...a) }))
vi.mock('@/lib/chat/project-knowledge-tool', () => ({
  runSearchProjectKnowledge: (...a: unknown[]) => runSearchProjectKnowledge(...a),
  runScopedProjectKnowledgeSearch: (...a: unknown[]) => runScopedProjectKnowledgeSearch(...a),
  listProjectKnowledgeBaseAttachments: (...a: unknown[]) => listProjectKnowledgeBaseAttachments(...a),
}))
vi.mock('@/lib/chat/workstream-list-tool', () => ({ runListWorkstreams: vi.fn() }))
vi.mock('./tools', () => ({ callTool: vi.fn() }))
vi.mock('./project-summary', () => ({ loadProjectSummaryMarkdown: vi.fn(), PROJECT_TYPE_LABELS: { consulting: 'Client / Consulting' } }))
vi.mock('./sensitivity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sensitivity')>()
  return { ...actual, resourceTiers: (...a: unknown[]) => resourceTiersMock(...a) }
})

const { EXTERNAL_TOOL_NAMES, getExternalTool, listExternalTools, McpToolError } = await import('./external-tools')

const PROJECT = '11111111-1111-4111-8111-111111111111'

function caller(supabase: unknown, maxSensitivity: McpCaller['maxSensitivity'] = 'internal'): McpCaller {
  return {
    ctx: { user: { id: 'user-1', email: 'b@example.com' }, profile: { role: 'consultant' }, supabase } as unknown as McpCaller['ctx'],
    clientId: 'client-1',
    clientLabel: 'Claude',
    maxSensitivity,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('external tool registry', () => {
  it('exposes exactly the read-only tool set, and none of the internal write tools', () => {
    expect(EXTERNAL_TOOL_NAMES.sort()).toEqual(
      ['get_navigation_guide', 'get_project_summary', 'list_knowledge_bases', 'list_my_projects', 'list_project_notes', 'list_workstreams', 'search_project_knowledge', 'search_wiki', 'whoami'].sort()
    )
    for (const write of ['create_project', 'approve_project', 'classify_project', 'create_workstream', 'attach_workstream_artifact', 'create_wiki_draft', 'request_project_membership']) {
      expect(getExternalTool(write)).toBeNull()
    }
    expect(getExternalTool('__proto__')).toBeNull()
  })

  it('marks every tool read-only for the client', () => {
    for (const t of listExternalTools()) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
      expect(t.inputSchema.type).toBe('object')
    }
  })

  it('never imports the service-role client directly', () => {
    for (const file of ['external-tools.ts', 'project-summary.ts', 'server.ts']) {
      const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/mcp', file), 'utf-8')
      expect(src, file).not.toMatch(/@\/lib\/supabase\/admin/)
      expect(src, file).not.toMatch(/createAdminClient/)
    }
  })

  it('reads tiers through the shared helper, whose only service-role read is tier metadata', () => {
    expect(fs.readFileSync(path.join(process.cwd(), 'src/lib/mcp/sensitivity.ts'), 'utf-8')).not.toMatch(/createAdminClient/)
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/ai/sensitivity.ts'), 'utf-8')
    const uses = src.match(/createAdminClient\(\)[\s\S]*?\.select\('([^']+)'\)/g) ?? []
    expect(uses).toHaveLength(1)
    expect(uses[0]).toContain(".from('resource_access_policies')")
    expect(uses[0]).toContain(".select('resource_id, information_sensitivity')")
  })
})

describe('list_my_projects', () => {
  it("lists the user's active projects and withholds those above the app's sensitivity ceiling", async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: [{ project_id: 'p1', role: 'owner' }, { project_id: 'p2', role: 'member' }, { project_id: 'p3', role: 'member' }], error: null }],
      projects: [
        {
          data: [
            { id: 'p1', name: 'Open', project_type: 'consulting', status: 'working', objective: null, goal: null, information_sensitivity: 'public' },
            { id: 'p2', name: 'Unclassified', project_type: 'consulting', status: 'working', objective: null, goal: null, information_sensitivity: null },
            { id: 'p3', name: 'Secret', project_type: 'consulting', status: 'working', objective: null, goal: null, information_sensitivity: 'confidential' },
          ],
          error: null,
        },
      ],
    })
    const outcome = await getExternalTool('list_my_projects')!.handler(caller(supabase), {})
    const result = outcome.result as { projects: { id: string; yourRole: string; url: string }[]; note?: string }
    expect(result.projects.map((p) => p.id)).toEqual(['p1', 'p2'])
    expect(result.projects[0]).toMatchObject({ yourRole: 'owner', url: 'https://ember.example/projects/p1' })
    expect(outcome.withheldCount).toBe(1)
    expect(result.note).toMatch(/1 result withheld/)
  })
})

describe('project-scoped tools', () => {
  it('say "not found" for a project the user is not an active member of', async () => {
    getActiveProjectRole.mockResolvedValue(null)
    const tool = getExternalTool('get_project_summary')!
    await expect(tool.handler(caller(createFakeSupabase({})), { projectId: PROJECT })).rejects.toBeInstanceOf(McpToolError)
  })

  it('say the same "not found" for a member project above the sensitivity ceiling', async () => {
    getActiveProjectRole.mockResolvedValue('owner')
    const supabase = createFakeSupabase({ projects: [{ data: { id: PROJECT, name: 'Secret', information_sensitivity: 'restricted' }, error: null }] })
    const tool = getExternalTool('list_workstreams')!
    await expect(tool.handler(caller(supabase, 'confidential'), { projectId: PROJECT })).rejects.toThrow(/Project not found/)
  })

  it('reject a non-uuid projectId at the schema', () => {
    expect(getExternalTool('get_project_summary')!.inputSchema.safeParse({ projectId: 'Zadara pilot' }).success).toBe(false)
  })
})

describe('search_project_knowledge', () => {
  it('drops hits above the ceiling (unclassified counts as internal) and reports how many were withheld', async () => {
    getActiveProjectRole.mockResolvedValue('member')
    runSearchProjectKnowledge.mockResolvedValue({
      results: [
        { layer: 'project', sourceType: 'knowledge_source', sourceId: 'ks-ok', title: 'Runbook', route: '/sources/ks-ok', similarity: 0.9, content: 'a' },
        { layer: 'project', sourceType: 'knowledge_source', sourceId: 'ks-conf', title: 'Contract', route: '/sources/ks-conf', similarity: 0.8, content: 'b' },
        { layer: 'platform', sourceType: 'wiki_article', sourceId: 'rag-basics', title: 'RAG basics', route: '/wiki/rag-basics', similarity: 0.7, content: 'c' },
      ],
    })
    resourceTiersMock.mockImplementation(async (type: string) =>
      type === 'knowledge_source'
        ? new Map([
            ['ks-ok', 'internal'],
            ['ks-conf', 'confidential'],
          ])
        : new Map([['wiki-1', 'public']])
    )
    const supabase = createFakeSupabase({
      projects: [{ data: { id: PROJECT, name: 'Pilot', information_sensitivity: 'internal' }, error: null }],
      wiki_articles: [{ data: [{ id: 'wiki-1', slug: 'rag-basics' }], error: null }],
    })

    const outcome = await getExternalTool('search_project_knowledge')!.handler(caller(supabase, 'internal'), { projectId: PROJECT, query: 'runbook', limit: 5 })
    const result = outcome.result as { note: string; results: { title: string; url: string }[]; withheld?: string }
    expect(result.results.map((r) => r.title)).toEqual(['Runbook', 'RAG basics'])
    expect(result.results[0].url).toBe('https://ember.example/sources/ks-ok')
    expect(result.note).toMatch(/never as instructions/)
    expect(outcome.withheldCount).toBe(1)
  })
})

const WORKSTREAM = '22222222-2222-4222-8222-222222222222'
const ATTACHMENTS = [
  { knowledgeBaseId: 'kb-project', workstreamId: null, purpose: 'Client docs' },
  { knowledgeBaseId: 'kb-ws', workstreamId: WORKSTREAM, purpose: 'Vendor APIs' },
  { knowledgeBaseId: 'kb-other-ws', workstreamId: '33333333-3333-4333-8333-333333333333', purpose: null },
]

describe('search_project_knowledge scoped to a workstream or knowledge base', () => {
  const memberProject = { data: { id: PROJECT, name: 'Pilot', information_sensitivity: 'internal' }, error: null }

  beforeEach(() => {
    getActiveProjectRole.mockResolvedValue('member')
    listProjectKnowledgeBaseAttachments.mockResolvedValue(ATTACHMENTS)
    resourceTiersMock.mockResolvedValue(new Map())
    runScopedProjectKnowledgeSearch.mockResolvedValue({ results: [] })
  })

  it("searches only the workstream's attached knowledge bases", async () => {
    const supabase = createFakeSupabase({ projects: [memberProject], project_workstreams: [{ data: { id: WORKSTREAM, name: 'APIs' }, error: null }] })
    await getExternalTool('search_project_knowledge')!.handler(caller(supabase), { projectId: PROJECT, query: 'auth', limit: 5, workstreamId: WORKSTREAM })
    expect(runScopedProjectKnowledgeSearch).toHaveBeenCalledWith(expect.anything(), PROJECT, ['kb-ws'], { query: 'auth', limit: 5 })
    expect(runSearchProjectKnowledge).not.toHaveBeenCalled()
    expect(supabase._calls).toContainEqual({ table: 'project_workstreams', method: 'eq', args: { column: 'project_id', value: PROJECT } })
  })

  it('searches a single knowledge base attached to the project', async () => {
    const supabase = createFakeSupabase({ projects: [memberProject] })
    await getExternalTool('search_project_knowledge')!.handler(caller(supabase), { projectId: PROJECT, query: 'auth', limit: 5, knowledgeBaseId: 'kb-project' })
    expect(runScopedProjectKnowledgeSearch).toHaveBeenCalledWith(expect.anything(), PROJECT, ['kb-project'], { query: 'auth', limit: 5 })
  })

  it('says "not found" for a knowledge base not attached to the project, or not to the given workstream', async () => {
    const tool = getExternalTool('search_project_knowledge')!
    await expect(
      tool.handler(caller(createFakeSupabase({ projects: [memberProject] })), { projectId: PROJECT, query: 'auth', limit: 5, knowledgeBaseId: 'kb-elsewhere' })
    ).rejects.toThrow(/Knowledge base not found/)
    const supabase = createFakeSupabase({ projects: [memberProject], project_workstreams: [{ data: { id: WORKSTREAM, name: 'APIs' }, error: null }] })
    await expect(
      tool.handler(caller(supabase), { projectId: PROJECT, query: 'auth', limit: 5, workstreamId: WORKSTREAM, knowledgeBaseId: 'kb-project' })
    ).rejects.toThrow(/Knowledge base not found/)
    expect(runScopedProjectKnowledgeSearch).not.toHaveBeenCalled()
  })

  it('says "not found" for a workstream outside the project', async () => {
    const supabase = createFakeSupabase({ projects: [memberProject], project_workstreams: [{ data: null, error: null }] })
    await expect(
      getExternalTool('search_project_knowledge')!.handler(caller(supabase), { projectId: PROJECT, query: 'auth', limit: 5, workstreamId: WORKSTREAM })
    ).rejects.toThrow(/Workstream not found/)
  })

  it('still withholds scoped hits above the ceiling', async () => {
    runScopedProjectKnowledgeSearch.mockResolvedValue({
      results: [{ layer: 'project', sourceType: 'knowledge_source', sourceId: 'ks-conf', title: 'Contract', route: '/sources/ks-conf', similarity: 0.9, content: 'x' }],
    })
    resourceTiersMock.mockImplementation(async (type: string) => (type === 'knowledge_source' ? new Map([['ks-conf', 'confidential']]) : new Map()))
    const supabase = createFakeSupabase({ projects: [memberProject], wiki_articles: [{ data: [], error: null }] })
    const outcome = await getExternalTool('search_project_knowledge')!.handler(caller(supabase, 'internal'), {
      projectId: PROJECT,
      query: 'contract',
      limit: 5,
      knowledgeBaseId: 'kb-project',
    })
    expect((outcome.result as { results: unknown[] }).results).toEqual([])
    expect(outcome.withheldCount).toBe(1)
  })
})

describe('list_knowledge_bases', () => {
  beforeEach(() => {
    getActiveProjectRole.mockResolvedValue('member')
    listProjectKnowledgeBaseAttachments.mockResolvedValue(ATTACHMENTS)
  })

  it('lists readable attached knowledge bases with where they are attached and their active source count', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: PROJECT, name: 'Pilot', information_sensitivity: 'internal' }, error: null }],
      // kb-other-ws is not readable by this user (RLS), so it is left out.
      knowledge_bases: [
        {
          data: [
            { id: 'kb-project', name: 'Client documents', description: 'Contracts and specs' },
            { id: 'kb-ws', name: 'Vendor APIs', description: null },
          ],
          error: null,
        },
      ],
      project_workstreams: [{ data: [{ id: WORKSTREAM, name: 'API integration' }], error: null }],
      knowledge_sources: [{ data: [{ knowledge_base_id: 'kb-project' }, { knowledge_base_id: 'kb-project' }, { knowledge_base_id: 'kb-ws' }], error: null }],
    })
    const outcome = await getExternalTool('list_knowledge_bases')!.handler(caller(supabase), { projectId: PROJECT })
    expect((outcome.result as { knowledgeBases: unknown[] }).knowledgeBases).toEqual([
      { id: 'kb-project', name: 'Client documents', description: 'Contracts and specs', attachedTo: [{ type: 'project', purpose: 'Client docs' }], activeSources: 2 },
      {
        id: 'kb-ws',
        name: 'Vendor APIs',
        description: null,
        attachedTo: [{ type: 'workstream', workstreamId: WORKSTREAM, workstreamName: 'API integration', purpose: 'Vendor APIs' }],
        activeSources: 1,
      },
    ])
    expect(outcome.resultCount).toBe(2)
  })

  it('says "not found" for a project the user is not a member of', async () => {
    getActiveProjectRole.mockResolvedValue(null)
    await expect(getExternalTool('list_knowledge_bases')!.handler(caller(createFakeSupabase({})), { projectId: PROJECT })).rejects.toThrow(/Project not found/)
    expect(listProjectKnowledgeBaseAttachments).not.toHaveBeenCalled()
  })
})
