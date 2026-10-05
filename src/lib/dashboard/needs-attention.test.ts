import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const listUnpublishedArticlesMock = vi.fn()
const listProjectsWithDraftUpdatesMock = vi.fn()
const listTrendingUnderReviewMock = vi.fn()
const listProjectsWithMissingAuthoritiesMock = vi.fn()

vi.mock('@/lib/wiki/queries', () => ({ listUnpublishedArticles: (...args: unknown[]) => listUnpublishedArticlesMock(...args) }))
vi.mock('@/lib/projects/queries', () => ({
  listProjectsWithDraftUpdates: (...args: unknown[]) => listProjectsWithDraftUpdatesMock(...args),
}))
vi.mock('@/lib/trending/queries', () => ({
  listTrendingUnderReview: (...args: unknown[]) => listTrendingUnderReviewMock(...args),
}))
vi.mock('@/lib/governance/queries', () => ({
  listProjectsWithMissingAuthorities: (...args: unknown[]) => listProjectsWithMissingAuthoritiesMock(...args),
}))

const { getNeedsAttention } = await import('./needs-attention')

describe('getNeedsAttention', () => {
  it('combines documents, wiki, eval, project, and trending queries into one list, including zero counts', async () => {
    listUnpublishedArticlesMock.mockResolvedValue([{ id: 'w1' }, { id: 'w2' }])
    listProjectsWithDraftUpdatesMock.mockResolvedValue([])
    listTrendingUnderReviewMock.mockResolvedValue([{ id: 't1' }])
    listProjectsWithMissingAuthoritiesMock.mockResolvedValue([])

    const supabase = createFakeSupabase({
      documents: [{ data: [{ id: 'd1' }], error: null }],
      eval_runs: [{ data: [{ id: 'r1' }, { id: 'r2' }], error: null }],
      presentation_slide_comments: [{ data: [{ id: 'c1' }], error: null }],
    }) as never

    const result = await getNeedsAttention(supabase, { includeEvalRuns: true })

    expect(result).toEqual([
      { label: 'documents sent for optional admin sign-off', count: 1, href: '/upload' },
      { label: 'Wiki articles awaiting approval', count: 2, href: '/wiki' },
      { label: 'failed evaluation runs', count: 2, href: '/evals' },
      { label: 'unpublished project updates', count: 0, href: '/projects' },
      { label: 'Trending items under review', count: 1, href: '/trending' },
      { label: 'projects with a governance authority needed', count: 0, href: '/projects' },
      { label: 'presentation comments awaiting classification', count: 1, href: '/projects' },
    ])
  })
  it('leaves out failed evaluation runs for a viewer who is not a platform admin', async () => {
    listUnpublishedArticlesMock.mockResolvedValue([])
    listProjectsWithDraftUpdatesMock.mockResolvedValue([])
    listTrendingUnderReviewMock.mockResolvedValue([])
    listProjectsWithMissingAuthoritiesMock.mockResolvedValue([])

    const supabase = createFakeSupabase({
      documents: [{ data: [], error: null }],
      presentation_slide_comments: [{ data: [], error: null }],
    })

    const result = await getNeedsAttention(supabase as never, { includeEvalRuns: false })

    expect(result.map((item) => item.label)).not.toContain('failed evaluation runs')
    expect(supabase._calls.some((c) => c.table === 'eval_runs')).toBe(false)
  })
})
