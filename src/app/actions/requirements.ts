'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import {
  createRequirement,
  updateRequirement,
  addRequirementSource,
  removeRequirementSource,
  setRequirementScope,
  addVerificationMethod,
  updateVerificationMethod,
  removeVerificationMethod,
  withdrawRequirement,
  deleteDraftRequirement,
  RequirementValidationError,
  type RequirementFieldsInput,
  type RequirementSourceInput,
  type VerificationMethodInput,
} from '@/lib/projects/requirements'

// Solution conformance, Stage 1. Failures come back as { error } so the
// reason survives Next's production masking of thrown Server Action errors.
function toError(err: unknown, fallback: string): string {
  if (err instanceof AuthError || err instanceof RequirementValidationError) return err.message
  console.error(fallback, err)
  return fallback
}

function revalidate(projectId: string, requirementId?: string) {
  revalidatePath(`/projects/${projectId}`)
  revalidatePath(`/projects/${projectId}/requirements`)
  if (requirementId) revalidatePath(`/projects/${projectId}/requirements/${requirementId}`)
}

async function run<T extends { projectId: string }>(
  action: (ctx: Awaited<ReturnType<typeof requireUser>>) => Promise<T>,
  fallback: string,
  requirementId?: string
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    const { projectId } = await action(ctx)
    revalidate(projectId, requirementId)
    return {}
  } catch (err) {
    return { error: toError(err, fallback) }
  }
}

export async function createRequirementAction(
  projectId: string,
  input: RequirementFieldsInput & { sources: RequirementSourceInput[]; workstreamIds?: string[]; objectIds?: string[] }
): Promise<{ error?: string; requirementId?: string }> {
  const ctx = await requireUser()
  try {
    const { requirementId } = await createRequirement(ctx, projectId, input)
    revalidate(projectId)
    return { requirementId }
  } catch (err) {
    return { error: toError(err, 'Could not create the requirement') }
  }
}

export async function updateRequirementAction(requirementId: string, input: RequirementFieldsInput) {
  return run((ctx) => updateRequirement(ctx, requirementId, input), 'Could not save the requirement', requirementId)
}

export async function addRequirementSourceAction(requirementId: string, input: RequirementSourceInput) {
  return run((ctx) => addRequirementSource(ctx, requirementId, input), 'Could not add the source', requirementId)
}

export async function removeRequirementSourceAction(requirementId: string, sourceId: string) {
  return run((ctx) => removeRequirementSource(ctx, sourceId), 'Could not remove the source', requirementId)
}

export async function setRequirementScopeAction(requirementId: string, input: { workstreamIds: string[]; objectIds: string[] }) {
  return run((ctx) => setRequirementScope(ctx, requirementId, input), 'Could not save the scope', requirementId)
}

export async function addVerificationMethodAction(requirementId: string, input: VerificationMethodInput) {
  return run((ctx) => addVerificationMethod(ctx, requirementId, input), 'Could not add the verification method', requirementId)
}

export async function updateVerificationMethodAction(requirementId: string, methodId: string, input: VerificationMethodInput) {
  return run((ctx) => updateVerificationMethod(ctx, methodId, input), 'Could not save the verification method', requirementId)
}

export async function removeVerificationMethodAction(requirementId: string, methodId: string) {
  return run((ctx) => removeVerificationMethod(ctx, methodId), 'Could not remove the verification method', requirementId)
}

export async function withdrawRequirementAction(requirementId: string) {
  return run((ctx) => withdrawRequirement(ctx, requirementId), 'Could not withdraw the requirement', requirementId)
}

export async function deleteDraftRequirementAction(requirementId: string) {
  return run((ctx) => deleteDraftRequirement(ctx, requirementId), 'Could not delete the requirement')
}
