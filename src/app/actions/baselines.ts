'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import { RequirementValidationError } from '@/lib/projects/requirements'
import {
  activateBaseline,
  createBaseline,
  decideDecision,
  decideWaiver,
  deleteDraftBaseline,
  newBaselineVersion,
  requestDecision,
  requestWaiver,
  setBaselineItems,
  updateBaseline,
  withdrawDecision,
  withdrawWaiver,
  type BaselineFieldsInput,
  type DecisionRequestInput,
  type WaiverInput,
} from '@/lib/projects/baselines'

// Solution conformance, Stage 3: baselines, waivers and conformance
// decisions. Failures come back as { error } so the reason survives Next's
// production masking of thrown Server Action errors.
function toError(err: unknown, fallback: string): string {
  if (err instanceof AuthError || err instanceof RequirementValidationError) return err.message
  console.error(fallback, err)
  return fallback
}

function revalidate(projectId: string, baselineId?: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/requirements`, 'layout')
  if (baselineId) revalidatePath(`/projects/${projectId}/requirements/baselines/${baselineId}`)
}

async function run(
  action: (ctx: Awaited<ReturnType<typeof requireUser>>) => Promise<{ projectId: string }>,
  fallback: string,
  baselineId?: string
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await action(ctx)
    revalidate(projectId, baselineId)
    return {}
  } catch (err) {
    return { error: toError(err, fallback) }
  }
}

export async function createBaselineAction(
  projectId: string,
  input: BaselineFieldsInput & { requirementIds?: string[] }
): Promise<{ error?: string; baselineId?: string }> {
  const ctx = await requireUser()
  try {
    const { baselineId } = await createBaseline(ctx, projectId, input)
    revalidate(projectId)
    return { baselineId }
  } catch (err) {
    return { error: toError(err, 'Could not create the baseline') }
  }
}

export async function updateBaselineAction(baselineId: string, input: BaselineFieldsInput) {
  return run((ctx) => updateBaseline(ctx, baselineId, input), 'Could not save the baseline', baselineId)
}

export async function deleteDraftBaselineAction(baselineId: string) {
  return run((ctx) => deleteDraftBaseline(ctx, baselineId), 'Could not delete the baseline')
}

export async function setBaselineItemsAction(baselineId: string, requirementIds: string[]) {
  return run((ctx) => setBaselineItems(ctx, baselineId, requirementIds), 'Could not save the requirements', baselineId)
}

export async function activateBaselineAction(baselineId: string) {
  return run((ctx) => activateBaseline(ctx, baselineId), 'Could not activate the baseline', baselineId)
}

export async function newBaselineVersionAction(baselineId: string): Promise<{ error?: string; baselineId?: string }> {
  const ctx = await requireUser()
  try {
    const result = await newBaselineVersion(ctx, baselineId)
    revalidate(result.projectId, baselineId)
    return { baselineId: result.baselineId }
  } catch (err) {
    return { error: toError(err, 'Could not create the new version') }
  }
}

export async function requestWaiverAction(baselineId: string, input: WaiverInput) {
  return run((ctx) => requestWaiver(ctx, baselineId, input), 'Could not request the waiver', baselineId)
}

export async function decideWaiverAction(baselineId: string, waiverId: string, approve: boolean, note?: string) {
  return run((ctx) => decideWaiver(ctx, waiverId, approve, note), 'Could not record your decision', baselineId)
}

export async function withdrawWaiverAction(baselineId: string, waiverId: string) {
  return run((ctx) => withdrawWaiver(ctx, waiverId), 'Could not withdraw the waiver', baselineId)
}

export async function requestDecisionAction(baselineId: string, input: DecisionRequestInput) {
  return run((ctx) => requestDecision(ctx, baselineId, input), 'Could not request the decision', baselineId)
}

export async function decideDecisionAction(baselineId: string, decisionId: string, input: { approve: boolean; note?: string; conditions?: string }) {
  return run((ctx) => decideDecision(ctx, decisionId, input), 'Could not record your verdict', baselineId)
}

export async function withdrawDecisionAction(baselineId: string, decisionId: string) {
  return run((ctx) => withdrawDecision(ctx, decisionId), 'Could not withdraw the decision', baselineId)
}
