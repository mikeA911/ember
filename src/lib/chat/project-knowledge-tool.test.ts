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

const { runSearchProjectKnowledge, runScopedProjectKnowledgeSearch, listProjectKnowledgeBaseAttachments } = await import('./project-knowledge-tool')

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

describe('listProjectKnowledgeBaseAttachments', () => {
  it('returns project attachments (workstreamId null) and workstream attachments, with purpose', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'kb-project', purpose: 'Client docs' }], error: null }],
      workstream_knowledge_bases: [{ data: [{ knowledge_base_id: 'kb-ws', workstream_id: 'ws-1', purpose: null }], error: null }],
    })
    expect(await listProjectKnowledgeBaseAttachments(supabase as never, 'proj-1')).toEqual([
      { knowledgeBaseId: 'kb-project', workstreamId: null, purpose: 'Client docs' },
      { knowledgeBaseId: 'kb-ws', workstreamId: 'ws-1', purpose: null },
    ])
  })
})

describe('runScopedProjectKnowledgeSearch', () => {
  it('queries match_documents once per knowledge base with filter_doc_type, ranks across them, and never searches the Wiki', async () => {
    const supabase = createFakeSupabase({
      kb_vectors: [{ data: [{ id: 'vec-b', document_id: 'doc-b' }, { id: 'vec-a', document_id: 'doc-a' }], error: null }],
      documents: [{ data: [{ id: 'doc-a', knowledge_source_id: 'source-a' }, { id: 'doc-b', knowledge_source_id: 'source-b' }], error: null }],
      knowledge_sources: [
        {
          data: [
            { id: 'source-a', title: 'A guide', knowledge_base_id: 'kb-a' },
            { id: 'source-b', title: 'B guide', knowledge_base_id: 'kb-b' },
          ],
          error: null,
        },
      ],
    })
    const rpc = vi.fn(async (_name: string, args: { filter_doc_type?: string }) => {
      const rows: Record<string, unknown[]> = {
        'kb-a': [{ id: 'vec-a', chunk_id: 'c-a', content: 'from a', similarity: 0.4, metadata: {} }],
        'kb-b': [{ id: 'vec-b', chunk_id: 'c-b', content: 'from b', similarity: 0.7, metadata: {} }],
      }
      return { data: rows[args.filter_doc_type ?? ''] ?? [], error: null }
    })
    supabase.rpc = rpc as never

    const result = await runScopedProjectKnowledgeSearch(fakeCtx(supabase), 'proj-1', ['kb-a', 'kb-b', 'kb-a'], { query: 'guide', limit: 5 })

    expect(rpc.mock.calls.map(([name, args]) => [name, args.filter_doc_type])).toEqual([
      ['match_documents', 'kb-a'],
      ['match_documents', 'kb-b'],
    ])
    expect(result.results.map((r) => [r.sourceId, r.layer])).toEqual([
      ['source-b', 'project'],
      ['source-a', 'project'],
    ])
  })

  it('returns nothing without embedding the query when no knowledge bases are in scope', async () => {
    const supabase = createFakeSupabase({})
    expect(await runScopedProjectKnowledgeSearch(fakeCtx(supabase), 'proj-1', [], { query: 'guide' })).toEqual({ results: [] })
    expect(embedMock).not.toHaveBeenCalled()
  })
})
