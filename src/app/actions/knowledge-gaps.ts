'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import {
  reportEmberAnswer,
  reportTypedFailure,
  triageKnowledgeGap,
  resolveKnowledgeGap,
  promoteKnowledgeGapToEvalCase,
  convertKnowledgeGapToFeedback,
  addKnowledgeGapOccurrenceDetails,
  withdrawKnowledgeGapOccurrence,
  KnowledgeGapValidationError,
  type FailureReportInput,
} from '@/lib/projects/knowledge-gaps'
import type { KnowledgeGapStatus } from '@/types/database'

// Ember Readiness, Stage 3. Failures come back as { error } so the reason
// survives Next's production masking of thrown Server Action errors.
function toError(err: unknown, fallback: string): string {
  if (err instanceof AuthError || err instanceof KnowledgeGapValidationError) return err.message
  if (err && typeof err === 'object' && 'code' in err && err.code === '42501') return 'You can only do this in a Project you belong to'
  console.error(fallback, err)
  return fallback
}

function revalidateProject(projectId: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/dashboard')
}

export async function reportEmberAnswerAction(messageId: string, input: FailureReportInput): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await reportEmberAnswer(ctx, messageId, input)
    revalidateProject(projectId)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not send the report') }
  }
}

export async function reportTypedFailureAction(
  projectId: string,
  input: FailureReportInput & { question: string; emberAnswer?: string }
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    await reportTypedFailure(ctx, projectId, input)
    revalidateProject(projectId)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not send the report') }
  }
}

export async function triageKnowledgeGapAction(
  gapId: string,
  input: { status: KnowledgeGapStatus; note?: string; duplicateOf?: string | null }
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await triageKnowledgeGap(ctx, gapId, input)
    revalidateProject(projectId)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not update the knowledge gap') }
  }
}

export async function resolveKnowledgeGapAction(
  gapId: string,
  input: { resolvingSourceId?: string | null; resolvingArticleId?: string | null; note: string; verifiedAnswers: boolean | null }
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await resolveKnowledgeGap(ctx, gapId, input)
    revalidateProject(projectId)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not resolve the knowledge gap') }
  }
}

export async function promoteKnowledgeGapAction(gapId: string): Promise<{ error?: string; datasetId?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId, datasetId } = await promoteKnowledgeGapToEvalCase(ctx, gapId)
    revalidateProject(projectId)
    revalidatePath(`/evals/datasets/${datasetId}`)
    return { datasetId }
  } catch (err) {
    return { error: toError(err, 'Could not add the test question') }
  }
}

export async function convertKnowledgeGapToFeedbackAction(gapId: string): Promise<{ error?: string; reportNumber?: number }> {
  const ctx = await requireUser()
  try {
    const { projectId, reportNumber } = await convertKnowledgeGapToFeedback(ctx, gapId)
    revalidateProject(projectId)
    return { reportNumber }
  } catch (err) {
    return { error: toError(err, 'Could not file the feedback report') }
  }
}

// Stage 4: under an answer Ember filed as a knowledge gap.
export async function addKnowledgeGapDetailsAction(occurrenceId: string, input: { note: string; suggestedSource: string }): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await addKnowledgeGapOccurrenceDetails(ctx, occurrenceId, input)
    revalidatePath(`/projects/${projectId}`)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not add the details') }
  }
}

export async function withdrawKnowledgeGapAction(occurrenceId: string): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await withdrawKnowledgeGapOccurrence(ctx, occurrenceId)
    if (projectId) revalidateProject(projectId)
    return {}
  } catch (err) {
    return { error: toError(err, 'Could not withdraw it') }
  }
}
