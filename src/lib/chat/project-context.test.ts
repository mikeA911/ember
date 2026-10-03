import { describe, it, expect } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import { getProjectContext, describeProjectKnowledgeScope } from './project-context'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

function fakeCtx(supabase: unknown): WorkbenchCallerContext {
  return { user: { id: 'user-1' }, profile: {}, supabase } as unknown as WorkbenchCallerContext
}

describe('getProjectContext', () => {
  it('returns null for a nonexistent/inaccessible project instead of throwing', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    const result = await getProjectContext(fakeCtx(supabase), 'missing')
    expect(result).toBeNull()
  })

  it('resolves name, goal, attached knowledge bases, and attached wiki articles', async () => {
    const supabase = createFakeSupabase({
      projects: [
        {
          data: { id: 'proj-1', name: 'Zadara Pilot', goal: 'Answer helpdesk questions', objective: 'Pilot Ember for the helpdesk', information_sensitivity: null, starter_prompt: 'Ask about the Zadara pilot' },
          error: null,
        },
      ],
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'zadara_sandz' }], error: null }],
      knowledge_bases: [{ data: [{ id: 'zadara_sandz', name: 'Zadara / Sandz' }], error: null }],
      project_wiki_articles: [{ data: [{ id: 'link-1', wiki_article_id: 'article-1' }], error: null }],
      wiki_articles: [
        {
          data: [{ id: 'article-1', slug: 'zadara-copilot', title: 'Zadara Copilot', status: 'approved', visibility_scope: 'project_private' }],
          error: null,
        },
      ],
    })

    const result = await getProjectContext(fakeCtx(supabase), 'proj-1')

    expect(result).toEqual({
      id: 'proj-1',
      name: 'Zadara Pilot',
      goal: 'Answer helpdesk questions',
      objective: 'Pilot Ember for the helpdesk',
      informationSensitivity: null,
      knowledgeBases: [{ id: 'zadara_sandz', name: 'Zadara / Sandz' }],
      wikiArticles: [{ id: 'article-1', slug: 'zadara-copilot', title: 'Zadara Copilot' }],
      starterPrompt: 'Ask about the Zadara pilot',
    })
  })

  it('carries a classified project sensitivity tier through unchanged', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'proj-1', name: 'Zadara Pilot', goal: null, information_sensitivity: 'restricted' }, error: null }],
      project_knowledge_bases: [{ data: [], error: null }],
      project_wiki_articles: [{ data: [], error: null }],
    })

    const result = await getProjectContext(fakeCtx(supabase), 'proj-1')

    expect(result?.informationSensitivity).toBe('restricted')
  })
})

describe('describeProjectKnowledgeScope', () => {
  it('names attached knowledge bases and articles', () => {
    const text = describeProjectKnowledgeScope({
      id: 'proj-1',
      name: 'Zadara Pilot',
      goal: null,
      objective: null,
      informationSensitivity: null,
      knowledgeBases: [{ id: 'zadara_sandz', name: 'Zadara / Sandz' }],
      wikiArticles: [{ id: 'a1', slug: 'zadara-copilot', title: 'Zadara Copilot' }],
      starterPrompt: null,
    })
    expect(text).toBe('knowledge base(s) Zadara / Sandz; Wiki article(s) Zadara Copilot')
  })

  it('says plainly when nothing is attached', () => {
    const text = describeProjectKnowledgeScope({
      id: 'proj-1',
      name: 'Empty Project',
      goal: null,
      objective: null,
      informationSensitivity: null,
      knowledgeBases: [],
      wikiArticles: [],
      starterPrompt: null,
    })
    expect(text).toBe('no attached knowledge base; no attached Wiki articles')
  })
})
