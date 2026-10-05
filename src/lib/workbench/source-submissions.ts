import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import { requireActiveKnowledgeBase } from '@/lib/knowledge-bases'
import { createUploadedDocument, processDocument, deleteDocumentById } from '@/lib/curator/documents'
import { approveChunk } from '@/lib/curator/chunks'
import { gateProvider, getActiveEmbeddingProvider, manifestForDocuments } from '@/lib/ai'
import { getWorkingKnowledgeItem } from '@/lib/projects/working-knowledge'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Member-submitted knowledge sources, with project-curator approval.
// Adding anything to a KB has always required *platform* curator/admin role
// (is_curator_or_admin RLS on documents/knowledge_sources/document_chunks/
// kb_vectors) -- project role was never consulted. This module deliberately
// never touches that RLS. Every privilege-crossing write below (a member
// with no RLS path into those tables; a project curator without platform-
// curator standing) goes through the admin/service-role client, gated by an
// explicit in-code check first -- same pattern as createAndAddProjectMember
// in projects.ts. See supabase/migrations/20260904100001_project_source_
// submissions.sql and docs/test-reports -- this is the workflow the
// 2026-09-03 Sandz pilot prep session scoped: "each curator invites their
// staff to add sources."

async function requireProjectCuratorOrAdmin(ctx: WorkbenchCallerContext, projectId: string): Promise<void> {
  if (ctx.profile.role === 'admin') return
  const role = await getActiveProjectRole(ctx, projectId)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError('Requires this project\'s owner or curator role (or platform admin) to decide a source submission')
  }
}

async function requireProjectAttachedKnowledgeBase(ctx: WorkbenchCallerContext, projectId: string, knowledgeBaseId: string): Promise<void> {
  await requireActiveKnowledgeBase(ctx.supabase, knowledgeBaseId)
  const { data } = await ctx.supabase
    .from('project_knowledge_bases')
    .select('knowledge_base_id')
    .eq('project_id', projectId)
    .eq('knowledge_base_id', knowledgeBaseId)
    .maybeSingle()
  if (!data) throw new ProjectValidationError('This knowledge base is not attached to this project')
}

// Every chunk from a just-processed document gets embedded and inserted
// into kb_vectors immediately (approveChunk, src/lib/curator/chunks.ts --
// unmodified), rather than left pending for one-by-one curator review. They
// stay fully re-reviewable afterward through the existing /review/[docId]
// page -- rejectChunk already supports pulling back an approved chunk.
async function autoApproveAllChunks(ctx: WorkbenchCallerContext, documentId: string, decidedBy: string): Promise<void> {
  const admin = createAdminClient()
  const { data: chunks, error } = await admin.from('document_chunks').select('id').eq('document_id', documentId)
  if (error) throw error

  const manifest = () => manifestForDocuments([documentId])
  for (const chunk of chunks ?? []) {
    const provider = await gateProvider(
      admin,
      await getActiveEmbeddingProvider(admin, { task: 'chunk_embedding', documentId, chunkId: chunk.id, requestedBy: decidedBy }),
      manifest,
      'foundational'
    )
    await approveChunk(admin, provider, {
      chunkId: chunk.id,
      curatorNotes: 'Auto-approved on source submission approval -- eligible for re-review.',
      reviewedBy: decidedBy,
    })
  }
}

// Thrown when approving a submission fails part-way (processing or
// embedding). The message is written for the curator who clicked Approve --
// the action layer returns it as-is, because a thrown Server Action error is
// replaced by a generic digest in production. Whatever this approval attempt
// created has already been rolled back when it's thrown.
export class SourceApprovalError extends Error {}

// Undoes what one failed approveSourceSubmission attempt created, so
// clicking Approve again starts clean instead of leaving a duplicate source
// behind. A document synthesized for this approval (artifact / notebook
// kinds) goes entirely: its source row, the document, and -- by cascade --
// its chunks and any vectors already written. A file-kind submission's
// document predates the approval (it's what the submitter uploaded), so only
// the chunks this attempt produced are removed and the document is reset to
// be processed again. Best-effort: a rollback failure is logged, never
// allowed to mask the original error.
async function rollBackFailedApproval(ctx: WorkbenchCallerContext, documentId: string, synthesizedForApproval: boolean): Promise<void> {
  const admin = createAdminClient()
  try {
    if (synthesizedForApproval) {
      const { data: doc } = await admin.from('documents').select('knowledge_source_id').eq('id', documentId).maybeSingle()
      await deleteDocumentById(admin, documentId, { id: ctx.user.id, role: 'admin' })
      if (doc?.knowledge_source_id) {
        const { error } = await admin.from('knowledge_sources').delete().eq('id', doc.knowledge_source_id)
        if (error) throw error
      }
    } else {
      const { error: chunkError } = await admin.from('document_chunks').delete().eq('document_id', documentId)
      if (chunkError) throw chunkError
      const { error: resetError } = await admin
        .from('documents')
        .update({ processing_status: 'pending', processing_stage: 'upload', total_chunks: null })
        .eq('id', documentId)
      if (resetError) throw resetError
    }
  } catch (rollbackError) {
    console.error(`Failed to roll back a failed source approval (document ${documentId})`, rollbackError)
  }
}

export interface SubmitFileSourceInput {
  projectId: string
  knowledgeBaseId: string
  file: File
  sourceUrl?: string
}

export async function submitFileSource(ctx: WorkbenchCallerContext, input: SubmitFileSourceInput): Promise<{ submissionId: string }> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to submit a source')
  const role = await getActiveProjectRole(ctx, input.projectId)
  if (!role) throw new AuthError('You must be an active member of this project to submit a source')
  await requireProjectAttachedKnowledgeBase(ctx, input.projectId, input.knowledgeBaseId)

  // Admin client: an ordinary member has no RLS path into documents/
  // knowledge_sources at all (is_curator_or_admin-only) -- the check above
  // is the real gate, not RLS, same as createAndAddProjectMember. Uploaded
  // once, here -- never re-materialized at approval time.
  const admin = createAdminClient()
  const doc = await createUploadedDocument(admin, {
    file: input.file,
    docType: input.knowledgeBaseId,
    sourceUrl: input.sourceUrl,
    uploadedBy: ctx.user.id,
  })

  const { data: submission, error } = await ctx.supabase
    .from('project_source_submissions')
    .insert({
      project_id: input.projectId,
      knowledge_base_id: input.knowledgeBaseId,
      source_kind: 'file',
      title: input.file.name,
      document_id: doc.id,
      submitted_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !submission) throw error ?? new ProjectValidationError('Failed to create source submission')

  return { submissionId: submission.id }
}

export interface SubmitArtifactSourceInput {
  projectId: string
  knowledgeBaseId: string
  workstreamArtifactId: string
}

export async function submitArtifactSource(ctx: WorkbenchCallerContext, input: SubmitArtifactSourceInput): Promise<{ submissionId: string }> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to submit a source')
  const role = await getActiveProjectRole(ctx, input.projectId)
  if (!role) throw new AuthError('You must be an active member of this project to submit a source')
  await requireProjectAttachedKnowledgeBase(ctx, input.projectId, input.knowledgeBaseId)

  // Only an already-approved, content-bearing artifact from a workstream in
  // *this* project is eligible -- a link-only artifact (external_url, no
  // content) has nothing to chunk, and an artifact from a different
  // project's workstream has no business entering this project's KB.
  const { data: artifact, error: artifactError } = await ctx.supabase
    .from('workstream_artifacts')
    .select('id, title, content, status, workstream:project_workstreams(project_id)')
    .eq('id', input.workstreamArtifactId)
    .single()
  if (artifactError || !artifact) throw artifactError ?? new ProjectValidationError('Artifact not found')
  if (artifact.status !== 'approved' || !artifact.content) {
    throw new ProjectValidationError('Only an already-approved artifact with inline content can be submitted as a source')
  }
  const workstreamProjectId = (artifact.workstream as unknown as { project_id: string } | null)?.project_id
  if (workstreamProjectId !== input.projectId) {
    throw new ProjectValidationError('This artifact does not belong to this project')
  }

  const { data: submission, error } = await ctx.supabase
    .from('project_source_submissions')
    .insert({
      project_id: input.projectId,
      knowledge_base_id: input.knowledgeBaseId,
      source_kind: 'artifact',
      title: artifact.title,
      workstream_artifact_id: artifact.id,
      submitted_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !submission) throw error ?? new ProjectValidationError('Failed to create source submission')

  return { submissionId: submission.id }
}

// KB Sandbox Builder MVP (docs/dev-request-kb-sandbox-builder-product.md):
// the promotion bridge from a builder's own private Working Knowledge
// notebook into curator-reviewed content -- most concretely, the operator's
// Organization Home Project KB every builder is already auto-enrolled into
// as a viewer (enrollInOrganizationHome, projects.ts). Mirrors
// submitArtifactSource exactly: content is snapshotted only at approval
// time (see approveSourceSubmission below), not here.
export interface SubmitWorkingKnowledgeSourceInput {
  projectId: string
  knowledgeBaseId: string
  workingKnowledgeItemId: string
}

export async function submitWorkingKnowledgeSource(
  ctx: WorkbenchCallerContext,
  input: SubmitWorkingKnowledgeSourceInput
): Promise<{ submissionId: string }> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to submit a source')
  const role = await getActiveProjectRole(ctx, input.projectId)
  if (!role) throw new AuthError('You must be an active member of this project to submit a source')
  await requireProjectAttachedKnowledgeBase(ctx, input.projectId, input.knowledgeBaseId)

  // Only the notebook's own owner may promote it -- RLS already limits what
  // getWorkingKnowledgeItem can even find (can_view_working_knowledge_item),
  // but ownership specifically (not merely visibility, e.g. a shared
  // recipient) is the bar for proposing a promotion.
  const item = await getWorkingKnowledgeItem(ctx, input.workingKnowledgeItemId)
  if (!item || item.owner_id !== ctx.user.id) {
    throw new ProjectValidationError('Only the notebook\'s own owner can submit it as a candidate source')
  }
  if (item.trust_status === 'archived') {
    throw new ProjectValidationError('An archived notebook cannot be submitted as a candidate source')
  }

  const { data: submission, error } = await ctx.supabase
    .from('project_source_submissions')
    .insert({
      project_id: input.projectId,
      knowledge_base_id: input.knowledgeBaseId,
      source_kind: 'working_knowledge',
      title: item.title,
      working_knowledge_item_id: item.id,
      submitted_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !submission) throw error ?? new ProjectValidationError('Failed to create source submission')

  return { submissionId: submission.id }
}

export async function listSourceSubmissions(ctx: WorkbenchCallerContext, projectId: string) {
  // RLS (project_source_submissions_select_own_or_curator) is the real gate
  // here, same convention as addProjectMember -- the caller's own client
  // only ever returns what they're legitimately allowed to see.
  const { data, error } = await ctx.supabase
    .from('project_source_submissions')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function approveSourceSubmission(ctx: WorkbenchCallerContext, submissionId: string): Promise<void> {
  const { data: submission, error: fetchError } = await ctx.supabase
    .from('project_source_submissions')
    .select('*')
    .eq('id', submissionId)
    .single()
  if (fetchError || !submission) throw fetchError ?? new ProjectValidationError('Submission not found')
  if (submission.status !== 'pending') return

  await requireProjectCuratorOrAdmin(ctx, submission.project_id)

  const admin = createAdminClient()
  let documentId = submission.document_id

  if (submission.source_kind === 'artifact') {
    const { data: artifact, error: artifactError } = await admin
      .from('workstream_artifacts')
      .select('title, content')
      .eq('id', submission.workstream_artifact_id!)
      .single()
    if (artifactError || !artifact?.content) throw artifactError ?? new ProjectValidationError('Artifact content is missing')

    // Wraps the artifact's already-approved text as a plain-text "file" so
    // the exact same createUploadedDocument/processDocument pipeline used
    // for a real upload applies unchanged -- no bespoke chunking path.
    const file = new File([artifact.content], `${artifact.title}.txt`, { type: 'text/plain' })
    const doc = await createUploadedDocument(admin, {
      file,
      docType: submission.knowledge_base_id,
      uploadedBy: submission.submitted_by,
    })
    documentId = doc.id
  }
  if (submission.source_kind === 'working_knowledge') {
    const { data: item, error: itemError } = await admin
      .from('working_knowledge_items')
      .select('title, content')
      .eq('id', submission.working_knowledge_item_id!)
      .single()
    if (itemError || !item?.content) throw itemError ?? new ProjectValidationError('Notebook content is missing')

    // Same "wrap as a plain-text file, reuse the real upload pipeline"
    // approach as the artifact branch above -- a promoted notebook becomes
    // ordinary curated content from this point on, same document/chunk/
    // embedding path as everything else in this KB.
    const file = new File([item.content], `${item.title}.txt`, { type: 'text/plain' })
    const doc = await createUploadedDocument(admin, {
      file,
      docType: submission.knowledge_base_id,
      uploadedBy: submission.submitted_by,
    })
    documentId = doc.id
  }
  if (!documentId) throw new ProjectValidationError('This submission has no document to approve')

  const synthesizedForApproval = documentId !== submission.document_id
  let stage: 'process' | 'embed' = 'process'
  try {
    await processDocument(admin, documentId)
    stage = 'embed'
    await autoApproveAllChunks(ctx, documentId, ctx.user.id)
  } catch (err) {
    await rollBackFailedApproval(ctx, documentId, synthesizedForApproval)
    const reason = (err instanceof Error ? err.message : String(err)).replace(/[.\s]+$/, '')
    throw new SourceApprovalError(
      `${stage === 'embed' ? 'Embedding the source failed' : 'Processing the source failed'}: ${reason}. Nothing from this attempt was kept -- fix the cause and approve again.`
    )
  }

  // Decision update through the caller's own RLS-scoped client, not the
  // admin client -- if requireProjectCuratorOrAdmin above were ever wrong,
  // RLS (project_source_submissions_decide_curator) is the backstop, same
  // "zero rows updated = no permission" pattern as decideResourceAccessRequest.
  const { data: updated, error: updateError } = await ctx.supabase
    .from('project_source_submissions')
    .update({ status: 'approved', decided_by: ctx.user.id, decided_at: new Date().toISOString(), document_id: documentId })
    .eq('id', submissionId)
    .select('id')
  if (updateError) throw updateError
  if (!updated || updated.length === 0) throw new ProjectValidationError('You do not have permission to decide this submission')
}

export async function rejectSourceSubmission(ctx: WorkbenchCallerContext, submissionId: string, reason?: string): Promise<void> {
  const { data: submission, error: fetchError } = await ctx.supabase
    .from('project_source_submissions')
    .select('*')
    .eq('id', submissionId)
    .single()
  if (fetchError || !submission) throw fetchError ?? new ProjectValidationError('Submission not found')
  if (submission.status !== 'pending') return

  await requireProjectCuratorOrAdmin(ctx, submission.project_id)

  // A file-kind submission already has a real (unapproved) document sitting
  // in storage since submission time -- clean it up rather than leaving an
  // orphaned, never-reviewed document behind. deleteDocumentById's own
  // permission check is satisfied by asserting 'admin' here: authorization
  // for this call was already established above, via the project's own
  // curator/owner authority, not the uploader/platform-admin check that
  // function normally enforces.
  if (submission.source_kind === 'file' && submission.document_id) {
    const admin = createAdminClient()
    await deleteDocumentById(admin, submission.document_id, { id: ctx.user.id, role: 'admin' })
  }

  const { data: updated, error: updateError } = await ctx.supabase
    .from('project_source_submissions')
    .update({ status: 'rejected', decided_by: ctx.user.id, decided_at: new Date().toISOString(), decision_reason: reason?.trim() || null })
    .eq('id', submissionId)
    .select('id')
  if (updateError) throw updateError
  if (!updated || updated.length === 0) throw new ProjectValidationError('You do not have permission to decide this submission')
}
