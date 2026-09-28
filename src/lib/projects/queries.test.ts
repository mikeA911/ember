import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

import { getProjectStats, listProjectsWithDraftUpdates, listProjectsWithKnowledge, listKnowledgeBasesForProject, getSourceReviewCounts } from './queries'

describe('getSourceReviewCounts', () => {
  it('counts total and approved chunks per document, including documents with no chunks yet', async () => {
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        document_chunks: [
          {
            data: [
              { document_id: 'doc-1', review_status: 'approved' },
              { document_id: 'doc-1', review_status: 'approved' },
              { document_id: 'doc-2', review_status: 'pending' },
              { document_id: 'doc-2', review_status: 'approved' },
            ],
            error: null,
          },
        ],
      })
    )

    const counts = await getSourceReviewCounts(['doc-1', 'doc-2', 'doc-3'])

    expect(Object.fromEntries(counts)).toEqual({
      'doc-1': { total: 2, approved: 2 },
      'doc-2': { total: 2, approved: 1 },
      'doc-3': { total: 0, approved: 0 },
    })
  })

  it('skips the query entirely when there are no documents', async () => {
    createAdminClientMock.mockReset()
    expect((await getSourceReviewCounts([])).size).toBe(0)
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })
})

describe('getProjectStats', () => {
  it('counts total projects and how many are active', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: [{ status: 'active' }, { status: 'draft' }, { status: 'active' }, { status: 'archived' }], error: null }],
    }) as never

    const result = await getProjectStats(supabase)

    expect(result).toEqual({ total: 4, active: 2 })
  })
})

describe('listProjectsWithDraftUpdates', () => {
  it('queries private projects with a non-null public_profile', async () => {
    const rows = [{ id: '1', name: 'Draft Project', public_profile: { title: 'x' } }]
    const supabase = createFakeSupabase({
      projects: [{ data: rows, error: null }],
    }) as never

    const result = await listProjectsWithDraftUpdates(supabase)

    expect(result).toEqual(rows)
  })
})

describe('listProjectsWithKnowledge', () => {
  it('returns an empty array when no knowledge base is attached to any project', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [], error: null }],
    }) as never

    const result = await listProjectsWithKnowledge(supabase)

    expect(result).toEqual([])
  })

  it('sums documents and wiki articles per project across its attached KBs, via the junction table', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [
        {
          data: [
            { project_id: 'proj-1', knowledge_base_id: 'kb-a' },
            { project_id: 'proj-1', knowledge_base_id: 'kb-b' },
            { project_id: 'proj-2', knowledge_base_id: 'kb-c' },
          ],
          error: null,
        },
      ],
      projects: [
        {
          data: [
            { id: 'proj-1', name: 'RAG Experiment' },
            { id: 'proj-2', name: 'Legacy Modernization' },
          ],
          error: null,
        },
      ],
      documents: [
        {
          data: [{ doc_type: 'kb-a' }, { doc_type: 'kb-a' }, { doc_type: 'kb-b' }, { doc_type: 'kb-c' }],
          error: null,
        },
      ],
      wiki_articles: [
        {
          data: [{ knowledge_base_id: 'kb-a' }, { knowledge_base_id: 'kb-c' }, { knowledge_base_id: 'kb-c' }],
          error: null,
        },
      ],
    }) as never

    const result = await listProjectsWithKnowledge(supabase)

    expect(result).toEqual([
      { id: 'proj-1', name: 'RAG Experiment', documentCount: 3, wikiArticleCount: 1 },
      { id: 'proj-2', name: 'Legacy Modernization', documentCount: 1, wikiArticleCount: 2 },
    ])
  })
})

describe('listKnowledgeBasesForProject', () => {
  it('returns an empty array when nothing is attached, without a second query', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [], error: null }],
    }) as never

    const result = await listKnowledgeBasesForProject(supabase, 'proj-1')

    expect(result).toEqual([])
  })

  it('joins link rows to knowledge base id/name', async () => {
    const supabase = createFakeSupabase({
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'zadara_sandz' }], error: null }],
      knowledge_bases: [{ data: [{ id: 'zadara_sandz', name: 'Zadara / Sandz' }], error: null }],
    }) as never

    const result = await listKnowledgeBasesForProject(supabase, 'proj-1')

    expect(result).toEqual([{ id: 'zadara_sandz', name: 'Zadara / Sandz' }])
  })
})
