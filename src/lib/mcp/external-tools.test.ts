import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { McpCaller } from './access'

const getActiveProjectRole = vi.fn()
const runSearchProjectKnowledge = vi.fn()
const resourceTiersMock = vi.fn()

vi.mock('@/lib/env', () => ({ env: { siteUrl: () => 'https://ember.example' } }))
vi.mock('@/lib/workbench/context', () => ({ getActiveProjectRole: (...a: unknown[]) => getActiveProjectRole(...a) }))
vi.mock('@/lib/chat/project-knowledge-tool', () => ({ runSearchProjectKnowledge: (...a: unknown[]) => runSearchProjectKnowledge(...a) }))
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
      ['get_navigation_guide', 'get_project_summary', 'list_my_projects', 'list_project_notes', 'list_workstreams', 'search_project_knowledge', 'search_wiki', 'whoami'].sort()
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

  it('only uses the service-role client in sensitivity.ts to read tier metadata', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/mcp/sensitivity.ts'), 'utf-8')
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
