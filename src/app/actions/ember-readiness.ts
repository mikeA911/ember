'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import { setProjectReadiness, ReadinessValidationError, type SetReadinessInput } from '@/lib/projects/ember-readiness'

// Ember Readiness, Stage 2. Project owner/curator or platform admin --
// checked inside setProjectReadiness and again by RLS. Failures come back
// as { error } so the reason survives Next's production masking of thrown
// Server Action errors.
export async function setProjectReadinessAction(projectId: string, input: SetReadinessInput): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    await setProjectReadiness(ctx, projectId, input)
  } catch (err) {
    if (err instanceof AuthError || err instanceof ReadinessValidationError) return { error: err.message }
    console.error('setProjectReadinessAction failed', err)
    return { error: 'Could not save Ember readiness' }
  }
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/dashboard')
  return {}
}
