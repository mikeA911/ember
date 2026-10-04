import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { AIModelRow, AIModelType, AIProviderRow, Database } from '@/types/database'
import { env } from '@/lib/env'
import type { AIProvider } from './provider'
import { OpenAIProvider } from './openai-provider'
import { GeminiProvider } from './gemini-provider'
import { OpenAICompatibleProvider } from './openai-compatible-provider'
import { withLogging, type LogContext } from './logging'

export class AIConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AIConfigError'
  }
}

// A Live client Project (src/lib/ai/hosting-policy.ts) needs a Sandz-hosted
// model and none is enabled with the required capability. The message is
// written for the person in the chat or on the page.
export class SelfHostedAIUnavailableError extends AIConfigError {
  constructor(need: 'tools' | 'structured_output') {
    super(
      need === 'tools'
        ? 'This project is live, so it can only use Sandz-hosted AI, and no Sandz-hosted chat model is available right now. Ask an admin to enable one under Admin -> AI Config.'
        : 'This project is live, so it can only use Sandz-hosted AI, and no Sandz-hosted model with structured output is available right now. Ask an admin to enable one under Admin -> AI Config.'
    )
    this.name = 'SelfHostedAIUnavailableError'
  }
}

export interface ProviderResolutionOptions {
  // Restrict to providers with is_self_hosted (a Live client Project). The
  // caller's selection or the platform default is kept when it already
  // qualifies; otherwise Ember switches to a qualifying model automatically.
  selfHostedOnly?: boolean
}

// Picks a Sandz-hosted generation model with the needed capability, in
// order: the caller's selection, the platform default for that role, then
// the first by display name. Throws SelfHostedAIUnavailableError when none.
export async function pickSelfHostedModel(
  supabase: SupabaseClient<Database>,
  need: 'tools' | 'structured_output',
  preferred?: { providerName: string; modelId: string }
): Promise<{ provider: AIProviderRow; model: AIModelRow }> {
  const [providers, models] = await Promise.all([
    listProviders(supabase, { enabledOnly: true }),
    listModels(supabase, { modelType: 'generation', enabledOnly: true }),
  ])
  const selfHosted = new Map(providers.filter((p) => p.is_self_hosted).map((p) => [p.id, p]))
  const candidates = models.filter(
    (m) => selfHosted.has(m.provider_id) && (need === 'tools' ? m.supports_tools : m.supports_structured_output)
  )
  const pick =
    (preferred && candidates.find((m) => m.model_id === preferred.modelId && selfHosted.get(m.provider_id)?.name === preferred.providerName)) ||
    candidates.find((m) => (need === 'tools' ? m.is_default : m.is_default_structured_output)) ||
    candidates[0]
  if (!pick) throw new SelfHostedAIUnavailableError(need)
  return { provider: selfHosted.get(pick.provider_id)!, model: pick }
}

// Pure, synchronous shaping helper -- no query of its own, since the two
// admin pages that need this (AdminPage, the provider detail page) already
// have the full providers/models arrays loaded for other reasons. Used to
// build the "current assignment" shown by ModelAssignmentsSummary from
// whichever ai_models row has is_default / is_default_structured_output set.
export function toRoleOption(
  model: AIModelRow,
  providers: AIProviderRow[]
): { providerDbId: string; modelDbId: string; providerDisplayName: string; modelDisplayName: string } | null {
  const provider = providers.find((p) => p.id === model.provider_id)
  if (!provider) return null
  return {
    providerDbId: provider.id,
    modelDbId: model.id,
    providerDisplayName: provider.display_name,
    modelDisplayName: model.display_name,
  }
}

export async function listProviders(
  supabase: SupabaseClient<Database>,
  opts: { enabledOnly?: boolean } = {}
): Promise<AIProviderRow[]> {
  let query = supabase.from('ai_providers').select('*').order('name')
  if (opts.enabledOnly) query = query.eq('enabled', true)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function listModels(
  supabase: SupabaseClient<Database>,
  opts: { providerId?: string; modelType?: AIModelType; enabledOnly?: boolean } = {}
): Promise<AIModelRow[]> {
  let query = supabase.from('ai_models').select('*').order('display_name')
  if (opts.providerId) query = query.eq('provider_id', opts.providerId)
  if (opts.modelType) query = query.eq('model_type', opts.modelType)
  if (opts.enabledOnly) query = query.eq('enabled', true)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export async function resolveModel(
  supabase: SupabaseClient<Database>,
  providerName: string,
  modelId: string
): Promise<{ provider: AIProviderRow; model: AIModelRow }> {
  const { data: provider, error: providerError } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('name', providerName)
    .single()
  if (providerError || !provider) throw new AIConfigError(`Unknown AI provider: ${JSON.stringify(providerName)}`)
  if (!provider.enabled) throw new AIConfigError(`AI provider "${providerName}" is disabled`)

  const { data: model, error: modelError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('provider_id', provider.id)
    .eq('model_id', modelId)
    .single()
  if (modelError || !model) throw new AIConfigError(`Unknown model "${modelId}" for provider "${providerName}"`)

  return { provider, model }
}

// "The default generation model" / "the default embedding model" fall out of
// the single is_default flag scoped by model_type (see the partial unique
// index in the migration) rather than a separate boolean pair -- this is
// what makes generation and embedding defaults genuinely independent.
export async function getDefaultModel(
  supabase: SupabaseClient<Database>,
  modelType: 'generation' | 'embedding'
): Promise<{ provider: AIProviderRow; model: AIModelRow }> {
  const { data: model, error: modelError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('model_type', modelType)
    .eq('is_default', true)
    .single()
  if (modelError || !model) throw new AIConfigError(`No default ${modelType} model configured`)

  const { data: provider, error: providerError } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('id', model.provider_id)
    .single()
  if (providerError || !provider) throw new AIConfigError(`Default ${modelType} model's provider is missing`)

  return { provider, model }
}

// Called once at the top of an eval run rather than scattered provider-name
// checks throughout the pipeline -- validates the model actually selected
// for a slot can do what that slot needs before any API call is made.
export function assertModelCapability(model: AIModelRow, need: 'generation' | 'embedding' | 'structured_output' | 'tools') {
  if (need === 'generation' && model.model_type !== 'generation') {
    throw new AIConfigError(`Model "${model.model_id}" is a ${model.model_type} model and cannot be used for generation`)
  }
  if (need === 'embedding' && model.model_type !== 'embedding' && !model.supports_embeddings) {
    throw new AIConfigError(`Model "${model.model_id}" is a ${model.model_type} model and cannot be used for embedding`)
  }
  if (need === 'structured_output' && !model.supports_structured_output) {
    throw new AIConfigError(`Model "${model.model_id}" does not support structured output`)
  }
  if (need === 'tools' && !model.supports_tools) {
    throw new AIConfigError(`Model "${model.model_id}" does not support tool calling`)
  }
  if (!model.enabled) {
    throw new AIConfigError(`Model "${model.model_id}" is disabled`)
  }
}

function resolveApiKey(provider: AIProviderRow): string | undefined {
  return env.byName(provider.api_key_env_var)
}

// Pure instantiation switch -- takes an already-resolved API key directly
// rather than an ai_providers DB row, so a caller with its own credential
// (BYOLLM, src/lib/workbench/builder-llm-credentials.ts) can construct a
// provider through this exact same switch instead of a second copy. The
// only two DB-backed callers (buildProviderClient below) resolve the row and
// its env-var-referenced key first, then delegate here.
export function instantiateProvider(
  providerType: 'openai' | 'gemini' | 'groq' | 'openai_compatible',
  name: string,
  apiKey: string,
  baseUrl: string | null,
  defaultTextModel?: string,
  defaultEmbedModel?: string,
  // openai_compatible only -- see OpenAICompatibleProvider's constructor.
  embedDimensions?: number
): AIProvider {
  switch (providerType) {
    case 'openai':
      return defaultTextModel || defaultEmbedModel
        ? new OpenAIProvider(apiKey, defaultTextModel, defaultEmbedModel)
        : new OpenAIProvider(apiKey)
    case 'gemini':
      return defaultTextModel || defaultEmbedModel
        ? new GeminiProvider(apiKey, defaultTextModel, defaultEmbedModel)
        : new GeminiProvider(apiKey)
    case 'groq':
    case 'openai_compatible': {
      if (!baseUrl) throw new AIConfigError(`Provider "${name}" has no base_url configured`)
      return new OpenAICompatibleProvider(name, apiKey, baseUrl, defaultTextModel, defaultEmbedModel, embedDimensions)
    }
  }
}

function buildProviderClient(provider: AIProviderRow, defaultTextModel?: string, defaultEmbedModel?: string, embedDimensions?: number): AIProvider {
  const apiKey = resolveApiKey(provider)
  if (!apiKey) {
    throw new AIConfigError(`Provider "${provider.name}" is enabled but ${provider.api_key_env_var} is not set`)
  }
  return instantiateProvider(provider.provider_type, provider.name, apiKey, provider.base_url, defaultTextModel, defaultEmbedModel, embedDimensions)
}

// The one place evaluation (and everything else) resolves a provider by
// name -- now a DB lookup against the registry instead of a switch over a
// hard-coded union, so a newly admin-added provider works immediately.
export async function getProviderByName(
  supabase: SupabaseClient<Database>,
  name: string,
  logContext: LogContext = {}
): Promise<AIProvider> {
  const { data: provider, error } = await supabase.from('ai_providers').select('*').eq('name', name).single()
  if (error || !provider) throw new AIConfigError(`Unknown AI provider: ${JSON.stringify(name)}`)
  if (!provider.enabled) throw new AIConfigError(`AI provider "${name}" is disabled`)

  return withLogging(buildProviderClient(provider), logContext)
}

// The app-wide default for plain text generation -- replaces the old
// settings.ai_provider key. Resolves to whichever provider currently owns
// the default generation model in the registry (e.g. Groq), with that
// model pre-filled as the provider instance's default so callers that
// don't pass `model` explicitly still get the right one. Not used for
// embedding or structured-output tasks -- see the two siblings below.
export async function getActiveProvider(
  supabase: SupabaseClient<Database>,
  logContext: LogContext = {}
): Promise<AIProvider> {
  const { provider, model } = await getDefaultModel(supabase, 'generation')
  return withLogging(buildProviderClient(provider, model.model_id), logContext)
}

// The embedding counterpart to getActiveProvider -- resolves whichever
// provider currently owns the default EMBEDDING model (independent of the
// default generation model; they're frequently different providers, e.g.
// Groq for generation + Gemini for embeddings). Chunk approval and Wiki
// version approval both call .embed() and must use this, not
// getActiveProvider -- calling .embed() on a generation-only provider
// throws (some, like Groq, don't support embeddings at all).
export async function getActiveEmbeddingProvider(
  supabase: SupabaseClient<Database>,
  logContext: LogContext = {}
): Promise<AIProvider> {
  const { provider, model } = await getDefaultModel(supabase, 'embedding')
  return withLogging(buildProviderClient(provider, undefined, model.model_id, model.embedding_dimensions ?? undefined), logContext)
}

// The structured-output counterpart to getActiveProvider/getActiveEmbeddingProvider.
// Structured output (reliable JSON extraction) is a CAPABILITY of a
// generation model (supports_structured_output), not its own model_type,
// so this resolves is_default_structured_output rather than filtering by
// model_type -- independent of both the plain generation default and the
// embedding default. Chunk enrichment (topic/subtopic/key_concepts JSON)
// and AI-assisted Wiki draft synthesis both need this: the model best
// suited for a good prose Wiki draft is not necessarily the model best
// suited for reliably-parseable structured extraction.
export async function getDefaultStructuredOutputModel(
  supabase: SupabaseClient<Database>
): Promise<{ provider: AIProviderRow; model: AIModelRow }> {
  const { data: model, error: modelError } = await supabase
    .from('ai_models')
    .select('*')
    .eq('is_default_structured_output', true)
    .single()
  if (modelError || !model) throw new AIConfigError('No default structured-output model configured')

  const { data: provider, error: providerError } = await supabase
    .from('ai_providers')
    .select('*')
    .eq('id', model.provider_id)
    .single()
  if (providerError || !provider) throw new AIConfigError("Default structured-output model's provider is missing")

  return { provider, model }
}

export async function getActiveStructuredOutputProvider(
  supabase: SupabaseClient<Database>,
  logContext: LogContext = {},
  options: ProviderResolutionOptions = {}
): Promise<AIProvider> {
  const { provider, model } = options.selfHostedOnly
    ? await pickSelfHostedModel(supabase, 'structured_output')
    : await getDefaultStructuredOutputModel(supabase)
  return withLogging(buildProviderClient(provider, model.model_id), logContext)
}

// M6E: the resolved provider PLUS the display names the Assistant UI needs
// to show "who it's talking to" and to snapshot into chat_messages
// provenance. Tool-calling is a capability of the default GENERATION model
// (there's no separate 'chat' model_type), same relationship generation has
// to structured_output. A caller-supplied selection (from the model picker)
// takes priority over the registry default -- switching models only
// affects the NEXT turn, never rewrites history, since provenance is
// stamped per-message by the caller using the values returned here.
export interface ChatProviderInfo {
  provider: AIProvider
  providerName: string
  providerDisplayName: string
  modelId: string
  modelDisplayName: string
  maxOutputTokens: number | null
  contextWindow: number | null
}

export async function resolveChatProvider(
  supabase: SupabaseClient<Database>,
  selection?: { providerName: string; modelId: string },
  logContext: LogContext = {},
  options: ProviderResolutionOptions = {}
): Promise<ChatProviderInfo> {
  const { provider, model } = options.selfHostedOnly
    ? await pickSelfHostedModel(supabase, 'tools', selection)
    : selection
      ? await resolveModel(supabase, selection.providerName, selection.modelId)
      : await getDefaultModel(supabase, 'generation')
  assertModelCapability(model, 'tools')
  return {
    provider: withLogging(buildProviderClient(provider, model.model_id), logContext),
    providerName: provider.name,
    providerDisplayName: provider.display_name,
    modelId: model.model_id,
    modelDisplayName: model.display_name,
    maxOutputTokens: model.max_output_tokens,
    contextWindow: model.context_window,
  }
}

// Powers the Assistant's model picker: enabled providers x enabled
// generation-type models that support tool calling. Naturally excludes
// disabled providers/models and embedding-only models (design note §4) --
// no separate filtering logic needed beyond the flags already on each row.
// modelDbId/providerDbId (the ai_models.id/ai_providers.id row ids) are
// carried alongside the business providerName/modelId so the same option
// list can also drive the admin "Model assignments" summary, whose change
// actions (setDefaultModelAction et al) take row ids, not business ids --
// the chat picker itself only ever uses providerName/modelId.
export interface ChatModelOption {
  providerName: string
  providerDisplayName: string
  providerDbId: string
  modelId: string
  modelDisplayName: string
  modelDbId: string
  isDefault: boolean
  // ai_providers.is_self_hosted -- lets the chat picker offer only Sandz-
  // hosted models in a Live client Project (src/lib/ai/hosting-policy.ts).
  isSelfHosted: boolean
}

export async function listChatCapableModels(supabase: SupabaseClient<Database>): Promise<ChatModelOption[]> {
  const [providers, models] = await Promise.all([
    listProviders(supabase, { enabledOnly: true }),
    listModels(supabase, { modelType: 'generation', enabledOnly: true }),
  ])
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const options: ChatModelOption[] = []
  for (const model of models) {
    if (!model.supports_tools) continue
    const provider = providerById.get(model.provider_id)
    if (!provider) continue
    options.push({
      providerName: provider.name,
      providerDisplayName: provider.display_name,
      providerDbId: provider.id,
      isSelfHosted: provider.is_self_hosted,
      modelId: model.model_id,
      modelDisplayName: model.display_name,
      modelDbId: model.id,
      isDefault: model.is_default,
    })
  }
  return options
}

// Same shape and filtering pattern as listChatCapableModels, for the
// embedding role -- powers the admin "Model assignments" summary's embedding
// dropdown. Dedicated embedding models only: the embedding default is the
// embedding-type is_default (getDefaultModel(..., 'embedding')), and
// setDefaultModel scopes is_default by the chosen row's own model_type -- so
// offering a supports_embeddings generation model here would silently move
// the conversational default instead.
export async function listEmbeddingCapableModels(supabase: SupabaseClient<Database>): Promise<ChatModelOption[]> {
  const [providers, models] = await Promise.all([
    listProviders(supabase, { enabledOnly: true }),
    listModels(supabase, { modelType: 'embedding', enabledOnly: true }),
  ])
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const options: ChatModelOption[] = []
  for (const model of models) {
    const provider = providerById.get(model.provider_id)
    if (!provider) continue
    options.push({
      providerName: provider.name,
      providerDisplayName: provider.display_name,
      providerDbId: provider.id,
      isSelfHosted: provider.is_self_hosted,
      modelId: model.model_id,
      modelDisplayName: model.display_name,
      modelDbId: model.id,
      isDefault: model.is_default,
    })
  }
  return options
}

// Same shape and filtering pattern as listChatCapableModels, for the
// structured-output role instead of the conversational one -- powers the
// admin "Model assignments" summary's structured-output dropdown. isDefault
// here means is_default_structured_output, not the generation is_default.
export async function listStructuredOutputCapableModels(supabase: SupabaseClient<Database>): Promise<ChatModelOption[]> {
  const [providers, models] = await Promise.all([
    listProviders(supabase, { enabledOnly: true }),
    listModels(supabase, { modelType: 'generation', enabledOnly: true }),
  ])
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const options: ChatModelOption[] = []
  for (const model of models) {
    if (!model.supports_structured_output) continue
    const provider = providerById.get(model.provider_id)
    if (!provider) continue
    options.push({
      providerName: provider.name,
      providerDisplayName: provider.display_name,
      providerDbId: provider.id,
      isSelfHosted: provider.is_self_hosted,
      modelId: model.model_id,
      modelDisplayName: model.display_name,
      modelDbId: model.id,
      isDefault: model.is_default_structured_output,
    })
  }
  return options
}
