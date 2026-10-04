import { describe, it, expect } from 'vitest'
import { approveChunk, enrichDocumentChunks, rejectChunk } from './chunks'
import { AISensitivityError } from '@/lib/ai/sensitivity'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { AIProvider } from '@/lib/ai/provider'

const fakeProvider: AIProvider = {
  name: 'fake',
  async generateText() {
    throw new Error('not used')
  },
  async generateStructured() {
    throw new Error('not used')
  },
  async generateChat() {
    throw new Error('not used')
  },
  async embed() {
    return { embedding: [0.1, 0.2, 0.3], model: 'fake-embed', dimensions: 3, usage: { inputTokens: 5, outputTokens: null } }
  },
}

const chunkRow = (reviewStatus: string) => ({
  id: 'chunk-1',
  document_id: 'doc-1',
  chunk_text: 'some text',
  chunk_index: 0,
  chunk_size: 2,
  source_page: 3,
  review_status: reviewStatus,
  ai_metadata: { topic: 'Billing', use_cases: [], key_concepts: [] },
  document: { doc_type: 'billing', filename: 'a.pdf' },
})

describe('approveChunk', () => {
  it('writes a kb_vectors row and marks the chunk approved with an audit trail', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        { data: chunkRow('pending'), error: null },
        { data: null, error: null }, // the update() call
      ],
      kb_vectors: [{ data: null, error: null }],
    }) as never

    await approveChunk(supabase, fakeProvider, { chunkId: 'chunk-1', curatorNotes: 'looks good', reviewedBy: 'curator-1' })

    const typedSupabase = supabase as ReturnType<typeof createFakeSupabase>
    expect(typedSupabase._rpcCalls).toEqual([{ name: 'increment_approved_chunks', args: { doc_id: 'doc-1' } }])
    // upsert, not insert -- kb_vectors has `unique (chunk_id)`, and the
    // reviewer UI allows re-approving an already-approved chunk (see the
    // idempotency test below), so a plain insert would throw a duplicate-key
    // error on the second click.
    const vectorWrite = typedSupabase._calls.find((c) => c.table === 'kb_vectors')
    expect(vectorWrite?.method).toBe('upsert')
  })

  it('re-approving an already-approved chunk is idempotent: no duplicate-key throw, no double-counted approved_chunks', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        { data: chunkRow('approved'), error: null },
        { data: null, error: null }, // the update() call
      ],
      kb_vectors: [{ data: null, error: null }],
    }) as never

    await expect(
      approveChunk(supabase, fakeProvider, { chunkId: 'chunk-1', curatorNotes: 'still good', reviewedBy: 'curator-1' })
    ).resolves.toBeUndefined()

    // Already counted the first time it was approved -- re-approving must
    // not increment the document's approved_chunks counter again.
    expect((supabase as ReturnType<typeof createFakeSupabase>)._rpcCalls).toEqual([])
  })
})

describe('rejectChunk', () => {
  it('records the rejection and deletes any existing kb_vectors row for the chunk', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [{ data: { document_id: 'doc-1' }, error: null }, { data: null, error: null }],
      kb_vectors: [{ data: null, error: null }],
    }) as never

    await rejectChunk(supabase, { chunkId: 'chunk-1', curatorNotes: null, reviewedBy: 'curator-1' })

    const typedSupabase = supabase as ReturnType<typeof createFakeSupabase>
    expect(typedSupabase._rpcCalls).toEqual([{ name: 'increment_rejected_chunks', args: { doc_id: 'doc-1' } }])
    // A chunk can be re-reviewed after already being approved -- rejecting it
    // must delete any kb_vectors row approveChunk already wrote, or match_documents
    // (the RAG search RPC) would keep surfacing "rejected" content to Ember.
    const vectorDelete = typedSupabase._calls.find((c) => c.table === 'kb_vectors' && c.method === 'delete')
    expect(vectorDelete).toBeDefined()
  })
})

describe('enrichDocumentChunks', () => {
  it('stops at a policy block and records it with its own code, leaving the rest pending', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        { data: [{ id: 'chunk-1', chunk_text: 'a' }, { id: 'chunk-2', chunk_text: 'b' }], error: null },
        { data: null, error: null }, // chunk-1 -> enriching
        { data: null, error: null }, // chunk-1 -> failed
      ],
    })
    let calls = 0
    const blockedProvider: AIProvider = {
      ...fakeProvider,
      async generateStructured() {
        calls++
        throw new AISensitivityError('This project contains Restricted information and cannot be processed by this model.')
      },
    }

    const result = await enrichDocumentChunks(supabase as never, blockedProvider, 'doc-1', 'kb-1')

    expect(result).toEqual({ enriched: 0, failed: 1 })
    expect(calls).toBe(1)
    const updates = supabase._calls.filter((c) => c.table === 'document_chunks' && c.method === 'update')
    expect(updates).toHaveLength(2)
    expect(updates[1].args).toMatchObject({ review_status: 'failed', enrichment_error: { code: 'ai_policy_blocked' } })
  })
})
