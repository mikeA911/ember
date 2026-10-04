import { describe, it, expect } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import {
  getDefaultModel,
  getDefaultStructuredOutputModel,
  assertModelCapability,
  listChatCapableModels,
  listStructuredOutputCapableModels,
  listEmbeddingCapableModels,
  AIConfigError,
  pickSelfHostedModel,
  SelfHostedAIUnavailableError,
} from './registry'
import type { AIModelRow, AIProviderRow } from '@/types/database'

function provider(overrides: Partial<AIProviderRow> = {}): AIProviderRow {
  return {
    id: 'provider-1',
    name: 'groq',
    provider_type: 'groq',
    display_name: 'Groq',
    base_url: 'https://api.groq.com',
    api_key_env_var: 'GROQ_API_KEY',
    enabled: true,
    supports_model_discovery: false,
    is_self_hosted: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function model(overrides: Partial<AIModelRow> = {}): AIModelRow {
  return {
    id: 'model-1',
    provider_id: 'provider-1',
    model_id: 'gpt-4o-mini',
    display_name: 'GPT-4o mini',
    model_type: 'generation',
    enabled: true,
    is_default: true,
    is_default_structured_output: false,
    context_window: null,
    max_output_tokens: null,
    input_cost_per_million: null,
    cached_input_cost_per_million: null,
    output_cost_per_million: null,
    embedding_dimensions: null,
    supports_structured_output: false,
    supports_tools: false,
    supports_reasoning: false,
    supports_vision: false,
    supports_embeddings: false,
    status: 'active',
    deprecation_date: null,
    replacement_model_id: null,
    notes: null,
    metadata: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('getDefaultModel', () => {
  it('resolves generation and embedding defaults independently -- a Groq generation default does not affect the Gemini embedding default', async () => {
    const supabase = createFakeSupabase({
      ai_models: [
        { data: model({ id: 'gen-1', provider_id: 'groq-provider', model_id: 'openai/gpt-oss-20b', model_type: 'generation' }), error: null },
        { data: model({ id: 'embed-1', provider_id: 'gemini-provider', model_id: 'gemini-embedding-001', model_type: 'embedding' }), error: null },
      ],
      ai_providers: [
        { data: { id: 'groq-provider', name: 'groq' }, error: null },
        { data: { id: 'gemini-provider', name: 'gemini' }, error: null },
      ],
    }) as never

    const generation = await getDefaultModel(supabase, 'generation')
    const embedding = await getDefaultModel(supabase, 'embedding')

    expect(generation.provider.name).toBe('groq')
    expect(generation.model.model_id).toBe('openai/gpt-oss-20b')
    expect(embedding.provider.name).toBe('gemini')
    expect(embedding.model.model_id).toBe('gemini-embedding-001')
  })

  it('throws a clear config error when no default is configured for a model type', async () => {
    const supabase = createFakeSupabase({
      ai_models: [{ data: null, error: null }],
    }) as never

    await expect(getDefaultModel(supabase, 'embedding')).rejects.toBeInstanceOf(AIConfigError)
  })
})

describe('getDefaultStructuredOutputModel', () => {
  it('resolves is_default_structured_output independently of is_default -- a different model can own each', async () => {
    const supabase = createFakeSupabase({
      ai_models: [
        {
          data: model({ id: 'structured-1', provider_id: 'openai-provider', model_id: 'gpt-4o-mini', model_type: 'generation', is_default: false }),
          error: null,
        },
      ],
      ai_providers: [{ data: { id: 'openai-provider', name: 'openai' }, error: null }],
    }) as never

    const { provider, model: resolvedModel } = await getDefaultStructuredOutputModel(supabase)

    expect(provider.name).toBe('openai')
    expect(resolvedModel.model_id).toBe('gpt-4o-mini')
  })

  it('throws a clear config error when no structured-output default is configured', async () => {
    const supabase = createFakeSupabase({ ai_models: [{ data: null, error: null }] }) as never
    await expect(getDefaultStructuredOutputModel(supabase)).rejects.toBeInstanceOf(AIConfigError)
  })
})

describe('listChatCapableModels', () => {
  it('drops models that do not support tools and models whose provider is not in the enabled-providers list returned by the query', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: [provider({ id: 'groq-provider', name: 'groq' })], error: null }],
      ai_models: [
        {
          data: [
            model({ id: 'm1', provider_id: 'groq-provider', model_id: 'openai/gpt-oss-20b', supports_tools: true }),
            model({ id: 'm2', provider_id: 'groq-provider', model_id: 'no-tools-model', supports_tools: false }),
            model({ id: 'm3', provider_id: 'disabled-provider', model_id: 'orphaned-model', supports_tools: true }),
          ],
          error: null,
        },
      ],
    }) as never

    const options = await listChatCapableModels(supabase)

    expect(options).toEqual([
      {
        providerName: 'groq',
        providerDisplayName: 'Groq',
        providerDbId: 'groq-provider',
        isSelfHosted: false,
        modelId: 'openai/gpt-oss-20b',
        modelDisplayName: 'GPT-4o mini',
        modelDbId: 'm1',
        isDefault: true,
      },
    ])
  })
})

describe('listStructuredOutputCapableModels', () => {
  it('drops models that do not support structured output and models whose provider is not in the enabled-providers list', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: [provider({ id: 'groq-provider', name: 'groq' })], error: null }],
      ai_models: [
        {
          data: [
            model({ id: 'm1', provider_id: 'groq-provider', model_id: 'openai/gpt-oss-120b', supports_structured_output: true, is_default_structured_output: true }),
            model({ id: 'm2', provider_id: 'groq-provider', model_id: 'no-structured-model', supports_structured_output: false }),
            model({ id: 'm3', provider_id: 'disabled-provider', model_id: 'orphaned-model', supports_structured_output: true }),
          ],
          error: null,
        },
      ],
    }) as never

    const options = await listStructuredOutputCapableModels(supabase)

    expect(options).toEqual([
      {
        providerName: 'groq',
        providerDisplayName: 'Groq',
        providerDbId: 'groq-provider',
        isSelfHosted: false,
        modelId: 'openai/gpt-oss-120b',
        modelDisplayName: 'GPT-4o mini',
        modelDbId: 'm1',
        isDefault: true,
      },
    ])
  })
})

describe('listEmbeddingCapableModels', () => {
  it('maps embedding models to role options, keeps the embedding default flag, and drops models whose provider is not enabled', async () => {
    const supabase = createFakeSupabase({
      ai_providers: [{ data: [provider({ id: 'openai-provider', name: 'openai', display_name: 'OpenAI' })], error: null }],
      ai_models: [
        {
          data: [
            model({ id: 'e1', provider_id: 'openai-provider', model_id: 'text-embedding-3-small', display_name: 'text-embedding-3-small', model_type: 'embedding', is_default: true }),
            model({ id: 'e2', provider_id: 'disabled-provider', model_id: 'gemini-embedding-001', model_type: 'embedding' }),
          ],
          error: null,
        },
      ],
    }) as never

    const options = await listEmbeddingCapableModels(supabase)

    expect(options).toEqual([
      {
        providerName: 'openai',
        providerDisplayName: 'OpenAI',
        providerDbId: 'openai-provider',
        isSelfHosted: false,
        modelId: 'text-embedding-3-small',
        modelDisplayName: 'text-embedding-3-small',
        modelDbId: 'e1',
        isDefault: true,
      },
    ])
  })
})

describe('assertModelCapability', () => {
  it('rejects a disabled model regardless of which capability is being checked', () => {
    const disabled = model({ enabled: false })
    expect(() => assertModelCapability(disabled, 'generation')).toThrow(AIConfigError)
  })

  it('rejects an embedding model when a generation slot is needed', () => {
    const embeddingModel = model({ model_type: 'embedding' })
    expect(() => assertModelCapability(embeddingModel, 'generation')).toThrow(/cannot be used for generation/)
  })

  it('rejects a generation model when an embedding slot is needed', () => {
    const generationModel = model({ model_type: 'generation', supports_embeddings: false })
    expect(() => assertModelCapability(generationModel, 'embedding')).toThrow(/cannot be used for embedding/)
  })

  it('rejects a model without structured-output support for the evaluator slot', () => {
    const noStructured = model({ supports_structured_output: false })
    expect(() => assertModelCapability(noStructured, 'structured_output')).toThrow(/does not support structured output/)
  })

  it('allows an enabled, correctly-typed model through cleanly', () => {
    const generationModel = model({ model_type: 'generation', enabled: true, supports_structured_output: true })
    expect(() => assertModelCapability(generationModel, 'generation')).not.toThrow()
    expect(() => assertModelCapability(generationModel, 'structured_output')).not.toThrow()
  })
})

describe('pickSelfHostedModel', () => {
  const cloud = provider({ id: 'openai-provider', name: 'openai', is_self_hosted: false })
  const sandz = provider({ id: 'sandz-provider', name: 'sandz-llm', is_self_hosted: true, provider_type: 'openai_compatible' })

  function fake(models: AIModelRow[]) {
    return createFakeSupabase({
      ai_providers: [{ data: [cloud, sandz], error: null }],
      ai_models: [{ data: models, error: null }],
    }) as never
  }

  it("keeps the user's selection when it is already Sandz-hosted", async () => {
    const supabase = fake([
      model({ id: 'a', provider_id: 'sandz-provider', model_id: 'qwen-a', supports_tools: true, is_default: false }),
      model({ id: 'b', provider_id: 'sandz-provider', model_id: 'qwen-b', supports_tools: true, is_default: true }),
    ])
    const { model: picked } = await pickSelfHostedModel(supabase, 'tools', { providerName: 'sandz-llm', modelId: 'qwen-a' })
    expect(picked.model_id).toBe('qwen-a')
  })

  it('switches away from a cloud selection to the Sandz-hosted default', async () => {
    const supabase = fake([
      model({ id: 'c', provider_id: 'openai-provider', model_id: 'gpt-x', supports_tools: true, is_default: true }),
      model({ id: 'a', provider_id: 'sandz-provider', model_id: 'qwen-a', supports_tools: true, is_default: false }),
    ])
    const { provider: p, model: picked } = await pickSelfHostedModel(supabase, 'tools', { providerName: 'openai', modelId: 'gpt-x' })
    expect(p.name).toBe('sandz-llm')
    expect(picked.model_id).toBe('qwen-a')
  })

  it('uses the structured-output default and capability for structured output', async () => {
    const supabase = fake([
      model({ id: 'a', provider_id: 'sandz-provider', model_id: 'qwen-tools-only', supports_tools: true, supports_structured_output: false }),
      model({ id: 'b', provider_id: 'sandz-provider', model_id: 'qwen-json', supports_structured_output: true, is_default_structured_output: true }),
    ])
    const { model: picked } = await pickSelfHostedModel(supabase, 'structured_output')
    expect(picked.model_id).toBe('qwen-json')
  })

  it('fails clearly when no Sandz-hosted model has the capability', async () => {
    const supabase = fake([model({ id: 'c', provider_id: 'openai-provider', model_id: 'gpt-x', supports_tools: true })])
    await expect(pickSelfHostedModel(supabase, 'tools')).rejects.toBeInstanceOf(SelfHostedAIUnavailableError)
  })

  it('is an AIConfigError, so existing config-error handling still applies', () => {
    expect(new SelfHostedAIUnavailableError('tools')).toBeInstanceOf(AIConfigError)
  })
})
