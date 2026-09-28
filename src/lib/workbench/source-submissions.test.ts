import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from './context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const createUploadedDocumentMock = vi.fn()
const processDocumentMock = vi.fn()
const deleteDocumentByIdMock = vi.fn()
vi.mock('@/lib/curator/documents', () => ({
  createUploadedDocument: (...args: unknown[]) => createUploadedDocumentMock(...args),
  processDocument: (...args: unknown[]) => processDocumentMock(...args),
  deleteDocumentById: (...args: unknown[]) => deleteDocumentByIdMock(...args),
}))

const approveChunkMock = vi.fn()
vi.mock('@/lib/curator/chunks', () => ({ approveChunk: (...args: unknown[]) => approveChunkMock(...args) }))

const getActiveEmbeddingProviderMock = vi.fn().mockResolvedValue({})
vi.mock('@/lib/ai', () => ({ getActiveEmbeddingProvider: (...args: unknown[]) => getActiveEmbeddingProviderMock(...args) }))

const requireActiveKnowledgeBaseMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/knowledge-bases', () => ({ requireActiveKnowledgeBase: (...args: unknown[]) => requireActiveKnowledgeBaseMock(...args) }))

const getWorkingKnowledgeItemMock = vi.fn()
vi.mock('@/lib/projects/working-knowledge', () => ({ getWorkingKnowledgeItem: (...args: unknown[]) => getWorkingKnowledgeItemMock(...args) }))

const { submitFileSource, submitArtifactSource, submitWorkingKnowledgeSource, approveSourceSubmission, rejectSourceSubmission } =
  await import('./source-submissions')

beforeEach(() => {
  createAdminClientMock.mockReset()
  createUploadedDocumentMock.mockReset()
  processDocumentMock.mockReset()
  deleteDocumentByIdMock.mockReset()
  approveChunkMock.mockReset()
  getActiveEmbeddingProviderMock.mockClear()
  requireActiveKnowledgeBaseMock.mockClear()
  getWorkingKnowledgeItemMock.mockReset()
})

function ctxWith(supabase: unknown, opts: { userId?: string; platformRole?: string } = {}): WorkbenchCallerContext {
  return {
    user: { id: opts.userId ?? 'user-1' },
    profile: { role: opts.platformRole ?? 'consultant' },
    supabase,
  } as unknown as WorkbenchCallerContext
}

const fakeFile = new File(['hello'], 'notes.txt', { type: 'text/plain' })

describe('submitFileSource', () => {
  it('rejects a caller with no active membership on the project', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    await expect(submitFileSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', file: fakeFile })).rejects.toThrow(
      'active member of this project'
    )
    expect(createUploadedDocumentMock).not.toHaveBeenCalled()
  })

  it('rejects a knowledge base that is not attached to this project', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    await expect(submitFileSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', file: fakeFile })).rejects.toThrow(
      'not attached to this project'
    )
    expect(createUploadedDocumentMock).not.toHaveBeenCalled()
  })

  it('lets an active member (any role) upload a document and creates a pending submission', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      project_source_submissions: [{ data: { id: 'sub-1' }, error: null }],
    })
    const admin = createFakeSupabase({})
    createAdminClientMock.mockReturnValue(admin)
    createUploadedDocumentMock.mockResolvedValue({ id: 'doc-1' })

    const result = await submitFileSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', file: fakeFile })

    expect(result).toEqual({ submissionId: 'sub-1' })
    expect(createUploadedDocumentMock).toHaveBeenCalledWith(admin, expect.objectContaining({ docType: 'kb-1', uploadedBy: 'user-1' }))
    const insert = supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ source_kind: 'file', document_id: 'doc-1', submitted_by: 'user-1' })
  })
})

describe('submitArtifactSource', () => {
  it('rejects an artifact that is not yet approved', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      workstream_artifacts: [{ data: { id: 'art-1', title: 'X', content: 'text', status: 'ready_for_review', workstream: { project_id: 'proj-1' } }, error: null }],
    })
    await expect(
      submitArtifactSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', workstreamArtifactId: 'art-1' })
    ).rejects.toThrow('already-approved artifact')
  })

  it('rejects a content-less (link-only) artifact', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      workstream_artifacts: [{ data: { id: 'art-1', title: 'X', content: null, status: 'approved', workstream: { project_id: 'proj-1' } }, error: null }],
    })
    await expect(
      submitArtifactSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', workstreamArtifactId: 'art-1' })
    ).rejects.toThrow('already-approved artifact')
  })

  it("rejects an artifact belonging to a different project's workstream", async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      workstream_artifacts: [{ data: { id: 'art-1', title: 'X', content: 'text', status: 'approved', workstream: { project_id: 'other-project' } }, error: null }],
    })
    await expect(
      submitArtifactSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', workstreamArtifactId: 'art-1' })
    ).rejects.toThrow('does not belong to this project')
  })

  it('accepts an approved, content-bearing artifact from this project', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'consultant' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      workstream_artifacts: [{ data: { id: 'art-1', title: 'Findings', content: 'text', status: 'approved', workstream: { project_id: 'proj-1' } }, error: null }],
      project_source_submissions: [{ data: { id: 'sub-1' }, error: null }],
    })

    const result = await submitArtifactSource(ctxWith(supabase), { projectId: 'proj-1', knowledgeBaseId: 'kb-1', workstreamArtifactId: 'art-1' })

    expect(result).toEqual({ submissionId: 'sub-1' })
    const insert = supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ source_kind: 'artifact', title: 'Findings', workstream_artifact_id: 'art-1' })
  })
})

describe('submitWorkingKnowledgeSource', () => {
  it('rejects a caller with no active membership on the target project', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    await expect(
      submitWorkingKnowledgeSource(ctxWith(supabase), { projectId: 'org-home', knowledgeBaseId: 'kb-1', workingKnowledgeItemId: 'wk-1' })
    ).rejects.toThrow('active member of this project')
    expect(getWorkingKnowledgeItemMock).not.toHaveBeenCalled()
  })

  it('rejects a notebook the caller does not own', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'viewer' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
    })
    getWorkingKnowledgeItemMock.mockResolvedValue({ id: 'wk-1', owner_id: 'someone-else', title: 'X', trust_status: 'working' })
    await expect(
      submitWorkingKnowledgeSource(ctxWith(supabase), { projectId: 'org-home', knowledgeBaseId: 'kb-1', workingKnowledgeItemId: 'wk-1' })
    ).rejects.toThrow("notebook's own owner")
  })

  it('rejects an archived notebook', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'viewer' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
    })
    getWorkingKnowledgeItemMock.mockResolvedValue({ id: 'wk-1', owner_id: 'user-1', title: 'X', trust_status: 'archived' })
    await expect(
      submitWorkingKnowledgeSource(ctxWith(supabase), { projectId: 'org-home', knowledgeBaseId: 'kb-1', workingKnowledgeItemId: 'wk-1' })
    ).rejects.toThrow('archived notebook')
  })

  it('lets the owner (any active project role, e.g. an auto-enrolled viewer) submit their own notebook', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'viewer' }, error: null }],
      project_knowledge_bases: [{ data: { knowledge_base_id: 'kb-1' }, error: null }],
      project_source_submissions: [{ data: { id: 'sub-1' }, error: null }],
    })
    getWorkingKnowledgeItemMock.mockResolvedValue({ id: 'wk-1', owner_id: 'user-1', title: 'Chunking overlap tradeoffs', trust_status: 'working' })

    const result = await submitWorkingKnowledgeSource(ctxWith(supabase), { projectId: 'org-home', knowledgeBaseId: 'kb-1', workingKnowledgeItemId: 'wk-1' })

    expect(result).toEqual({ submissionId: 'sub-1' })
    const insert = supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'insert')
    expect(insert?.args).toMatchObject({
      source_kind: 'working_knowledge',
      title: 'Chunking overlap tradeoffs',
      working_knowledge_item_id: 'wk-1',
      submitted_by: 'user-1',
    })
  })
})

describe('approveSourceSubmission', () => {
  it('rejects a caller who is not this project\'s owner/curator/admin', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [{ data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'file', document_id: 'doc-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(approveSourceSubmission(ctxWith(supabase), 'sub-1')).rejects.toThrow("owner or curator role")
    expect(processDocumentMock).not.toHaveBeenCalled()
  })

  it('is a no-op on a submission that is no longer pending', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [{ data: { id: 'sub-1', project_id: 'proj-1', status: 'approved' }, error: null }],
    })
    await approveSourceSubmission(ctxWith(supabase), 'sub-1')
    expect(processDocumentMock).not.toHaveBeenCalled()
  })

  it('for a file-kind submission, processes the already-uploaded document and auto-approves every chunk', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'file', document_id: 'doc-1' }, error: null },
        { data: [{ id: 'sub-1' }], error: null }, // decision update
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const admin = createFakeSupabase({ document_chunks: [{ data: [{ id: 'chunk-1' }, { id: 'chunk-2' }], error: null }] })
    createAdminClientMock.mockReturnValue(admin)

    await approveSourceSubmission(ctxWith(supabase), 'sub-1')

    expect(processDocumentMock).toHaveBeenCalledWith(admin, 'doc-1')
    expect(approveChunkMock).toHaveBeenCalledTimes(2)
    expect(approveChunkMock.mock.calls[0][2]).toMatchObject({ chunkId: 'chunk-1', reviewedBy: 'user-1' })
    const decisionUpdate = supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'update')
    expect(decisionUpdate?.args).toMatchObject({ status: 'approved', decided_by: 'user-1' })
  })

  it('for an artifact-kind submission, synthesizes a document from the artifact content first', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'artifact', document_id: null, workstream_artifact_id: 'art-1', knowledge_base_id: 'kb-1', submitted_by: 'member-1' }, error: null },
        { data: [{ id: 'sub-1' }], error: null },
      ],
      project_members: [{ data: { role: 'owner' }, error: null }],
    })
    const admin = createFakeSupabase({
      workstream_artifacts: [{ data: { title: 'Findings', content: 'Real content' }, error: null }],
      document_chunks: [{ data: [], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)
    createUploadedDocumentMock.mockResolvedValue({ id: 'doc-synth-1' })

    await approveSourceSubmission(ctxWith(supabase), 'sub-1')

    expect(createUploadedDocumentMock).toHaveBeenCalledWith(
      admin,
      expect.objectContaining({ docType: 'kb-1', uploadedBy: 'member-1' })
    )
    expect(processDocumentMock).toHaveBeenCalledWith(admin, 'doc-synth-1')
  })

  it('for a working_knowledge-kind submission, synthesizes a document from the notebook content', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'org-home', status: 'pending', source_kind: 'working_knowledge', document_id: null, working_knowledge_item_id: 'wk-1', knowledge_base_id: 'kb-1', submitted_by: 'builder-1' }, error: null },
        { data: [{ id: 'sub-1' }], error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const admin = createFakeSupabase({
      working_knowledge_items: [{ data: { title: 'Chunking overlap tradeoffs', content: 'Real notebook content' }, error: null }],
      document_chunks: [{ data: [], error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)
    createUploadedDocumentMock.mockResolvedValue({ id: 'doc-synth-2' })

    await approveSourceSubmission(ctxWith(supabase), 'sub-1')

    expect(createUploadedDocumentMock).toHaveBeenCalledWith(admin, expect.objectContaining({ docType: 'kb-1', uploadedBy: 'builder-1' }))
    expect(processDocumentMock).toHaveBeenCalledWith(admin, 'doc-synth-2')
  })
})

describe('approveSourceSubmission rollback', () => {
  it('when embedding fails for a notebook submission, removes the synthesized source and document and reports why', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'working_knowledge', document_id: null, working_knowledge_item_id: 'wk-1', knowledge_base_id: 'kb-1', submitted_by: 'owner-1' }, error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const admin = createFakeSupabase({
      working_knowledge_items: [{ data: { title: 'NG911 status', content: 'Real notebook content' }, error: null }],
      document_chunks: [{ data: [{ id: 'chunk-1' }], error: null }],
      documents: [{ data: { knowledge_source_id: 'src-1' }, error: null }],
      knowledge_sources: [{ data: null, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)
    createUploadedDocumentMock.mockResolvedValue({ id: 'doc-synth-1' })
    approveChunkMock.mockRejectedValue(new Error('Provider "openai" is enabled but OPENAI_API_KEY is not set'))

    await expect(approveSourceSubmission(ctxWith(supabase), 'sub-1')).rejects.toThrow(
      /Embedding the source failed: Provider "openai" is enabled but OPENAI_API_KEY is not set\. Nothing from this attempt was kept/
    )

    expect(deleteDocumentByIdMock).toHaveBeenCalledWith(admin, 'doc-synth-1', { id: 'user-1', role: 'admin' })
    expect(admin._calls).toContainEqual({ table: 'knowledge_sources', method: 'delete', args: undefined })
    expect(admin._calls).toContainEqual({ table: 'knowledge_sources', method: 'eq', args: { column: 'id', value: 'src-1' } })
    // The submission stays pending -- no decision is recorded for a failed approval.
    expect(supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'update')).toBeUndefined()
  })

  it('when processing fails for a file submission, keeps the uploaded document but clears its chunks for a clean retry', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [{ data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'file', document_id: 'doc-1' }, error: null }],
      project_members: [{ data: { role: 'owner' }, error: null }],
    })
    const admin = createFakeSupabase({ document_chunks: [{ data: null, error: null }], documents: [{ data: null, error: null }] })
    createAdminClientMock.mockReturnValue(admin)
    processDocumentMock.mockRejectedValue(new Error('Parsing produced no extractable text'))

    await expect(approveSourceSubmission(ctxWith(supabase), 'sub-1')).rejects.toThrow(/^Processing the source failed: Parsing produced no extractable text/)

    expect(deleteDocumentByIdMock).not.toHaveBeenCalled()
    expect(admin._calls).toContainEqual({ table: 'document_chunks', method: 'delete', args: undefined })
    expect(admin._calls).toContainEqual({ table: 'documents', method: 'update', args: { processing_status: 'pending', processing_stage: 'upload', total_chunks: null } })
    expect(approveChunkMock).not.toHaveBeenCalled()
  })
})

describe('rejectSourceSubmission', () => {
  it('rejects a caller who is not this project\'s owner/curator/admin', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [{ data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'file', document_id: 'doc-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(rejectSourceSubmission(ctxWith(supabase), 'sub-1')).rejects.toThrow('owner or curator role')
    expect(deleteDocumentByIdMock).not.toHaveBeenCalled()
  })

  it('deletes the already-created document for a rejected file-kind submission', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'file', document_id: 'doc-1' }, error: null },
        { data: [{ id: 'sub-1' }], error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const admin = createFakeSupabase({})
    createAdminClientMock.mockReturnValue(admin)

    await rejectSourceSubmission(ctxWith(supabase), 'sub-1', 'Not relevant')

    expect(deleteDocumentByIdMock).toHaveBeenCalledWith(admin, 'doc-1', expect.objectContaining({ role: 'admin' }))
    const decisionUpdate = supabase._calls.find((c) => c.table === 'project_source_submissions' && c.method === 'update')
    expect(decisionUpdate?.args).toMatchObject({ status: 'rejected', decision_reason: 'Not relevant' })
  })

  it('does not attempt to delete a document for a rejected artifact-kind submission (none was ever created)', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'proj-1', status: 'pending', source_kind: 'artifact', document_id: null }, error: null },
        { data: [{ id: 'sub-1' }], error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })

    await rejectSourceSubmission(ctxWith(supabase), 'sub-1')

    expect(deleteDocumentByIdMock).not.toHaveBeenCalled()
  })

  it('does not attempt to delete a document for a rejected working_knowledge-kind submission (none was ever created)', async () => {
    const supabase = createFakeSupabase({
      project_source_submissions: [
        { data: { id: 'sub-1', project_id: 'org-home', status: 'pending', source_kind: 'working_knowledge', document_id: null }, error: null },
        { data: [{ id: 'sub-1' }], error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })

    await rejectSourceSubmission(ctxWith(supabase), 'sub-1')

    expect(deleteDocumentByIdMock).not.toHaveBeenCalled()
  })
})
