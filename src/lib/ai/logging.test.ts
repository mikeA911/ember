import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { AIProvider } from './provider'

const createAdminClientMock = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: (...args: unknown[]) => createAdminClientMock(...args),
}))

const { withLogging } = await import('./logging')
const { AIProviderError } = await import('./provider')

beforeEach(() => {
  createAdminClientMock.mockReset()
})

function fakeAdmin() {
  const supabase = createFakeSupabase({ ai_operation_logs: [{ data: { id: 'log-1' }, error: null }] })
  createAdminClientMock.mockReturnValue(supabase)
  return supabase
}

function fakeProvider(generateChat: AIProvider['generateChat']): AIProvider {
  return {
    name: 'groq',
    generateText: vi.fn(),
    generateStructured: vi.fn(),
    embed: vi.fn(),
    generateChat,
  }
}

describe('withLogging', () => {
  it('records the error_code an AIProviderError was already classified with', async () => {
    const supabase = fakeAdmin()
    const provider = fakeProvider(
      vi
        .fn()
        .mockRejectedValue(
          new AIProviderError('groq', 'generate_chat', 'groq generateChat failed: 429 Too Many Requests', undefined, 'rate_limit')
        )
    )

    await expect(withLogging(provider, { task: 'chat' }).generateChat({ messages: [] })).rejects.toBeInstanceOf(AIProviderError)

    const insertCall = supabase._calls.find((c) => c.table === 'ai_operation_logs' && c.method === 'insert')
    expect(insertCall?.args).toMatchObject({
      success: false,
      error_code: 'rate_limit',
      error_message: expect.stringContaining('429 Too Many Requests'),
    })
  })

  it('records a null error_code for a plain, unclassified failure', async () => {
    const supabase = fakeAdmin()
    const provider = fakeProvider(vi.fn().mockRejectedValue(new Error('boom')))

    await expect(withLogging(provider, { task: 'chat' }).generateChat({ messages: [] })).rejects.toThrow('boom')

    const insertCall = supabase._calls.find((c) => c.table === 'ai_operation_logs' && c.method === 'insert')
    expect(insertCall?.args).toMatchObject({ success: false, error_code: null })
  })

  it('records success with no error_code or error_message', async () => {
    const supabase = fakeAdmin()
    const provider = fakeProvider(
      vi
        .fn()
        .mockResolvedValue({ message: { role: 'assistant', content: 'hi' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    )

    await withLogging(provider, { task: 'chat' }).generateChat({ messages: [] })

    const insertCall = supabase._calls.find((c) => c.table === 'ai_operation_logs' && c.method === 'insert')
    expect(insertCall?.args).toMatchObject({ success: true, error_code: null, error_message: null })
  })

  it('records the task and the cached part of the input', async () => {
    const supabase = fakeAdmin()
    const provider = fakeProvider(
      vi.fn().mockResolvedValue({
        message: { role: 'assistant', content: 'hi' },
        model: 'test-model',
        usage: { inputTokens: 3000, outputTokens: 20, cachedInputTokens: 2048 },
      })
    )

    await withLogging(provider, { task: 'conversation_summary' }).generateChat({ messages: [] })

    const insertCall = supabase._calls.find((c) => c.table === 'ai_operation_logs' && c.method === 'insert')
    expect(insertCall?.args).toMatchObject({ task: 'conversation_summary', input_tokens: 3000, cached_input_tokens: 2048 })
  })

  it('records a null cached count when the provider reports none', async () => {
    const supabase = fakeAdmin()
    const provider = fakeProvider(
      vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'hi' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    )

    await withLogging(provider, { task: 'chat' }).generateChat({ messages: [] })

    const insertCall = supabase._calls.find((c) => c.table === 'ai_operation_logs' && c.method === 'insert')
    expect(insertCall?.args).toMatchObject({ task: 'chat', cached_input_tokens: null })
  })
})
