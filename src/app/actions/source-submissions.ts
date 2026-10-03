'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import {
  submitFileSource,
  submitArtifactSource,
  submitWorkingKnowledgeSource,
  listSourceSubmissions,
  approveSourceSubmission,
  rejectSourceSubmission,
  SourceApprovalError,
} from '@/lib/workbench/source-submissions'
import { DocumentValidationError } from '@/lib/curator/documents'

// FormData, not a plain object, since it carries a File -- same shape as
// uploadAndProcessDocument (src/app/actions/curator.ts).
// Returns the failure instead of throwing it, same reason as
// approveSourceSubmissionAction below: a thrown Server Action error reaches
// the submitter only as React #441 in production, which hid why a PDF upload
// failed. Validation/auth errors and Supabase Storage rejections (e.g. a
// bucket size limit) are user-fixable, so their message is passed through;
// anything else is logged server-side.
export async function submitFileSourceAction(
  formData: FormData
): Promise<{ ok: true; submissionId: string } | { ok: false; error: string }> {
  const ctx = await requireUser()
  const projectId = formData.get('projectId') as string | null
  const knowledgeBaseId = formData.get('knowledgeBaseId') as string | null
  const file = formData.get('file') as File | null
  const sourceUrl = (formData.get('sourceUrl') as string | null) || undefined
  if (!projectId) return { ok: false, error: 'No project specified' }
  if (!knowledgeBaseId) return { ok: false, error: 'No knowledge base selected' }
  if (!file || file.size === 0) return { ok: false, error: 'No file provided' }

  try {
    const result = await submitFileSource(ctx, { projectId, knowledgeBaseId, file, sourceUrl })
    revalidatePath(`/projects/${projectId}`)
    return { ok: true, submissionId: result.submissionId }
  } catch (err) {
    if (err instanceof DocumentValidationError || err instanceof ProjectValidationError || err instanceof AuthError) {
      return { ok: false, error: err.message }
    }
    if (err instanceof Error && '__isStorageError' in err) {
      return { ok: false, error: `Storing the file failed: ${err.message}` }
    }
    console.error('submitFileSourceAction failed', err)
    return { ok: false, error: 'Submitting this file failed unexpectedly. Please try again, or ask a platform admin to check the server logs.' }
  }
}

export async function submitArtifactSourceAction(input: { projectId: string; knowledgeBaseId: string; workstreamArtifactId: string }) {
  const ctx = await requireUser()
  const result = await submitArtifactSource(ctx, input)
  revalidatePath(`/projects/${input.projectId}`)
  return result
}

export async function submitWorkingKnowledgeSourceAction(input: { projectId: string; knowledgeBaseId: string; workingKnowledgeItemId: string }) {
  const ctx = await requireUser()
  const result = await submitWorkingKnowledgeSource(ctx, input)
  revalidatePath(`/projects/${input.projectId}`)
  return result
}

export async function listSourceSubmissionsAction(projectId: string) {
  const ctx = await requireUser()
  return listSourceSubmissions(ctx, projectId)
}

// Returns the failure instead of throwing it: in production a thrown Server
// Action error reaches the client only as a generic digest (React #441), so
// the curator would never learn why -- e.g. that the embedding provider's
// API key isn't configured. Only these known, curator-facing errors are
// passed through verbatim; anything else is logged server-side.
export async function approveSourceSubmissionAction(
  projectId: string,
  submissionId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await requireUser()
  try {
    await approveSourceSubmission(ctx, submissionId)
  } catch (err) {
    if (err instanceof SourceApprovalError || err instanceof ProjectValidationError || err instanceof AuthError) {
      return { ok: false, error: err.message }
    }
    console.error('approveSourceSubmissionAction failed', err)
    return { ok: false, error: 'Approving this source failed unexpectedly. Please try again, or ask a platform admin to check the server logs.' }
  } finally {
    revalidatePath(`/projects/${projectId}`)
  }
  return { ok: true }
}

export async function rejectSourceSubmissionAction(projectId: string, submissionId: string, reason?: string) {
  const ctx = await requireUser()
  await rejectSourceSubmission(ctx, submissionId, reason)
  revalidatePath(`/projects/${projectId}`)
}
