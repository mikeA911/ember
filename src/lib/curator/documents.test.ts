import { describe, it, expect } from 'vitest'
import { createUploadedDocument, submitDocument, DocumentValidationError, resolveUploadMimeType } from './documents'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

function makeFile(name: string, type: string, size: number): File {
  const bytes = new Uint8Array(size)
  return new File([bytes], name, { type })
}

describe('createUploadedDocument', () => {
  it('rejects files over the 50MB limit', async () => {
    const supabase = createFakeSupabase({}) as never
    const file = makeFile('big.pdf', 'application/pdf', 51 * 1024 * 1024)

    await expect(
      createUploadedDocument(supabase, { file, docType: 'fhir', uploadedBy: 'user-1' })
    ).rejects.toBeInstanceOf(DocumentValidationError)
  })

  it('rejects unsupported mime types', async () => {
    const supabase = createFakeSupabase({}) as never
    const file = makeFile('image.png', 'image/png', 1024)

    await expect(
      createUploadedDocument(supabase, { file, docType: 'fhir', uploadedBy: 'user-1' })
    ).rejects.toBeInstanceOf(DocumentValidationError)
  })

  it('rejects a duplicate knowledge-source URL before touching storage', async () => {
    const supabase = createFakeSupabase({
      knowledge_sources: [{ data: { id: 'existing-source' }, error: null }],
    }) as never
    const file = makeFile('doc.txt', 'text/plain', 1024)

    await expect(
      createUploadedDocument(supabase, {
        file,
        docType: 'fhir',
        sourceUrl: 'https://example.com/a',
        uploadedBy: 'user-1',
      })
    ).rejects.toThrow('already been uploaded')
  })

  it('creates a knowledge_source and points its current_version_id at the new document', async () => {
    const supabase = createFakeSupabase({
      knowledge_sources: [
        { data: null, error: null }, // duplicate check: none found
        { data: { id: 'source-1' }, error: null }, // insert
        { data: null, error: null }, // current_version_id update
      ],
      documents: [{ data: { id: 'doc-1' }, error: null }],
    })
    const file = makeFile('doc.txt', 'text/plain', 1024)

    const doc = await createUploadedDocument(supabase as never, {
      file,
      docType: 'fhir',
      sourceUrl: 'https://example.com/a',
      uploadedBy: 'user-1',
    })

    expect(doc).toEqual({ id: 'doc-1' })
    const documentInsert = supabase._calls.find((c) => c.table === 'documents' && c.method === 'insert')
    expect((documentInsert?.args as { knowledge_source_id: string }).knowledge_source_id).toBe('source-1')
    const pointerUpdate = supabase._calls.find((c) => c.table === 'knowledge_sources' && c.method === 'update')
    expect((pointerUpdate?.args as { current_version_id: string }).current_version_id).toBe('doc-1')
  })

  it('creates a knowledge_source even without a source URL, skipping the duplicate check', async () => {
    const supabase = createFakeSupabase({
      knowledge_sources: [
        { data: { id: 'source-2' }, error: null }, // insert (no dup check without sourceUrl)
        { data: null, error: null }, // current_version_id update
      ],
      documents: [{ data: { id: 'doc-2' }, error: null }],
    })
    const file = makeFile('notes.txt', 'text/plain', 1024)

    const doc = await createUploadedDocument(supabase as never, { file, docType: 'fhir', uploadedBy: 'user-1' })
    expect(doc).toEqual({ id: 'doc-2' })
  })
})

describe('submitDocument', () => {
  it('is blocked while any chunk is pending, draft, or enriching', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        { data: [{ review_status: 'approved' }, { review_status: 'pending' }], error: null },
      ],
    }) as never

    await expect(submitDocument(supabase, 'doc-1')).rejects.toBeInstanceOf(DocumentValidationError)
  })

  it('succeeds once every chunk is approved, rejected, or filtered', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        { data: [{ review_status: 'approved' }, { review_status: 'rejected' }, { review_status: 'filtered' }], error: null },
      ],
      documents: [{ data: null, error: null }],
    }) as never

    await expect(submitDocument(supabase, 'doc-1')).resolves.toBeUndefined()
  })
})

describe('resolveUploadMimeType', () => {
  it('trusts a specific browser-reported type', () => {
    expect(resolveUploadMimeType({ name: 'notes.pdf', type: 'text/plain' })).toBe('text/plain')
  })

  it('falls back to the extension when a mobile picker leaves the type empty or generic', () => {
    expect(resolveUploadMimeType({ name: 'Sandz_Infographic_v4.PDF', type: '' })).toBe('application/pdf')
    expect(resolveUploadMimeType({ name: 'brief.docx', type: 'application/octet-stream' })).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  })

  it('leaves an unknown extension unresolved so validation still rejects it', () => {
    expect(resolveUploadMimeType({ name: 'photo.png', type: '' })).toBe('')
  })
})
