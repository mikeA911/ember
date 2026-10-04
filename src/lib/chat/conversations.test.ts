import { describe, it, expect } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import { getLatestActivityLabel, listRecentConversations, toDisplayMessages } from './conversations'
import type { ChatMessageRow } from '@/types/database'

describe('getLatestActivityLabel', () => {
  it('returns null when the conversation has no messages yet', async () => {
    const supabase = createFakeSupabase({ chat_messages: [{ data: null, error: null }] }) as never
    expect(await getLatestActivityLabel(supabase, 'conv-1')).toBeNull()
  })

  it('maps the most recent assistant tool call to a friendly label', async () => {
    const supabase = createFakeSupabase({
      chat_messages: [{ data: { role: 'assistant', tool_calls: [{ id: 'c1', name: 'search_wiki', arguments: {} }], tool_name: null }, error: null }],
    }) as never
    expect(await getLatestActivityLabel(supabase, 'conv-1')).toBe('Searching the Workbench Handbook & Wiki…')
  })

  it('returns "Reviewing results…" once a known tool has returned its result', async () => {
    const supabase = createFakeSupabase({
      chat_messages: [{ data: { role: 'tool', tool_calls: null, tool_name: 'create_project' }, error: null }],
    }) as never
    expect(await getLatestActivityLabel(supabase, 'conv-1')).toBe('Reviewing results…')
  })

  it('falls back to null for a plain assistant reply with no tool call, letting the client show a generic label', async () => {
    const supabase = createFakeSupabase({
      chat_messages: [{ data: { role: 'assistant', tool_calls: null, tool_name: null }, error: null }],
    }) as never
    expect(await getLatestActivityLabel(supabase, 'conv-1')).toBeNull()
  })
})

describe('listRecentConversations', () => {
  it('returns the queued rows, an empty result being the first-use signal', async () => {
    const supabase = createFakeSupabase({ conversations: [{ data: [], error: null }] }) as never
    expect(await listRecentConversations(supabase, 'user-1')).toEqual([])
  })

  it('returns recent conversations ordered by the query (most-recent-first)', async () => {
    const rows = [{ id: 'conv-2' }, { id: 'conv-1' }]
    const supabase = createFakeSupabase({ conversations: [{ data: rows, error: null }] }) as never
    expect(await listRecentConversations(supabase, 'user-1')).toEqual(rows)
  })
})

function row(overrides: Partial<ChatMessageRow>): ChatMessageRow {
  return {
    id: 'm1',
    conversation_id: 'conv-1',
    user_id: 'user-1',
    role: 'user',
    content: null,
    tool_calls: null,
    tool_call_id: null,
    tool_name: null,
    provider: null,
    model: null,
    response_payload: null,
    retrieved_resources: null,
    created_at: '2026-08-20T00:00:00Z',
    ...overrides,
  }
}

// None of these fixtures set response_payload or call a creating tool, so
// toDisplayMessages never actually reaches ctx.supabase -- a minimal stub
// is enough (real resolver behavior is covered by envelope-resolution.test.ts
// and created-records.test.ts).
const fakeCtx = { user: { id: 'user-1' }, profile: {}, supabase: {} } as never

describe('toDisplayMessages', () => {
  it('turns a simple user/assistant exchange into display messages, resolving provenance from the lookup', async () => {
    const rows = [
      row({ id: 'm1', role: 'user', content: 'What is KB Sandbox?' }),
      row({ id: 'm2', role: 'assistant', content: 'A knowledge platform.', provider: 'groq', model: 'openai/gpt-oss-20b' }),
    ]
    const lookup = new Map([['groq::openai/gpt-oss-20b', { providerDisplayName: 'Groq', modelDisplayName: 'GPT-OSS 20B' }]])

    expect(await toDisplayMessages(rows, lookup, fakeCtx)).toEqual([
      { role: 'user', content: 'What is KB Sandbox?' },
      {
        role: 'assistant',
        content: 'A knowledge platform.',
        providerDisplayName: 'Groq',
        modelDisplayName: 'GPT-OSS 20B',
        toolsUsed: undefined,
        structured: undefined,
        createdRecords: undefined,
      },
    ])
  })

  it('reconstructs toolsUsed from an intermediate tool-call row, folding it into the next real reply', async () => {
    const rows = [
      row({ id: 'm1', role: 'user', content: 'What do we know about chunking?' }),
      row({ id: 'm2', role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'search_wiki', arguments: { query: 'chunking' } }] }),
      row({ id: 'm3', role: 'tool', content: '{}', tool_call_id: 'c1', tool_name: 'search_wiki' }),
      row({ id: 'm4', role: 'assistant', content: 'Found some articles.', provider: 'groq', model: 'openai/gpt-oss-20b' }),
    ]

    const result = await toDisplayMessages(rows, new Map(), fakeCtx)

    expect(result).toEqual([
      { role: 'user', content: 'What do we know about chunking?' },
      {
        role: 'assistant',
        content: 'Found some articles.',
        providerDisplayName: 'groq',
        modelDisplayName: 'openai/gpt-oss-20b',
        toolsUsed: ['search_wiki'],
        structured: undefined,
        createdRecords: undefined,
      },
    ])
  })

  it('shows the queries a reply sent to the web, skipping refused calls and older results without one', async () => {
    const rows = [
      row({ id: 'm1', role: 'user', content: 'Research Acme' }),
      row({
        id: 'm2',
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'c1', name: 'search_web', arguments: { query: 'Acme Corp' } },
          { id: 'c2', name: 'search_web', arguments: { query: 'Acme Corp news' } },
          { id: 'c3', name: 'search_web', arguments: { query: 'Acme third' } },
        ],
      }),
      row({ id: 'm3', role: 'tool', content: JSON.stringify({ query: 'Acme Corp', results: [], answer: null }), tool_call_id: 'c1', tool_name: 'search_web' }),
      row({ id: 'm4', role: 'tool', content: JSON.stringify({ query: 'Acme Corp news', error: 'Tavily search failed (500)' }), tool_call_id: 'c2', tool_name: 'search_web' }),
      row({ id: 'm5', role: 'tool', content: JSON.stringify({ error: 'search_web has already been called 2 times this turn.' }), tool_call_id: 'c3', tool_name: 'search_web' }),
      row({ id: 'm6', role: 'assistant', content: 'Here is what I found.', provider: 'groq', model: 'openai/gpt-oss-20b' }),
      row({ id: 'm7', role: 'user', content: 'And earlier?' }),
      row({ id: 'm8', role: 'assistant', content: '', tool_calls: [{ id: 'c4', name: 'search_web', arguments: { query: 'old' } }] }),
      row({ id: 'm9', role: 'tool', content: JSON.stringify({ results: [], answer: null }), tool_call_id: 'c4', tool_name: 'search_web' }),
      row({ id: 'm10', role: 'assistant', content: 'Nothing new.', provider: 'groq', model: 'openai/gpt-oss-20b' }),
    ]

    const result = await toDisplayMessages(rows, new Map(), fakeCtx)

    expect(result[1]).toMatchObject({ content: 'Here is what I found.', webSearchQueries: ['Acme Corp', 'Acme Corp news'] })
    expect(result[3]).toMatchObject({ content: 'Nothing new.' })
    expect((result[3] as { webSearchQueries?: string[] }).webSearchQueries).toBeUndefined()
  })

  it('falls back to the raw provider/model identifiers when a model has since been renamed or removed', async () => {
    const rows = [row({ role: 'assistant', content: 'ok', provider: 'deepseek', model: 'deepseek-v4-flash' })]

    const result = await toDisplayMessages(rows, new Map(), fakeCtx)

    expect(result[0]).toEqual({
      role: 'assistant',
      content: 'ok',
      providerDisplayName: 'deepseek',
      modelDisplayName: 'deepseek-v4-flash',
      toolsUsed: undefined,
      structured: undefined,
      createdRecords: undefined,
    })
  })

  it('does not carry toolsUsed over into a later turn that used no tools', async () => {
    const rows = [
      row({ id: 'm1', role: 'user', content: 'first' }),
      row({ id: 'm2', role: 'assistant', content: '', tool_calls: [{ id: 'c1', name: 'search_wiki', arguments: {} }] }),
      row({ id: 'm3', role: 'tool', content: '{}', tool_call_id: 'c1', tool_name: 'search_wiki' }),
      row({ id: 'm4', role: 'assistant', content: 'first reply' }),
      row({ id: 'm5', role: 'user', content: 'second' }),
      row({ id: 'm6', role: 'assistant', content: 'second reply' }),
    ]

    const result = await toDisplayMessages(rows, new Map(), fakeCtx)

    expect(result[1].toolsUsed).toEqual(['search_wiki'])
    expect(result[3].toolsUsed).toBeUndefined()
  })
})
