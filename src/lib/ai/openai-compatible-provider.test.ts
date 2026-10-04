import { describe, it, expect, vi, beforeEach } from 'vitest'
import { z } from 'zod'

const createCompletionMock = vi.fn()
const createEmbeddingMock = vi.fn()
const listModelsMock = vi.fn()
let capturedConstructorArgs: { apiKey: string; baseURL?: string; timeout?: number } | null = null

vi.mock('openai', () => ({
  default: class MockOpenAI {
    chat = { completions: { create: (...args: unknown[]) => createCompletionMock(...args) } }
    embeddings = { create: (...args: unknown[]) => createEmbeddingMock(...args) }
    models = { list: (...args: unknown[]) => listModelsMock(...args) }
    constructor(args: { apiKey: string; baseURL?: string; timeout?: number }) {
      capturedConstructorArgs = args
    }
  },
}))

const { OpenAICompatibleProvider } = await import('./openai-compatible-provider')
const { AIProviderError } = await import('./provider')

beforeEach(() => {
  createCompletionMock.mockReset()
  createEmbeddingMock.mockReset()
  listModelsMock.mockReset()
  capturedConstructorArgs = null
})

describe('OpenAICompatibleProvider (Groq)', () => {
  it('constructs the underlying client with the Groq base URL', () => {
    new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-20b')
    expect(capturedConstructorArgs).toEqual({ apiKey: 'test-key', baseURL: 'https://api.groq.com/openai/v1', timeout: 60_000 })
  })

  it('satisfies generateText, passing the requested model through to the API call', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'The answer is 4.' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1')

    const result = await provider.generateText({ prompt: 'What is 2+2?', model: 'openai/gpt-oss-20b' })

    expect(result.text).toBe('The answer is 4.')
    expect(result.model).toBe('openai/gpt-oss-20b')
    expect(createCompletionMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-oss-20b' }))
  })

  it('satisfies generateStructured, parsing the JSON response against the supplied schema', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: '{"score": 0.9}' } }],
      usage: { prompt_tokens: 20, completion_tokens: 8 },
    })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1')
    const schema = z.object({ score: z.number() })

    const result = await provider.generateStructured({ prompt: 'Score this', model: 'openai/gpt-oss-20b', schema })

    expect(result.data).toEqual({ score: 0.9 })
    expect(createCompletionMock).toHaveBeenCalledWith(expect.objectContaining({ model: 'openai/gpt-oss-20b', response_format: { type: 'json_object' } }))
  })

  it('throws a clear, explicitly-classified error when called with no model and no default configured', async () => {
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1')

    await expect(provider.generateText({ prompt: 'hi' })).rejects.toBeInstanceOf(AIProviderError)
  })

  it('rejects embed() explicitly rather than silently returning nothing -- Groq has no embedding endpoint', async () => {
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1')

    await expect(provider.embed({ text: 'hello' })).rejects.toMatchObject({ errorCode: 'model_unavailable' })
    expect(createEmbeddingMock).not.toHaveBeenCalled()
  })

  it('satisfies generateChat, returning a plain text reply with no tool calls', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'Hello there.', tool_calls: undefined } }],
      usage: { prompt_tokens: 10, completion_tokens: 4 },
    })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-20b')

    const result = await provider.generateChat({ messages: [{ role: 'user', content: 'Hi' }] })

    expect(result.message).toEqual({ role: 'assistant', content: 'Hello there.' })
    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ messages: [{ role: 'user', content: 'Hi' }] })
    )
  })

  it('generateChat maps a tool-call response into ToolCall[] with parsed arguments', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'search_wiki', arguments: '{"query":"RAG"}' } }],
          },
        },
      ],
      usage: { prompt_tokens: 12, completion_tokens: 6 },
    })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-20b')

    const result = await provider.generateChat({
      messages: [{ role: 'user', content: 'What is RAG?' }],
      tools: [{ name: 'search_wiki', description: 'Search the wiki', parameters: { type: 'object', properties: {} } }],
    })

    expect(result.message.toolCalls).toEqual([{ id: 'call-1', name: 'search_wiki', arguments: { query: 'RAG' } }])
    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({ tools: [{ type: 'function', function: expect.objectContaining({ name: 'search_wiki' }) }] })
    )
  })

  it('generateChat sends a tool-role message back with its tool_call_id', async () => {
    createCompletionMock.mockResolvedValue({
      choices: [{ message: { content: 'The answer is 4.' } }],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-20b')

    await provider.generateChat({
      messages: [
        { role: 'user', content: 'What is 2+2?' },
        { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'calc', arguments: {} }] },
        { role: 'tool', content: '4', toolCallId: 'call-1', toolName: 'calc' },
      ],
    })

    expect(createCompletionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'tool', tool_call_id: 'call-1', content: '4' }]),
      })
    )
  })

  it('includes the underlying SDK error in the thrown message, not just a generic string', async () => {
    createCompletionMock.mockRejectedValue(Object.assign(new Error('429 Too Many Requests'), { status: 429 }))
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1', 'openai/gpt-oss-20b')

    await expect(provider.generateChat({ messages: [{ role: 'user', content: 'Hi' }] })).rejects.toMatchObject({
      message: expect.stringContaining('429 Too Many Requests'),
      errorCode: 'rate_limit',
    })
  })

  it('discovers models via the OpenAI-compatible /models endpoint without enabling anything', async () => {
    listModelsMock.mockResolvedValue({ data: [{ id: 'openai/gpt-oss-20b' }, { id: 'openai/gpt-oss-120b' }] })
    const provider = new OpenAICompatibleProvider('groq', 'test-key', 'https://api.groq.com/openai/v1')

    const models = await provider.listModels()

    expect(models).toEqual([{ id: 'openai/gpt-oss-20b' }, { id: 'openai/gpt-oss-120b' }])
  })
})

describe('OpenAICompatibleProvider (self-hosted embeddings)', () => {
  const BASE = 'https://api.ember.example/llm-embed/v1'

  it('embeds through /v1/embeddings with the configured embedding model', async () => {
    createEmbeddingMock.mockResolvedValue({ data: [{ embedding: [0.1, 0.2, 0.3] }], usage: { prompt_tokens: 4 } })
    const provider = new OpenAICompatibleProvider('sandz-llm', 'test-key', BASE, undefined, 'qwen3-embedding')

    const result = await provider.embed({ text: 'hello' })

    expect(createEmbeddingMock).toHaveBeenCalledWith({ model: 'qwen3-embedding', input: 'hello' })
    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], model: 'qwen3-embedding', dimensions: 3, usage: { inputTokens: 4, outputTokens: null } })
  })

  it('requests the registered dimensions, and accepts an embedding of that size', async () => {
    createEmbeddingMock.mockResolvedValue({ data: [{ embedding: new Array(1536).fill(0) }], usage: { prompt_tokens: 4 } })
    const provider = new OpenAICompatibleProvider('sandz-llm', 'test-key', BASE, undefined, 'qwen3-embedding', 1536)

    const result = await provider.embed({ text: 'hello' })

    expect(createEmbeddingMock).toHaveBeenCalledWith({ model: 'qwen3-embedding', input: 'hello', dimensions: 1536 })
    expect(result.dimensions).toBe(1536)
  })

  it('fails clearly when the server returns a different size than registered', async () => {
    createEmbeddingMock.mockResolvedValue({ data: [{ embedding: new Array(1024).fill(0) }], usage: { prompt_tokens: 4 } })
    const provider = new OpenAICompatibleProvider('sandz-llm', 'test-key', BASE, undefined, 'qwen3-embedding', 1536)

    await expect(provider.embed({ text: 'hello' })).rejects.toMatchObject({ errorCode: 'invalid_request', message: expect.stringMatching(/1024-dimension.*1536/) })
  })

  it('lets a caller-supplied model override the default (e.g. an eval run snapshot)', async () => {
    createEmbeddingMock.mockResolvedValue({ data: [{ embedding: [1] }], usage: {} })
    const provider = new OpenAICompatibleProvider('sandz-llm', 'test-key', BASE)

    const result = await provider.embed({ text: 'hello', model: 'other-embed' })

    expect(createEmbeddingMock).toHaveBeenCalledWith({ model: 'other-embed', input: 'hello' })
    expect(result.usage.inputTokens).toBeNull()
  })

  it('wraps a server failure in AIProviderError', async () => {
    createEmbeddingMock.mockRejectedValue(new Error('connection refused'))
    const provider = new OpenAICompatibleProvider('sandz-llm', 'test-key', BASE, undefined, 'qwen3-embedding')

    await expect(provider.embed({ text: 'hello' })).rejects.toBeInstanceOf(AIProviderError)
  })
})
