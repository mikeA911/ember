import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { AIProvider } from '@/lib/ai/provider'
import { AISensitivityError } from '@/lib/ai/sensitivity'
import { enrichChunk } from './enrichment'
import { buildEnrichmentError } from './failures'

// Enriches up to `limit` not-yet-enriched chunks for a document. Each chunk's
// outcome is independent: one failure records enrichment_error + review_status
// 'failed' on that chunk and moves on, rather than aborting the batch or
// silently writing placeholder metadata (see lib/curator/failures.ts).
export async function enrichDocumentChunks(
  supabase: SupabaseClient<Database>,
  provider: AIProvider,
  documentId: string,
  docType: string,
  limit = 10
) {
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('id, chunk_text')
    .eq('document_id', documentId)
    .eq('review_status', 'pending')
    .is('ai_metadata', null)
    .order('chunk_index', { ascending: true })
    .limit(limit)
  if (error) throw error

  const results = { enriched: 0, failed: 0 }

  for (const chunk of chunks ?? []) {
    await supabase.from('document_chunks').update({ review_status: 'enriching' }).eq('id', chunk.id)

    try {
      const metadata = await enrichChunk(provider, chunk.chunk_text, docType)
      await supabase
        .from('document_chunks')
        .update({
          ai_metadata: metadata,
          confidence_score: metadata.confidence ?? null,
          review_status: 'pending',
          enrichment_error: null,
        })
        .eq('id', chunk.id)
      results.enriched++
    } catch (err) {
      const blocked = err instanceof AISensitivityError
      await supabase
        .from('document_chunks')
        .update({ review_status: 'failed', enrichment_error: buildEnrichmentError(err, blocked ? 'ai_policy_blocked' : undefined) })
        .eq('id', chunk.id)
      results.failed++
      // The same policy decision applies to every chunk of this document --
      // stop rather than recording the identical block on each one. The rest
      // stay pending, so they enrich once an eligible model is the default.
      if (blocked) break
    }
  }

  return results
}

export interface ApproveChunkInput {
  chunkId: string
  curatorNotes: string | null
  reviewedBy: string
}

// Approves a chunk, embeds it, and writes the kb_vectors row in one place so
// "approved" and "embedded" can't drift apart the way they could in the old
// app (which logged-and-ignored a failed kb_vectors insert after approving).
// Any failure here throws -- the chunk stays whatever it was before, not
// silently marked approved without a vector.
//
// The reviewer UI has no status guard on Approve (rejectChunk's own comment
// documents this: a chunk can be re-reviewed after already being approved),
// so this must be idempotent -- upsert on kb_vectors' `unique (chunk_id)`
// constraint, not insert. Before this fix, re-clicking Approve on an
// already-approved chunk threw a raw Postgres 23505 duplicate-key error,
// which production redacts to an opaque "Minified React error #441" with no
// indication of what actually went wrong (caught live 2026-09-04 approving
// sandz-general-company-profile.txt).
export async function approveChunk(
  supabase: SupabaseClient<Database>,
  provider: AIProvider,
  input: ApproveChunkInput
) {
  const { data: chunk, error: chunkError } = await supabase
    .from('document_chunks')
    .select('*, document:documents(doc_type, filename)')
    .eq('id', input.chunkId)
    .single()
  if (chunkError || !chunk) throw chunkError ?? new Error('Chunk not found')

  // Re-approving an already-approved chunk (a deliberately allowed
  // re-review, see this function's own comment above) must not double-count
  // it -- only a genuine pending/rejected/etc -> approved transition
  // increments the document's counter, same guard shape as rejectChunk's
  // own wasApproved check below.
  const wasAlreadyApproved = chunk.review_status === 'approved'

  const embedding = await provider.embed({ text: chunk.chunk_text })

  const { error: vectorError } = await supabase.from('kb_vectors').upsert(
    {
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      content: chunk.chunk_text,
      embedding: embedding.embedding,
      embedding_model: embedding.model,
      embedding_dim: embedding.dimensions,
      doc_type: chunk.document?.doc_type ?? '',
      topic: chunk.ai_metadata?.topic ?? null,
      subtopic: chunk.ai_metadata?.subtopic ?? null,
      use_cases: chunk.ai_metadata?.use_cases ?? null,
      key_concepts: chunk.ai_metadata?.key_concepts ?? null,
      relevance_score: chunk.ai_metadata?.relevance_score ?? null,
      curator_notes: input.curatorNotes,
      source_document: chunk.document?.filename ?? null,
      source_page: chunk.source_page,
      source_url: null,
      domain: chunk.document?.doc_type ?? null,
      curator_name: null,
      tags: null,
      chunk_index: chunk.chunk_index,
      word_count: chunk.chunk_size,
      approved_by: input.reviewedBy,
      last_updated: new Date().toISOString(),
    },
    { onConflict: 'chunk_id' }
  )
  if (vectorError) throw vectorError

  const { error: updateError } = await supabase
    .from('document_chunks')
    .update({
      review_status: 'approved',
      curator_notes: input.curatorNotes,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.chunkId)
  if (updateError) throw updateError

  if (!wasAlreadyApproved) await supabase.rpc('increment_approved_chunks', { doc_id: chunk.document_id })
}

export interface RejectChunkInput {
  chunkId: string
  curatorNotes: string | null
  reviewedBy: string
}

export async function rejectChunk(supabase: SupabaseClient<Database>, input: RejectChunkInput) {
  const { data: chunk, error: chunkError } = await supabase
    .from('document_chunks')
    .select('document_id, review_status')
    .eq('id', input.chunkId)
    .single()
  if (chunkError || !chunk) throw chunkError ?? new Error('Chunk not found')

  // A chunk can be re-reviewed after already being approved (no status guard
  // in the reviewer UI) -- if it was, approveChunk already embedded it into
  // kb_vectors, which match_documents (the RAG search RPC) queries directly
  // with no join back to review_status. Without deleting it here, a
  // "rejected" chunk would stay silently retrievable by Ember.
  const wasApproved = chunk.review_status === 'approved'
  const { error: vectorError } = await supabase.from('kb_vectors').delete().eq('chunk_id', input.chunkId)
  if (vectorError) throw vectorError

  const { error } = await supabase
    .from('document_chunks')
    .update({
      review_status: 'rejected',
      curator_notes: input.curatorNotes,
      reviewed_by: input.reviewedBy,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', input.chunkId)
  if (error) throw error

  // Undo the earlier increment_approved_chunks call so the document's
  // approved/total counter (shown throughout the curator/admin UI) doesn't
  // keep counting a chunk that's no longer approved.
  if (wasApproved) await supabase.rpc('decrement_approved_chunks', { doc_id: chunk.document_id })
  await supabase.rpc('increment_rejected_chunks', { doc_id: chunk.document_id })
}

export async function saveChunkDraft(supabase: SupabaseClient<Database>, chunkId: string, curatorNotes: string | null) {
  const { error } = await supabase.from('document_chunks').update({ review_status: 'draft', curator_notes: curatorNotes }).eq('id', chunkId)
  if (error) throw error
}
