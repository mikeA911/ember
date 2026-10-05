'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { gateProvider, getActiveEmbeddingProvider, getActiveStructuredOutputProvider, manifestForDocuments } from '@/lib/ai'
import {
  createUploadedDocument,
  processDocument,
  submitDocument,
  deleteDocumentById,
} from '@/lib/curator/documents'
import { enrichDocumentChunks, approveChunk, rejectChunk, saveChunkDraft } from '@/lib/curator/chunks'
import { requireActiveKnowledgeBase } from '@/lib/knowledge-bases'

export async function uploadAndProcessDocument(formData: FormData) {
  const { user, supabase } = await requireRole('curator')

  const file = formData.get('file') as File | null
  const docType = formData.get('docType') as string | null
  const sourceUrl = (formData.get('sourceUrl') as string | null) || undefined

  if (!file || file.size === 0) throw new Error('No file provided')
  if (!docType) throw new Error('No knowledge base selected')
  await requireActiveKnowledgeBase(supabase, docType)

  const doc = await createUploadedDocument(supabase, { file, docType, sourceUrl, uploadedBy: user.id })

  await processDocument(supabase, doc.id)

  // Foundational: ungated unless EMBER_GATE_FOUNDATIONAL_AI is on. When it
  // is, the manifest includes the floor inherited from Projects that use
  // this knowledge base -- the source is brand new and unclassified here
  // (src/lib/ai/policy-manifests.ts).
  const provider = await gateProvider(
    supabase,
    await getActiveStructuredOutputProvider(supabase, { task: 'chunk_enrichment', documentId: doc.id, requestedBy: user.id }),
    () => manifestForDocuments([doc.id]),
    'foundational'
  )
  await enrichDocumentChunks(supabase, provider, doc.id, docType, 10)

  revalidatePath('/dashboard')
  return { documentId: doc.id }
}

// The chunk-review actions below return failures instead of throwing them:
// in production a thrown Server Action error reaches the reviewer only as a
// generic digest (React #441), which hides fixable causes like a missing or
// rejected AI provider key. They're curator-only, so the message is shown
// as-is and also logged.
export type ReviewActionResult = { ok: true } | { ok: false; error: string }

function failure(label: string, err: unknown): { ok: false; error: string } {
  console.error(`${label} failed`, err)
  return { ok: false, error: err instanceof Error ? err.message : String(err) }
}

export async function enrichMoreChunks(
  documentId: string,
  docType: string
): Promise<({ ok: true } & Awaited<ReturnType<typeof enrichDocumentChunks>>) | { ok: false; error: string }> {
  const { user, supabase } = await requireRole('curator')
  try {
    const provider = await gateProvider(
      supabase,
      await getActiveStructuredOutputProvider(supabase, { task: 'chunk_enrichment', documentId, requestedBy: user.id }),
      () => manifestForDocuments([documentId]),
      'foundational'
    )
    const result = await enrichDocumentChunks(supabase, provider, documentId, docType, 10)
    return { ok: true, ...result }
  } catch (err) {
    return failure('enrichMoreChunks', err)
  } finally {
    revalidatePath(`/review/${documentId}`)
  }
}

export async function approveChunkAction(chunkId: string, documentId: string, curatorNotes: string | null): Promise<ReviewActionResult> {
  const { user, supabase } = await requireRole('curator')
  try {
    const provider = await gateProvider(
      supabase,
      await getActiveEmbeddingProvider(supabase, { task: 'chunk_embedding', documentId, chunkId, requestedBy: user.id }),
      () => manifestForDocuments([documentId]),
      'foundational'
    )
    await approveChunk(supabase, provider, { chunkId, curatorNotes, reviewedBy: user.id })
    return { ok: true }
  } catch (err) {
    return failure('approveChunkAction', err)
  } finally {
    revalidatePath(`/review/${documentId}`)
  }
}

// "Approve all remaining" on the review page: every chunk not yet decided
// (pending, draft, or whose optional metadata step failed -- never one
// already approved, rejected, or filtered out by the pipeline) is approved
// and embedded in document order, with the same
// approveChunk path as the single-chunk button. Stops at the first failure
// and reports how many made it, so a retry simply continues where it left
// off. Sequential embedding calls are well within the review page's
// maxDuration for a normal document; a very large one can be finished by
// clicking again.
export async function approveRemainingChunksAction(
  documentId: string
): Promise<{ ok: true; approved: number } | { ok: false; approved: number; error: string }> {
  const { user, supabase } = await requireRole('curator')
  let approved = 0
  try {
    const { data: chunks, error } = await supabase
      .from('document_chunks')
      .select('id')
      .eq('document_id', documentId)
      .eq('is_filtered', false)
      .in('review_status', ['pending', 'draft', 'failed'])
      .order('chunk_index', { ascending: true })
    if (error) throw error
    if (!chunks || chunks.length === 0) return { ok: true, approved: 0 }

    const provider = await gateProvider(
      supabase,
      await getActiveEmbeddingProvider(supabase, { task: 'chunk_embedding', documentId, requestedBy: user.id }),
      () => manifestForDocuments([documentId]),
      'foundational'
    )
    for (const chunk of chunks) {
      await approveChunk(supabase, provider, { chunkId: chunk.id, curatorNotes: null, reviewedBy: user.id })
      approved++
    }
    return { ok: true, approved }
  } catch (err) {
    return { ...failure('approveRemainingChunksAction', err), approved }
  } finally {
    revalidatePath(`/review/${documentId}`)
  }
}

export async function rejectChunkAction(chunkId: string, documentId: string, curatorNotes: string | null): Promise<ReviewActionResult> {
  const { user, supabase } = await requireRole('curator')
  try {
    await rejectChunk(supabase, { chunkId, curatorNotes, reviewedBy: user.id })
    return { ok: true }
  } catch (err) {
    return failure('rejectChunkAction', err)
  } finally {
    revalidatePath(`/review/${documentId}`)
  }
}

export async function saveChunkDraftAction(chunkId: string, documentId: string, curatorNotes: string | null): Promise<ReviewActionResult> {
  const { supabase } = await requireRole('curator')
  try {
    await saveChunkDraft(supabase, chunkId, curatorNotes)
    return { ok: true }
  } catch (err) {
    return failure('saveChunkDraftAction', err)
  } finally {
    revalidatePath(`/review/${documentId}`)
  }
}

export async function submitDocumentAction(documentId: string): Promise<ReviewActionResult> {
  const { supabase } = await requireRole('curator')
  try {
    await submitDocument(supabase, documentId)
    return { ok: true }
  } catch (err) {
    return failure('submitDocumentAction', err)
  } finally {
    revalidatePath(`/review/${documentId}`)
    revalidatePath('/dashboard')
  }
}

export async function deleteDocumentAction(documentId: string) {
  const { user, profile, supabase } = await requireRole('consultant')
  await deleteDocumentById(supabase, documentId, { id: user.id, role: profile.role })
  revalidatePath('/dashboard')
}
