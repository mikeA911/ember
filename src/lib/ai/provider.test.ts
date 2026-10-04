import { describe, it, expect } from 'vitest'
import { classifyProviderError, AIProviderError, openAIUsage } from './provider'

describe('classifyProviderError', () => {
  it('classifies a 404 as model_unavailable', () => {
    expect(classifyProviderError({ status: 404, message: 'model not found' })).toBe('model_unavailable')
  })

  it('classifies a "no longer available" message as model_unavailable even without a status code', () => {
    expect(classifyProviderError(new Error('This model is no longer available from the provider.'))).toBe('model_unavailable')
  })

  it('classifies a 401 as authentication', () => {
    expect(classifyProviderError({ status: 401, message: 'invalid api key' })).toBe('authentication')
  })

  it('classifies a 429 with quota language as quota_exceeded, not just rate_limit', () => {
    expect(classifyProviderError({ status: 429, message: 'You have no credits remaining' })).toBe('quota_exceeded')
  })

  it('classifies a plain 429 as rate_limit', () => {
    expect(classifyProviderError({ status: 429, message: 'rate limit exceeded, try again later' })).toBe('rate_limit')
  })

  it('classifies insufficient_quota errors as quota_exceeded regardless of status', () => {
    expect(classifyProviderError(new Error('insufficient_quota: add credits to continue'))).toBe('quota_exceeded')
  })

  // Groq's TPM (tokens-per-minute) ceiling returns 413, not 429 -- caught
  // live during Sandz pilot testing where this fell through to 'unknown'
  // and the resulting AIProviderError crossed the Server Action boundary
  // uncaught, reaching the user as an opaque production error.
  it('classifies a Groq TPM 413 as rate_limit', () => {
    expect(
      classifyProviderError({
        status: 413,
        message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 9029',
      })
    ).toBe('rate_limit')
  })

  it('falls back to unknown for an unrecognized error shape', () => {
    expect(classifyProviderError(new Error('something broke'))).toBe('unknown')
  })
})

describe('AIProviderError', () => {
  it('auto-classifies errorCode from the cause when not explicitly given -- callers get a useful code for free', () => {
    const err = new AIProviderError('groq', 'generate_text', 'Groq generateText failed', { status: 404, message: 'model not found' })
    expect(err.errorCode).toBe('model_unavailable')
  })

  it('lets a caller override the classified errorCode explicitly', () => {
    const err = new AIProviderError('groq', 'embed', 'Groq does not support embeddings', undefined, 'model_unavailable')
    expect(err.errorCode).toBe('model_unavailable')
  })
})

describe('openAIUsage', () => {
  it('reads OpenAI/Groq/xAI cached prompt tokens', () => {
    expect(openAIUsage({ prompt_tokens: 3000, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 2048 } })).toEqual({
      inputTokens: 3000,
      outputTokens: 50,
      cachedInputTokens: 2048,
    })
  })

  it("reads DeepSeek's prompt cache hits", () => {
    expect(openAIUsage({ prompt_tokens: 3000, completion_tokens: 50, prompt_cache_hit_tokens: 1024 }).cachedInputTokens).toBe(1024)
  })

  it('reports null when no cache figure or usage is given', () => {
    expect(openAIUsage({ prompt_tokens: 10, completion_tokens: 2 }).cachedInputTokens).toBeNull()
    expect(openAIUsage(undefined)).toEqual({ inputTokens: null, outputTokens: null, cachedInputTokens: null })
  })
})
