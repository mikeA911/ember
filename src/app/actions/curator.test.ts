import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/lib/knowledge-bases', () => ({ requireActiveKnowledgeBase: vi.fn() }))

const requireRoleMock = vi.fn()
const getActiveEmbeddingProviderMock = vi.fn()
const getActiveStructuredOutputProviderMock = vi.fn()
const enrichDocumentChunksMock = vi.fn()
const approveChunkMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    requireRole: (...args: unknown[]) => requireRoleMock(...args),
  }
})
vi.mock('@/lib/ai', () => ({
  getActiveEmbeddingProvider: (...args: unknown[]) => getActiveEmbeddingProviderMock(...args),
  getActiveStructuredOutputProvider: (...args: unknown[]) => getActiveStructuredOutputProviderMock(...args),
}))
vi.mock('@/lib/curator/documents', () => ({
  createUploadedDocument: vi.fn(),
  processDocument: vi.fn(),
  submitDocument: vi.fn(),
  deleteDocumentById: vi.fn(),
}))
vi.mock('@/lib/curator/chunks', async () => {
  const actual = await vi.importActual<typeof import('@/lib/curator/chunks')>('@/lib/curator/chunks')
  return {
    ...actual,
    enrichDocumentChunks: (...args: unknown[]) => enrichDocumentChunksMock(...args),
    approveChunk: (...args: unknown[]) => approveChunkMock(...args),
  }
})

import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const { enrichMoreChunks, approveChunkAction, approveRemainingChunksAction } = await import('./curator')

beforeEach(() => {
  requireRoleMock.mockReset()
  getActiveEmbeddingProviderMock.mockReset()
  getActiveStructuredOutputProviderMock.mockReset()
  enrichDocumentChunksMock.mockReset()
  approveChunkMock.mockReset()
})

describe('approveChunkAction', () => {
  it('resolves the embedding provider, not generation or structured-output -- some generation-only providers (e.g. Groq) cannot embed at all', async () => {
    const supabase = {}
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const embeddingProvider = { name: 'embedding-provider' }
    getActiveEmbeddingProviderMock.mockResolvedValue(embeddingProvider)

    await approveChunkAction('chunk-1', 'doc-1', 'looks good')

    expect(getActiveEmbeddingProviderMock).toHaveBeenCalled()
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
    expect(approveChunkMock).toHaveBeenCalledWith(supabase, embeddingProvider, {
      chunkId: 'chunk-1',
      curatorNotes: 'looks good',
      reviewedBy: 'curator-1',
    })
  })
})

describe('approveChunkAction errors', () => {
  it('returns the failure message instead of throwing, so production shows it rather than a React #441 digest', async () => {
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase: {} })
    getActiveEmbeddingProviderMock.mockRejectedValue(new Error('Provider "openai" is enabled but OPENAI_API_KEY is not set'))

    await expect(approveChunkAction('chunk-1', 'doc-1', null)).resolves.toEqual({
      ok: false,
      error: 'Provider "openai" is enabled but OPENAI_API_KEY is not set',
    })
    expect(approveChunkMock).not.toHaveBeenCalled()
  })
})

describe('approveRemainingChunksAction', () => {
  it('approves every undecided chunk with one embedding provider and reports the count', async () => {
    const supabase = createFakeSupabase({ document_chunks: [{ data: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const provider = { name: 'embedding-provider' }
    getActiveEmbeddingProviderMock.mockResolvedValue(provider)
    approveChunkMock.mockResolvedValue(undefined)

    await expect(approveRemainingChunksAction('doc-1')).resolves.toEqual({ ok: true, approved: 3 })

    expect(getActiveEmbeddingProviderMock).toHaveBeenCalledTimes(1)
    expect(approveChunkMock.mock.calls.map((c) => c[2].chunkId)).toEqual(['c1', 'c2', 'c3'])
    expect(approveChunkMock.mock.calls[0][2]).toMatchObject({ reviewedBy: 'curator-1', curatorNotes: null })
  })

  it('stops at the first failure and says how many were approved, so clicking again continues', async () => {
    const supabase = createFakeSupabase({ document_chunks: [{ data: [{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }], error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    getActiveEmbeddingProviderMock.mockResolvedValue({})
    approveChunkMock.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('OpenAI embed failed: 429 rate limit'))

    await expect(approveRemainingChunksAction('doc-1')).resolves.toEqual({
      ok: false,
      approved: 1,
      error: 'OpenAI embed failed: 429 rate limit',
    })
    expect(approveChunkMock).toHaveBeenCalledTimes(2)
  })

  it('does nothing when every chunk is already decided', async () => {
    const supabase = createFakeSupabase({ document_chunks: [{ data: [], error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })

    await expect(approveRemainingChunksAction('doc-1')).resolves.toEqual({ ok: true, approved: 0 })
    expect(getActiveEmbeddingProviderMock).not.toHaveBeenCalled()
  })
})

describe('enrichMoreChunks', () => {
  it('resolves the structured-output provider, not plain generation or embedding -- enrichment extracts topic/key_concepts as JSON', async () => {
    const supabase = {}
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const structuredProvider = { name: 'structured-output-provider' }
    getActiveStructuredOutputProviderMock.mockResolvedValue(structuredProvider)
    enrichDocumentChunksMock.mockResolvedValue({ enriched: 0 })

    await enrichMoreChunks('doc-1', 'billing')

    expect(getActiveStructuredOutputProviderMock).toHaveBeenCalled()
    expect(getActiveEmbeddingProviderMock).not.toHaveBeenCalled()
    expect(enrichDocumentChunksMock).toHaveBeenCalledWith(supabase, structuredProvider, 'doc-1', 'billing', 10)
  })
})
