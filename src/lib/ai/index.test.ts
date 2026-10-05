import { describe, it, expect, beforeEach } from 'vitest'
import { getActiveProvider, getActiveEmbeddingProvider, getActiveStructuredOutputProvider, AIConfigError } from './index'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

function defaultGenerationModelFixture() {
  return {
    ai_models: [
      {
        data: { id: 'model-1', provider_id: 'provider-1', model_id: 'gpt-4o-mini', model_type: 'generation', is_default: true },
        error: null,
      },
    ],
    ai_providers: [
      {
        data: {
          id: 'provider-1',
          name: 'openai',
          provider_type: 'openai',
          display_name: 'OpenAI',
          base_url: null,
          api_key_env_var: 'OPENAI_API_KEY',
          enabled: true,
        },
        error: null,
      },
    ],
  }
}

// Deliberately a DIFFERENT provider (Gemini) than the generation fixture
// above (OpenAI) -- this is the realistic shape (generation default on one
// provider, embedding default on another) and the exact scenario the
// approveChunkAction/approveArticleAction bug fix depends on: calling
// getActiveProvider() where getActiveEmbeddingProvider() was needed would
// have resolved OpenAI here, not Gemini, and this fixture would not catch
// it if the two accidentally resolved to the same provider.
function defaultEmbeddingModelFixture() {
  return {
    ai_models: [
      {
        data: { id: 'model-2', provider_id: 'provider-2', model_id: 'gemini-embedding-001', model_type: 'embedding', is_default: true },
        error: null,
      },
    ],
    ai_providers: [
      {
        data: {
          id: 'provider-2',
          name: 'gemini',
          provider_type: 'gemini',
          display_name: 'Gemini',
          base_url: null,
          api_key_env_var: 'GOOGLE_API_KEY',
          enabled: true,
        },
        error: null,
      },
    ],
  }
}

describe('getActiveProvider', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_API_KEY
  })

  it('throws a clear config error instead of silently defaulting when the default provider has no key', async () => {
    const supabase = createFakeSupabase(defaultGenerationModelFixture()) as never

    await expect(getActiveProvider(supabase, { task: 'chat' })).rejects.toBeInstanceOf(AIConfigError)
  })

  it('builds a provider for whichever model the registry marks as the default generation model', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const supabase = createFakeSupabase(defaultGenerationModelFixture()) as never

    const provider = await getActiveProvider(supabase, { task: 'chat' })
    expect(provider.name).toBe('openai')
  })
})

describe('getActiveEmbeddingProvider', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
    delete process.env.GOOGLE_API_KEY
  })

  it('builds a provider for the default EMBEDDING model, independent of whichever provider owns the default generation model', async () => {
    process.env.GOOGLE_API_KEY = 'test-key'
    const supabase = createFakeSupabase(defaultEmbeddingModelFixture()) as never

    const provider = await getActiveEmbeddingProvider(supabase, { task: 'chunk_embedding' })
    expect(provider.name).toBe('gemini')
  })

  it('throws a clear config error instead of silently defaulting when no embedding model is configured', async () => {
    const supabase = createFakeSupabase({ ai_models: [{ data: null, error: null }] }) as never
    await expect(getActiveEmbeddingProvider(supabase, { task: 'chunk_embedding' })).rejects.toBeInstanceOf(AIConfigError)
  })
})

describe('getActiveStructuredOutputProvider', () => {
  beforeEach(() => {
    delete process.env.OPENAI_API_KEY
  })

  it('builds a provider for whichever model is_default_structured_output=true, independent of is_default', async () => {
    process.env.OPENAI_API_KEY = 'test-key'
    const supabase = createFakeSupabase({
      ai_models: [{ data: { id: 'm-1', provider_id: 'p-1', model_id: 'gpt-4o-mini', model_type: 'generation' }, error: null }],
      ai_providers: [
        {
          data: {
            id: 'p-1',
            name: 'openai',
            provider_type: 'openai',
            display_name: 'OpenAI',
            base_url: null,
            api_key_env_var: 'OPENAI_API_KEY',
            enabled: true,
          },
          error: null,
        },
      ],
    }) as never

    const provider = await getActiveStructuredOutputProvider(supabase, { task: 'chunk_enrichment' })
    expect(provider.name).toBe('openai')
  })

  it('throws a clear config error instead of silently defaulting when no structured-output model is configured', async () => {
    const supabase = createFakeSupabase({ ai_models: [{ data: null, error: null }] }) as never
    await expect(getActiveStructuredOutputProvider(supabase, { task: 'chunk_enrichment' })).rejects.toBeInstanceOf(AIConfigError)
  })
})
