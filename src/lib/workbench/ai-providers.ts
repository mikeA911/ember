import 'server-only'
import OpenAI from 'openai'
import { env } from '@/lib/env'
import { AIConfigError } from '@/lib/ai'
import type { AIModelType, AIModelStatus, AIProviderType, InformationSensitivity } from '@/types/database'
import type { WorkbenchCallerContext } from './context'

// Model/provider configuration is admin-only throughout this module --
// consultants and curators can *select* from enabled models (see
// RunConfigForm) but never modify credentials or the registry itself. Every
// function here assumes the caller has already verified ctx.profile.role
// === 'admin' (requireRole('admin') on the cookie path today).

export async function createProvider(
  ctx: WorkbenchCallerContext,
  input: {
    name: string
    providerType: AIProviderType
    displayName: string
    baseUrl: string | null
    apiKeyEnvVar: string
    supportsModelDiscovery: boolean
  }
) {
  const { error } = await ctx.supabase.from('ai_providers').insert({
    name: input.name,
    provider_type: input.providerType,
    display_name: input.displayName,
    base_url: input.baseUrl,
    api_key_env_var: input.apiKeyEnvVar,
    enabled: true,
    supports_model_discovery: input.supportsModelDiscovery,
  })
  if (error) throw error
}

export async function updateProviderEnabled(ctx: WorkbenchCallerContext, providerId: string, enabled: boolean) {
  const { error } = await ctx.supabase.from('ai_providers').update({ enabled }).eq('id', providerId)
  if (error) throw error
}

// Marks the provider as running on Sandz infrastructure. A Live client
// Project may use only these for content AI calls
// (src/lib/ai/hosting-policy.ts). Admin only (ai_providers RLS).
export async function setProviderSelfHosted(ctx: WorkbenchCallerContext, providerId: string, isSelfHosted: boolean) {
  const { error } = await ctx.supabase.from('ai_providers').update({ is_self_hosted: isSelfHosted }).eq('id', providerId)
  if (error) throw error
}

// Information Sensitivity Classification (Shadow AI blog, 2026-08-28) --
// the highest sensitivity tier this provider is approved to receive. Admin
// only (RLS: ai_provider_sensitivity_eligibility_admin_manage). No row =
// treated as 'internal'-only by the enforcement side (src/lib/ai/sensitivity.ts),
// so this upsert is the only way to raise a provider's ceiling.
export async function setProviderMaxSensitivity(ctx: WorkbenchCallerContext, providerId: string, maxSensitivity: InformationSensitivity) {
  const { error } = await ctx.supabase
    .from('ai_provider_sensitivity_eligibility')
    .upsert({ provider_id: providerId, max_sensitivity: maxSensitivity, updated_by: ctx.user.id }, { onConflict: 'provider_id' })
  if (error) throw error
}

export interface CreateModelInput {
  providerId: string
  modelId: string
  displayName: string
  modelType: AIModelType
  contextWindow: number | null
  maxOutputTokens: number | null
  embeddingDimensions: number | null
  supportsStructuredOutput: boolean
  supportsTools: boolean
  supportsReasoning: boolean
  supportsVision: boolean
}

export async function createModel(ctx: WorkbenchCallerContext, input: CreateModelInput) {
  const { error } = await ctx.supabase.from('ai_models').insert({
    provider_id: input.providerId,
    model_id: input.modelId,
    display_name: input.displayName || input.modelId,
    model_type: input.modelType,
    enabled: true,
    is_default: false,
    is_default_structured_output: false,
    context_window: input.contextWindow,
    max_output_tokens: input.maxOutputTokens,
    input_cost_per_million: null,
    cached_input_cost_per_million: null,
    output_cost_per_million: null,
    embedding_dimensions: input.embeddingDimensions,
    supports_structured_output: input.supportsStructuredOutput,
    supports_tools: input.supportsTools,
    supports_reasoning: input.supportsReasoning,
    supports_vision: input.supportsVision,
    supports_embeddings: input.modelType === 'embedding',
    status: 'active',
    deprecation_date: null,
    replacement_model_id: null,
    notes: null,
    metadata: {},
  })
  if (error) throw error
}

export async function updateModelEnabled(ctx: WorkbenchCallerContext, modelId: string, enabled: boolean) {
  const { error } = await ctx.supabase.from('ai_models').update({ enabled }).eq('id', modelId)
  if (error) throw error
}

// The partial unique index (one default per model_type) means setting a new
// default requires clearing the old one first -- same two-step pattern as
// markBaselineAction for eval runs.
export async function setDefaultModel(ctx: WorkbenchCallerContext, modelId: string, modelType: AIModelType) {
  const { supabase } = ctx
  await supabase.from('ai_models').update({ is_default: false }).eq('model_type', modelType).eq('is_default', true)
  const { error } = await supabase.from('ai_models').update({ is_default: true }).eq('id', modelId)
  if (error) throw error
}

// Independent of setDefaultModel/is_default -- see the migration comment on
// is_default_structured_output. Not scoped by model_type (unlike
// setDefaultModel) since it's a single global flag, not one-per-type; the DB
// check constraint (ai_models_default_structured_output_requires_capability)
// is the real guard against picking a model that doesn't support it, this
// just turns that into a readable error instead of a raw Postgres one.
export async function setDefaultStructuredOutputModel(ctx: WorkbenchCallerContext, modelId: string) {
  const { supabase } = ctx
  await supabase.from('ai_models').update({ is_default_structured_output: false }).eq('is_default_structured_output', true)
  const { error } = await supabase.from('ai_models').update({ is_default_structured_output: true }).eq('id', modelId)
  if (error) {
    if (error.code === '23514') throw new AIConfigError('This model does not support structured output')
    throw error
  }
}

export async function updateModelStatus(
  ctx: WorkbenchCallerContext,
  modelId: string,
  status: AIModelStatus,
  deprecationDate: string | null
) {
  const { error } = await ctx.supabase.from('ai_models').update({ status, deprecation_date: deprecationDate }).eq('id', modelId)
  if (error) throw error
}

// USD per million tokens, as the provider's price list gives them. Each may
// be null (not set). A model without input and output prices is reported as
// unpriced; without a cached price, cached input is charged at the input
// price (src/lib/ai/metering.ts computeCost). Applies to calls logged from
// now on -- logged costs are never recomputed.
export interface ModelPricingInput {
  inputCostPerMillion: number | null
  cachedInputCostPerMillion: number | null
  outputCostPerMillion: number | null
}

export async function updateModelPricing(ctx: WorkbenchCallerContext, modelId: string, input: ModelPricingInput) {
  for (const [label, value] of [
    ['Input price', input.inputCostPerMillion],
    ['Cached input price', input.cachedInputCostPerMillion],
    ['Output price', input.outputCostPerMillion],
  ] as const) {
    if (value !== null && (!Number.isFinite(value) || value < 0)) throw new AIConfigError(`${label} must be zero or more`)
  }
  const { error } = await ctx.supabase
    .from('ai_models')
    .update({
      input_cost_per_million: input.inputCostPerMillion,
      cached_input_cost_per_million: input.cachedInputCostPerMillion,
      output_cost_per_million: input.outputCostPerMillion,
    })
    .eq('id', modelId)
  if (error) throw error
}

export async function updateModelNotes(ctx: WorkbenchCallerContext, modelId: string, notes: string) {
  const { error } = await ctx.supabase.from('ai_models').update({ notes: notes || null }).eq('id', modelId)
  if (error) throw error
}

// Best-effort model discovery for the "Refresh Models" action -- returns
// what the provider currently lists, never writes to ai_models. Admin
// reviews the list and adds whichever models they actually want (see
// createModel) -- discovery never auto-enables anything.
export async function discoverModels(ctx: WorkbenchCallerContext, providerId: string): Promise<{ id: string }[]> {
  const { data: provider, error } = await ctx.supabase.from('ai_providers').select('*').eq('id', providerId).single()
  if (error || !provider) throw new AIConfigError('Provider not found')
  if (!provider.supports_model_discovery) throw new AIConfigError(`${provider.display_name} does not support model discovery`)

  const apiKey = env.byName(provider.api_key_env_var)
  if (!apiKey) throw new AIConfigError(`${provider.api_key_env_var} is not set`)

  const client = new OpenAI({ apiKey, baseURL: provider.base_url ?? undefined })
  const res = await client.models.list()
  return res.data.map((m) => ({ id: m.id }))
}
