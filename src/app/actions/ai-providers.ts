'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import * as workbench from '@/lib/workbench/ai-providers'
import type { AIModelType, AIModelStatus, AIProviderType, InformationSensitivity } from '@/types/database'
import type { CreateModelInput } from '@/lib/workbench/ai-providers'

export type { CreateModelInput }

export async function createProviderAction(input: {
  name: string
  providerType: AIProviderType
  displayName: string
  baseUrl: string | null
  apiKeyEnvVar: string
  supportsModelDiscovery: boolean
}) {
  const ctx = await requireRole('admin')
  await workbench.createProvider(ctx, input)
  revalidatePath('/admin')
}

export async function updateProviderEnabledAction(providerId: string, enabled: boolean) {
  const ctx = await requireRole('admin')
  await workbench.updateProviderEnabled(ctx, providerId, enabled)
  revalidatePath('/admin')
}

export async function setProviderSelfHostedAction(providerId: string, isSelfHosted: boolean) {
  const ctx = await requireRole('admin')
  await workbench.setProviderSelfHosted(ctx, providerId, isSelfHosted)
  revalidatePath(`/admin/providers/${providerId}`)
  revalidatePath('/admin')
}

export async function setProviderMaxSensitivityAction(providerId: string, maxSensitivity: InformationSensitivity) {
  const ctx = await requireRole('admin')
  await workbench.setProviderMaxSensitivity(ctx, providerId, maxSensitivity)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function createModelAction(input: CreateModelInput) {
  const ctx = await requireRole('admin')
  await workbench.createModel(ctx, input)
  revalidatePath(`/admin/providers/${input.providerId}`)
}

export async function updateModelEnabledAction(modelId: string, providerId: string, enabled: boolean) {
  const ctx = await requireRole('admin')
  await workbench.updateModelEnabled(ctx, modelId, enabled)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function setDefaultModelAction(modelId: string, providerId: string, modelType: AIModelType) {
  const ctx = await requireRole('admin')
  await workbench.setDefaultModel(ctx, modelId, modelType)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function setDefaultStructuredOutputModelAction(modelId: string, providerId: string) {
  const ctx = await requireRole('admin')
  await workbench.setDefaultStructuredOutputModel(ctx, modelId)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function updateModelStatusAction(
  modelId: string,
  providerId: string,
  status: AIModelStatus,
  deprecationDate: string | null
) {
  const ctx = await requireRole('admin')
  await workbench.updateModelStatus(ctx, modelId, status, deprecationDate)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function updateModelNotesAction(modelId: string, providerId: string, notes: string) {
  const ctx = await requireRole('admin')
  await workbench.updateModelNotes(ctx, modelId, notes)
  revalidatePath(`/admin/providers/${providerId}`)
}

export async function discoverModelsAction(providerId: string): Promise<{ id: string }[]> {
  const ctx = await requireRole('admin')
  return workbench.discoverModels(ctx, providerId)
}
