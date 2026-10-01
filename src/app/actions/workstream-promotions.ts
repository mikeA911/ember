'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import {
  submitWorkstreamForPromotion,
  listPendingWorkstreamPromotions,
  listPendingWorkstreamPromotionsForProject,
  approveWorkstreamPromotion,
  rejectWorkstreamPromotion,
} from '@/lib/workbench/workstream-promotions'
import type { FeeInput } from '@/lib/workbench/client-billing'

export async function submitWorkstreamForPromotionAction(
  projectId: string,
  workstreamId: string,
  clientEmails?: string[],
  fee?: FeeInput | null
) {
  const ctx = await requireUser()
  const result = await submitWorkstreamForPromotion(ctx, workstreamId, clientEmails, fee)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
  return result
}

export async function listPendingWorkstreamPromotionsAction() {
  const ctx = await requireUser()
  return listPendingWorkstreamPromotions(ctx)
}

export async function listPendingWorkstreamPromotionsForProjectAction(projectId: string) {
  const ctx = await requireUser()
  return listPendingWorkstreamPromotionsForProject(ctx, projectId)
}

// projectId is optional -- the review action may be reached from either the
// project's own page (the primary path for an ordinary team's own curator)
// the platform-wide /admin tab, or the agency dashboard, and only the
// caller knows which.
export async function approveWorkstreamPromotionAction(promotionId: string, projectId?: string) {
  const ctx = await requireUser()
  const result = await approveWorkstreamPromotion(ctx, promotionId)
  revalidatePath('/admin')
  revalidatePath('/agency')
  if (projectId) revalidatePath(`/projects/${projectId}`)
  return result
}

export async function rejectWorkstreamPromotionAction(promotionId: string, reason?: string, projectId?: string) {
  const ctx = await requireUser()
  await rejectWorkstreamPromotion(ctx, promotionId, reason)
  revalidatePath('/admin')
  revalidatePath('/agency')
  if (projectId) revalidatePath(`/projects/${projectId}`)
}
