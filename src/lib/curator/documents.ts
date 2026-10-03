import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, DocType } from '@/types/database'
import { buildStoragePath, uploadDocument, deleteDocument as deleteStorageObject } from '@/lib/storage'
import { parseDocument, parserForMimeType } from '@/lib/parsing'
import { chunkDocument } from '@/lib/chunking'
import { buildProcessingError } from './failures'

const MAX_FILE_SIZE = 50 * 1024 * 1024
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

// Mobile file pickers (notably Android picking from Drive) can hand over a
// File with an empty or generic type even for a real PDF, which the exact
// ALLOWED_MIME_TYPES check then rejected. Fall back to the extension in
// that case only -- a browser-reported specific type is still trusted.
const MIME_TYPE_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
}

export function resolveUploadMimeType(file: { name: string; type: string }): string {
  if (file.type && file.type !== 'application/octet-stream') return file.type
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_TYPE_BY_EXTENSION[extension] ?? file.type
}

export class DocumentValidationError extends Error {}
export class DocumentPermissionError extends Error {}

export interface UploadDocumentInput {
  file: File
  docType: DocType
  sourceUrl?: string
  uploadedBy: string
}

// Upload + create the `documents` row. Does not parse/chunk -- that's
// processDocument(), a separate step so a slow parse doesn't block the
// upload response and so a parse failure is attributable to its own stage.
//
// Versioned Knowledge Source Documents, Stage 1 (docs/dev-request-versioned-
// knowledge-source-documents.md): every document belongs to a knowledge_source
// (the stable logical-source identity; documents are its immutable versions,
// mirroring wiki_articles/wiki_versions). Stage 1 never creates a second
// version of an existing source, so the new source's current_version_id is
// set to this document immediately -- that's what makes today's retrieval
// timing (a chunk is retrievable the moment a curator approves it, independent
// of admin's later document-level approval) come through unchanged. The
// duplicate-source_url check now runs against knowledge_sources, since
// uniqueness moved up to the logical-source level.
export async function createUploadedDocument(supabase: SupabaseClient<Database>, input: UploadDocumentInput) {
  if (input.file.size > MAX_FILE_SIZE) {
    throw new DocumentValidationError(`File exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }
  const mimeType = resolveUploadMimeType(input.file)
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    throw new DocumentValidationError(`Unsupported file type: ${mimeType || 'unknown'} -- upload a PDF, Word .docx or plain-text .txt file`)
  }

  if (input.sourceUrl) {
    const { data: existing } = await supabase
      .from('knowledge_sources')
      .select('id')
      .eq('knowledge_base_id', input.docType)
      .eq('source_url', input.sourceUrl)
      .maybeSingle()
    if (existing) {
      throw new DocumentValidationError('This document has already been uploaded for this knowledge base')
    }
  }

  const path = buildStoragePath(input.file.name)
  await uploadDocument(supabase, path, input.file, mimeType)

  const { data: source, error: sourceError } = await supabase
    .from('knowledge_sources')
    .insert({
      knowledge_base_id: input.docType,
      title: input.file.name,
      source_url: input.sourceUrl ?? null,
      publisher: null,
      lifecycle_status: 'active',
      created_by: input.uploadedBy,
    })
    .select()
    .single()
  if (sourceError || !source) throw sourceError ?? new Error('Failed to create knowledge source record')

  const { data: doc, error } = await supabase
    .from('documents')
    .insert({
      filename: path.split('/').pop()!,
      original_filename: input.file.name,
      doc_type: input.docType,
      knowledge_source_id: source.id,
      version_number: 1,
      change_note: null,
      superseded_at: null,
      retired_at: null,
      storage_path: path,
      file_size: input.file.size,
      mime_type: mimeType,
      source_url: input.sourceUrl ?? null,
      uploaded_by: input.uploadedBy,
      processing_status: 'pending',
      processing_stage: 'upload',
      processing_error: null,
      total_chunks: null,
      metadata: {},
    })
    .select()
    .single()

  if (error || !doc) throw error ?? new Error('Failed to create document record')

  const { error: pointerError } = await supabase
    .from('knowledge_sources')
    .update({ current_version_id: doc.id })
    .eq('id', source.id)
  if (pointerError) throw pointerError

  return doc
}

// Parse the stored file and write document_chunks. Every failure is recorded
// on the document (processing_status='failed', processing_error populated)
// rather than thrown past the caller silently -- the curator sees exactly
// which stage broke and whether it's worth retrying.
export async function processDocument(supabase: SupabaseClient<Database>, documentId: string) {
  const { data: doc, error: fetchError } = await supabase.from('documents').select('*').eq('id', documentId).single()
  if (fetchError || !doc) throw fetchError ?? new Error('Document not found')

  try {
    await supabase.from('documents').update({ processing_status: 'parsing', processing_stage: 'parse' }).eq('id', documentId)

    const { data: fileBlob, error: downloadError } = await supabase.storage.from('documents').download(doc.storage_path)
    if (downloadError || !fileBlob) throw downloadError ?? new Error('Failed to download stored file')

    const buffer = Buffer.from(await fileBlob.arrayBuffer())
    const parsed = await parseDocument(buffer, doc.mime_type ?? parserForMimeType('text/plain'))

    await supabase.from('documents').update({ processing_stage: 'chunk' }).eq('id', documentId)

    const chunks = chunkDocument(parsed)
    if (chunks.length === 0) {
      throw new Error('Parsing produced no extractable text')
    }

    const { error: insertError } = await supabase.from('document_chunks').insert(
      chunks.map((c) => ({
        document_id: documentId,
        chunk_index: c.chunkIndex,
        chunk_text: c.text,
        chunk_size: c.wordCount,
        source_page: c.sourcePage,
        source_section: c.sourceSection,
        parser: c.parser,
        char_start: c.charStart,
        char_end: c.charEnd,
        ai_metadata: null,
        confidence_score: null,
        review_status: 'pending' as const,
        enrichment_error: null,
        curator_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        is_filtered: false,
        filtered_reason: null,
        metadata_edited: false,
        metadata_edited_by: null,
        metadata_edited_at: null,
      }))
    )
    if (insertError) throw insertError

    await supabase
      .from('documents')
      .update({
        processing_status: 'review',
        processing_stage: 'review',
        processing_error: null,
        total_chunks: chunks.length,
      })
      .eq('id', documentId)
  } catch (err) {
    const stage = doc.processing_stage === 'chunk' ? 'chunk' : 'parse'
    await supabase
      .from('documents')
      .update({
        processing_status: 'failed',
        processing_error: buildProcessingError(stage, err),
      })
      .eq('id', documentId)
    throw err
  }
}

export async function submitDocument(supabase: SupabaseClient<Database>, documentId: string) {
  const { data: chunks, error } = await supabase
    .from('document_chunks')
    .select('review_status')
    .eq('document_id', documentId)
  if (error) throw error

  const unresolved = (chunks ?? []).filter((c) => ['pending', 'draft', 'enriching'].includes(c.review_status))
  if (unresolved.length > 0) {
    throw new DocumentValidationError(`Cannot submit: ${unresolved.length} chunk(s) are still pending or in draft`)
  }

  const { error: updateError } = await supabase
    .from('documents')
    .update({ processing_status: 'submitted', processing_stage: 'review' })
    .eq('id', documentId)
  if (updateError) throw updateError
}

export async function deleteDocumentById(
  supabase: SupabaseClient<Database>,
  documentId: string,
  actingUser: { id: string; role: string }
) {
  const { data: doc, error } = await supabase.from('documents').select('uploaded_by, storage_path').eq('id', documentId).single()
  if (error || !doc) throw error ?? new Error('Document not found')

  if (doc.uploaded_by !== actingUser.id && actingUser.role !== 'admin') {
    throw new DocumentPermissionError('You do not have permission to delete this document')
  }

  try {
    await deleteStorageObject(supabase, doc.storage_path)
  } catch {
    // Storage object may already be gone; the DB row is still the source of
    // truth for whether the document exists, so proceed with the delete.
  }

  const { error: deleteError } = await supabase.from('documents').delete().eq('id', documentId)
  if (deleteError) throw deleteError
}
