import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import { instantiateProvider, type AIProvider } from '@/lib/ai'
import { encryptCredential, decryptCredential } from '@/lib/ai/credential-crypto'
import type { WorkbenchCallerContext } from './context'

// Bring-Your-Own-LLM (docs/dev-request-kb-sandbox-builder-product.md,
// "Credits and metering" -- BYOLLM itself is a follow-up beyond that doc's
// own scope): a builder who already has their own LLM (a hosted API key, or
// a local server like Ollama/LM Studio reachable via an OpenAI-compatible
// base URL) can supply it instead of drawing on the platform's metered
// allowance (src/lib/ai/metering.ts) at all. One active credential per
// builder -- not a multi-credential switcher.

export type BuilderLlmProviderType = 'openai' | 'gemini' | 'groq' | 'openai_compatible'

export interface SetBuilderLlmCredentialInput {
  providerType: BuilderLlmProviderType
  baseUrl?: string | null
  modelId: string
  // Omitted/empty for a local server that needs no auth at all -- stored as
  // null rather than an empty-string ciphertext.
  apiKey?: string | null
}

export interface BuilderLlmCredentialStatus {
  configured: boolean
  providerType: BuilderLlmProviderType
  baseUrl: string | null
  modelId: string
  isActive: boolean
}

export async function setBuilderLlmCredential(ctx: WorkbenchCallerContext, input: SetBuilderLlmCredentialInput): Promise<void> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to configure your own LLM')
  const modelId = input.modelId.trim()
  if (!modelId) throw new ProjectValidationError('Model is required')
  const baseUrl = input.baseUrl?.trim() || null
  if (input.providerType === 'openai_compatible' && !baseUrl) {
    throw new ProjectValidationError('Base URL is required for a custom (OpenAI-compatible) provider')
  }

  const encryptedApiKey = input.apiKey?.trim() ? encryptCredential(input.apiKey.trim()) : null
  const { error } = await ctx.supabase.from('builder_llm_credentials').upsert(
    {
      builder_id: ctx.user.id,
      provider_type: input.providerType,
      base_url: input.providerType === 'openai_compatible' ? baseUrl : null,
      model_id: modelId,
      encrypted_api_key: encryptedApiKey,
      is_active: true,
    },
    { onConflict: 'builder_id' }
  )
  if (error) throw error
}

export async function clearBuilderLlmCredential(ctx: WorkbenchCallerContext): Promise<void> {
  const { error } = await ctx.supabase.from('builder_llm_credentials').delete().eq('builder_id', ctx.user.id)
  if (error) throw error
}

// The profile-page reader -- selects only the non-secret columns, never
// encrypted_api_key, so a plaintext or ciphertext value is never even
// fetched for this read path (RLS would allow it, since it's the caller's
// own row, but there's no reason to pull it here).
export async function getBuilderLlmCredentialStatus(ctx: WorkbenchCallerContext): Promise<BuilderLlmCredentialStatus | null> {
  const { data } = await ctx.supabase
    .from('builder_llm_credentials')
    .select('provider_type, base_url, model_id, is_active')
    .eq('builder_id', ctx.user.id)
    .maybeSingle()
  if (!data) return null
  return {
    configured: true,
    providerType: data.provider_type as BuilderLlmProviderType,
    baseUrl: data.base_url,
    modelId: data.model_id,
    isActive: data.is_active,
  }
}

export interface ResolvedBuilderLlmProvider {
  provider: AIProvider
  providerType: BuilderLlmProviderType
  modelId: string
}

// Admin-client read, called once per turn from src/lib/chat/loop.ts before
// resolveChatProvider -- not from the builder's own RLS client, since this
// runs regardless of who's asking (the turn's own server-side setup, not a
// user-initiated read). Returns null (fall back to the platform default)
// when no active credential exists; a local server with no configured key
// gets a placeholder credential string -- OpenAICompatibleProvider's
// underlying SDK requires a non-empty apiKey value, but a server that
// ignores the Authorization header (Ollama's OpenAI-compatible shim, e.g.)
// never actually checks it. modelId is returned alongside the provider so
// the caller can build display/provenance info the same shape
// resolveChatProvider's ChatProviderInfo already provides for the platform
// path -- there's no ai_models row for a builder's own model to read a
// display name or tool-calling capability from, so the caller trusts it.
export async function resolveBuilderLlmProvider(builderId: string): Promise<ResolvedBuilderLlmProvider | null> {
  const admin = createAdminClient()
  const { data } = await admin
    .from('builder_llm_credentials')
    .select('provider_type, base_url, model_id, encrypted_api_key, is_active')
    .eq('builder_id', builderId)
    .maybeSingle()
  if (!data || !data.is_active) return null

  const providerType = data.provider_type as BuilderLlmProviderType
  const apiKey = data.encrypted_api_key ? decryptCredential(data.encrypted_api_key) : 'not-required'
  const provider = instantiateProvider(providerType, `byollm-${builderId}`, apiKey, data.base_url, data.model_id)
  return { provider, providerType, modelId: data.model_id }
}
