'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import { attachWorkstreamKnowledgeBase, detachWorkstreamKnowledgeBase } from '@/lib/workbench/workstream-knowledge-bases'

// { error } rather than a throw, so the reason survives Next's production
// error masking (same as attachKnowledgeBaseAction).
export async function attachWorkstreamKnowledgeBaseAction(
  projectId: string,
  workstreamId: string,
  knowledgeBaseId: string,
  purpose?: string
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    await attachWorkstreamKnowledgeBase(ctx, workstreamId, knowledgeBaseId, purpose)
  } catch (err) {
    if (err instanceof AuthError || err instanceof ProjectValidationError) return { error: err.message }
    return { error: 'Could not attach the knowledge base' }
  }
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
  return {}
}

export async function detachWorkstreamKnowledgeBaseAction(projectId: string, workstreamId: string, knowledgeBaseId: string) {
  const ctx = await requireUser()
  await detachWorkstreamKnowledgeBase(ctx, workstreamId, knowledgeBaseId)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
}
