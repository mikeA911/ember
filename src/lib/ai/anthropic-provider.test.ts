import { describe, expect, it } from 'vitest'
import type Anthropic from '@anthropic-ai/sdk'
import { AnthropicProvider, CLAUDE_REFUSAL_MESSAGE, fromAnthropicMessage, toAnthropicMessages } from './anthropic-provider'

function reply(content: unknown[], stop_reason: Anthropic.StopReason = 'end_turn'): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content,
    stop_reason,
    usage: { input_tokens: 10, output_tokens: 5 },
  } as unknown as Anthropic.Message
}

describe('fromAnthropicMessage', () => {
  it('joins text and keeps tool calls, with the original turn on the first call', () => {
    const content = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Searching ' },
      { type: 'text', text: 'now.' },
      { type: 'tool_use', id: 'tu_1', name: 'search_web', input: { query: 'VMware' } },
      { type: 'tool_use', id: 'tu_2', name: 'search_wiki', input: { query: 'Zadara' } },
    ]
    const message = fromAnthropicMessage(reply(content, 'tool_use'))
    expect(message.content).toBe('Searching now.')
    expect(message.toolCalls?.map((c) => [c.id, c.name, c.arguments])).toEqual([
      ['tu_1', 'search_web', { query: 'VMware' }],
      ['tu_2', 'search_wiki', { query: 'Zadara' }],
    ])
    expect(message.toolCalls?.[0].providerData?.anthropicContent).toEqual(content)
    expect(message.toolCalls?.[1].providerData).toBeUndefined()
  })

  it('turns a refusal into a readable answer', () => {
    expect(fromAnthropicMessage(reply([], 'refusal')).content).toBe(CLAUDE_REFUSAL_MESSAGE)
  })
})

describe('toAnthropicMessages', () => {
  it('sends a tool-calling turn back exactly as Claude produced it, and groups its results', () => {
    const original = [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'tool_use', id: 'tu_1', name: 'search_web', input: {} },
      { type: 'tool_use', id: 'tu_2', name: 'search_wiki', input: {} },
    ]
    const out = toAnthropicMessages([
      { role: 'user', content: 'Run a fit check' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'tu_1', name: 'search_web', arguments: {}, providerData: { anthropicContent: original } },
          { id: 'tu_2', name: 'search_wiki', arguments: {} },
        ],
      },
      { role: 'tool', content: 'web results', toolCallId: 'tu_1', toolName: 'search_web' },
      { role: 'tool', content: 'wiki results', toolCallId: 'tu_2', toolName: 'search_wiki' },
      { role: 'assistant', content: 'Here is the fit check.' },
      { role: 'user', content: 'Thanks' },
    ])
    expect(out).toEqual([
      { role: 'user', content: 'Run a fit check' },
      { role: 'assistant', content: original },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'tu_1', content: 'web results' },
          { type: 'tool_result', tool_use_id: 'tu_2', content: 'wiki results' },
        ],
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Here is the fit check.' }] },
      { role: 'user', content: 'Thanks' },
    ])
  })

  it('rebuilds tool calls from another provider’s history', () => {
    const out = toAnthropicMessages([
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Let me look.', toolCalls: [{ id: 'call_1', name: 'search_wiki', arguments: { query: 'x' } }] },
      { role: 'tool', content: 'none', toolCallId: 'call_1', toolName: 'search_wiki' },
    ])
    expect(out[1]).toEqual({
      role: 'assistant',
      content: [
        { type: 'text', text: 'Let me look.' },
        { type: 'tool_use', id: 'call_1', name: 'search_wiki', input: { query: 'x' } },
      ],
    })
  })
})

describe('AnthropicProvider.embed', () => {
  it('refuses clearly, since Claude has no embedding models', async () => {
    const provider = new AnthropicProvider('test-key')
    await expect(provider.embed({ text: 'x' })).rejects.toMatchObject({ errorCode: 'model_unavailable' })
  })
})
