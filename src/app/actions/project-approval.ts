'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { approveProjectCreation, rejectProjectCreation, resubmitProjectForApproval } from '@/lib/workbench/project-approval'

export async function approveProjectCreationAction(projectId: string) {
  const ctx = await requireUser()
  await approveProjectCreation(ctx, projectId)
  revalidatePath('/dashboard')
  revalidatePath(`/projects/${projectId}`)
}

export async function rejectProjectCreationAction(projectId: string, reason: string) {
  const ctx = await requireUser()
  await rejectProjectCreation(ctx, projectId, reason)
  revalidatePath('/dashboard')
  revalidatePath(`/projects/${projectId}`)
}

export async function resubmitProjectForApprovalAction(projectId: string) {
  const ctx = await requireUser()
  await resubmitProjectForApproval(ctx, projectId)
  revalidatePath(`/projects/${projectId}`)
}
