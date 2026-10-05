import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const embedMock = vi.fn()
vi.mock('@/lib/ai', () => ({
  gateProvider: async (_supabase: unknown, provider: unknown) => provider,
  manifestForDocuments: async () => ({ entries: [] }),
  manifestForProject: async () => ({ entries: [] }),
  manifestForWorkstream: async () => ({ entries: [] }),
  manifestForArtifact: async () => ({ entries: [] }),
  manifestForWikiVersion: async () => ({ entries: [] }),
  getActiveEmbeddingProvider: async () => ({ embed: embedMock }),
}))

const { runSearchProjectKnowledge } = await import('./project-knowledge-tool')

beforeEach(() => {
  embedMock.mockReset()
  embedMock.mockResolvedValue({ embedding: [0.1, 0.2] })
})

function fakeCtx(supabase: ReturnType<typeof createFakeSupabase>): WorkbenchCallerContext {
  return { user: { id: 'user-1' }, profile: {}, supabase } as unknown as WorkbenchCallerContext
}

describe('runSearchProjectKnowledge', () => {
  it('tags a hit from the project\'s own attached knowledge base as layer:project, and one from elsewhere as layer:platform', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'zadara_sandz' }], error: null }],
      project_wiki_articles: [{ data: [], error: null }],
      kb_vectors: [
        {
          data: [
            { id: 'vec-1', document_id: 'doc-1' },
            { id: 'vec-2', document_id: 'doc-2' },
          ],
          error: null,
        },
      ],
      documents: [
        {
          data: [
            { id: 'doc-1', knowledge_source_id: 'source-1' },
            { id: 'doc-2', knowledge_source_id: 'source-2' },
          ],
          error: null,
        },
      ],
      knowledge_sources: [
        {
          data: [
            { id: 'source-1', title: 'Zadara zStorage Overview', knowledge_base_id: 'zadara_sandz' },
            { id: 'source-2', title: 'AI Engineering RAG Basics', knowledge_base_id: 'ai_engineering' },
          ],
          error: null,
        },
      ],
    })
    supabase.rpc = vi.fn(async (name: string) => {
      if (name === 'match_documents') {
        return {
          data: [
            { id: 'vec-1', chunk_id: 'chunk-1', content: 'zStorage supports block, file, object.', similarity: 0.9, metadata: {} },
            { id: 'vec-2', chunk_id: 'chunk-2', content: 'RAG combines retrieval with generation.', similarity: 0.5, metadata: {} },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    }) as never

    const result = await runSearchProjectKnowledge(fakeCtx(supabase), 'proj-1', { query: 'storage types', limit: 5 })

    expect(result.results).toEqual([
      {
        layer: 'project',
        sourceType: 'knowledge_source',
        sourceId: 'source-1',
        title: 'Zadara zStorage Overview',
        route: '/sources/source-1',
        similarity: 0.9,
        content: 'zStorage supports block, file, object.',
        documentVersionId: 'doc-1',
      },
      {
        layer: 'platform',
        sourceType: 'knowledge_source',
        sourceId: 'source-2',
        title: 'AI Engineering RAG Basics',
        route: '/sources/source-2',
        similarity: 0.5,
        content: 'RAG combines retrieval with generation.',
        documentVersionId: 'doc-2',
      },
    ])
  })

  it('treats a knowledge base attached to one of the project\'s workstreams as the project\'s own', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [], error: null }],
      workstream_knowledge_bases: [{ data: [{ knowledge_base_id: 'mitel_integration' }], error: null }],
      project_wiki_articles: [{ data: [], error: null }],
      kb_vectors: [{ data: [{ id: 'vec-1', document_id: 'doc-1' }], error: null }],
      documents: [{ data: [{ id: 'doc-1', knowledge_source_id: 'source-1' }], error: null }],
      knowledge_sources: [{ data: [{ id: 'source-1', title: 'Mitel SIP trunk guide', knowledge_base_id: 'mitel_integration' }], error: null }],
    })
    supabase.rpc = vi.fn(async (name: string) => {
      if (name === 'match_documents') {
        return { data: [{ id: 'vec-1', chunk_id: 'chunk-1', content: 'Trunks use 5060/5061.', similarity: 0.8, metadata: {} }], error: null }
      }
      return { data: [], error: null }
    }) as never

    const result = await runSearchProjectKnowledge(fakeCtx(supabase), 'proj-1', { query: 'mitel trunks', limit: 5 })

    expect(result.results.map((r) => [r.sourceId, r.layer])).toEqual([['source-1', 'project']])
    expect(supabase._calls).toContainEqual({ table: 'workstream_knowledge_bases', method: 'eq', args: { column: 'workstream.project_id', value: 'proj-1' } })
  })

  it('ranks project-layer results ahead of platform-layer results regardless of similarity order', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [], error: null }],
      project_wiki_articles: [{ data: [{ wiki_article_id: 'article-project' }], error: null }],
    })
    supabase.rpc = vi.fn(async (name: string) => {
      if (name === 'match_wiki_vectors') {
        return {
          data: [
            {
              id: 'wv-1',
              wiki_version_id: 'v1',
              wiki_article_id: 'article-platform',
              content: 'Platform guidance.',
              similarity: 0.95,
              article_slug: 'platform-article',
              article_title: 'Platform Article',
            },
            {
              id: 'wv-2',
              wiki_version_id: 'v2',
              wiki_article_id: 'article-project',
              content: 'This project\'s own evidence.',
              similarity: 0.4,
              article_slug: 'project-article',
              article_title: 'Project Article',
            },
          ],
          error: null,
        }
      }
      return { data: [], error: null }
    }) as never

    const result = await runSearchProjectKnowledge(fakeCtx(supabase), 'proj-1', { query: 'guidance', limit: 5 })

    expect(result.results.map((r) => r.layer)).toEqual(['project', 'platform'])
    expect(result.results[0].sourceId).toBe('project-article')
  })
})
