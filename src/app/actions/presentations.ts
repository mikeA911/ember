'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import {
  generatePresentation,
  openPresentationReview,
  closePresentationReview,
  startBuilderRevision,
  submitForCuratorReview,
  reopenPresentationReview,
  approvePresentation,
  addSlideComment,
  replyToComment,
  classifyPendingComments,
  updatePresentationAction,
  scheduleReviewOpen,
  cancelScheduledReviewOpen,
} from '@/lib/workbench/presentations'
import { AISensitivityError, SelfHostedAIUnavailableError } from '@/lib/ai'
import type { PresentationActionStatus } from '@/types/database'

// An AI-hosting or sensitivity block is returned as data, not thrown: in
// production a thrown Server Action error reaches the user only as a
// generic digest, and these messages tell them what to do.
function aiPolicyMessage(err: unknown): string | null {
  return err instanceof SelfHostedAIUnavailableError || err instanceof AISensitivityError ? err.message : null
}

export async function generatePresentationAction(projectId: string, workstreamId: string) {
  const ctx = await requireUser()
  let result: Awaited<ReturnType<typeof generatePresentation>>
  try {
    result = await generatePresentation(ctx, workstreamId)
  } catch (err) {
    const message = aiPolicyMessage(err)
    if (message) return { error: message }
    throw err
  }
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}/presentation`)
  return result
}

async function revalidatePresentation(projectId: string, workstreamId: string) {
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}/presentation`)
}

export async function openPresentationReviewAction(projectId: string, workstreamId: string, presentationId: string, reviewDeadline?: string | null) {
  const ctx = await requireUser()
  await openPresentationReview(ctx, presentationId, reviewDeadline)
  await revalidatePresentation(projectId, workstreamId)
}

export async function scheduleReviewOpenAction(
  projectId: string,
  workstreamId: string,
  presentationId: string,
  scheduledOpenAt: string,
  reviewDeadline?: string | null
) {
  const ctx = await requireUser()
  await scheduleReviewOpen(ctx, presentationId, scheduledOpenAt, reviewDeadline)
  await revalidatePresentation(projectId, workstreamId)
}

export async function cancelScheduledReviewOpenAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await cancelScheduledReviewOpen(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function closePresentationReviewAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await closePresentationReview(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function startBuilderRevisionAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await startBuilderRevision(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function submitForCuratorReviewAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await submitForCuratorReview(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function reopenPresentationReviewAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await reopenPresentationReview(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function approvePresentationAction(projectId: string, workstreamId: string, presentationId: string) {
  const ctx = await requireUser()
  await approvePresentation(ctx, presentationId)
  await revalidatePresentation(projectId, workstreamId)
}

export async function addSlideCommentAction(projectId: string, workstreamId: string, versionId: string, slideId: string, commentText: string) {
  const ctx = await requireUser()
  const result = await addSlideComment(ctx, versionId, slideId, commentText)
  await revalidatePresentation(projectId, workstreamId)
  return result
}

export async function replyToCommentAction(projectId: string, workstreamId: string, commentId: string, replyText: string) {
  const ctx = await requireUser()
  await replyToComment(ctx, commentId, replyText)
  await revalidatePresentation(projectId, workstreamId)
}

export async function classifyPendingCommentsAction(projectId: string, workstreamId: string, versionId: string) {
  const ctx = await requireUser()
  let result: Awaited<ReturnType<typeof classifyPendingComments>>
  try {
    result = await classifyPendingComments(ctx, versionId)
  } catch (err) {
    const message = aiPolicyMessage(err)
    if (message) return { error: message }
    throw err
  }
  await revalidatePresentation(projectId, workstreamId)
  return result
}

export async function updatePresentationActionAction(
  projectId: string,
  workstreamId: string,
  actionId: string,
  patch: { status?: PresentationActionStatus; evidence?: string | null }
) {
  const ctx = await requireUser()
  await updatePresentationAction(ctx, actionId, patch)
  await revalidatePresentation(projectId, workstreamId)
}
