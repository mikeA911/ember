import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const listMessagesMock = vi.fn()
const getActiveStructuredOutputProviderMock = vi.fn()

vi.mock('./conversations', () => ({
  listMessages: (...args: unknown[]) => listMessagesMock(...args),
}))
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai')
  return {
    // withPolicyGate stays REAL -- these tests exercise the actual gate
    // against fakeCtx's queued ai_providers/resource_access_policies/
    // ai_provider_sensitivity_eligibility results, same as loop.test.ts does
    // for getEffectiveSensitivity/assertProviderEligible.
    withPolicyGate: actual.withPolicyGate,
    getActiveStructuredOutputProvider: (...args: unknown[]) => getActiveStructuredOutputProviderMock(...args),
  }
})

// Document tiers are read with the service-role client; route them to the
// same fake the test hands to fakeCtx.
let tierClient: unknown = null
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => tierClient }))

const { maybeRefreshSummary, getConversationSummary } = await import('./summary')

function fakeCtx(supabase: unknown): WorkbenchCallerContext {
  tierClient = supabase
  return { user: { id: 'user-1' }, profile: { id: 'user-1', role: 'curator' }, supabase } as unknown as WorkbenchCallerContext
}

function userRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({ id: `m${i}`, role: 'user', content: `q${i}`, tool_calls: null }))
}

beforeEach(() => {
  listMessagesMock.mockReset()
  getActiveStructuredOutputProviderMock.mockReset()
})

describe('getConversationSummary', () => {
  it('returns the stored summary_json', async () => {
    const supabase = createFakeSupabase({ conversations: [{ data: { summary_json: { objective: 'x' } }, error: null }] })
    expect(await getConversationSummary(supabase as never, 'conv-1')).toEqual({ objective: 'x' })
  })

  it('returns null when the conversation row is missing', async () => {
    const supabase = createFakeSupabase({ conversations: [{ data: null, error: null }] })
    expect(await getConversationSummary(supabase as never, 'conv-1')).toBeNull()
  })
})

describe('maybeRefreshSummary', () => {
  it('does nothing when fewer than 10 turns have passed and the context was not truncated', async () => {
    const supabase = createFakeSupabase({
      conversations: [{ data: { summary_json: null, summary_through_message_id: null }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(2))

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 0)

    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('does nothing when there is no history yet, even if flagged as truncated', async () => {
    const supabase = createFakeSupabase({
      conversations: [{ data: { summary_json: null, summary_through_message_id: null }, error: null }],
    })
    listMessagesMock.mockResolvedValue([])

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 1)

    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('refreshes once ~10 turns have passed since the last summary', async () => {
    const supabase = createFakeSupabase({
      conversations: [
        { data: { summary_json: null, summary_through_message_id: null }, error: null },
        { data: null, error: null },
      ],
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(10))
    const generateStructured = vi.fn().mockResolvedValue({ data: { objective: 'o' }, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'groq', generateStructured })

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 0)

    expect(generateStructured).toHaveBeenCalled()
  })

  it('refreshes immediately when the working context cut turns there is no summary of yet, even with few turns', async () => {
    const supabase = createFakeSupabase({
      conversations: [
        { data: { summary_json: null, summary_through_message_id: null }, error: null },
        { data: null, error: null },
      ],
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(2))
    const generateStructured = vi.fn().mockResolvedValue({ data: { objective: 'o' }, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'groq', generateStructured })

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 1)

    expect(generateStructured).toHaveBeenCalled()
  })

  // Phase 2, increment 1: the separately-resolved summary provider must be
  // gated too, not just the live turn's own chatProvider -- this is the gap
  // docs/design-notes/ai-policy-enforcement-service-and-context-manifest.md
  // flagged as the most urgent. A blocked decision must skip the refresh
  // (generateStructured never called, conversations row never updated)
  // without throwing out of maybeRefreshSummary -- caught by its own
  // catch-all, same as the existing "never throws" test below.
  it('skips the refresh (never calls generateStructured) when retrieved evidence exceeds the summary provider\'s approved sensitivity', async () => {
    const rows = [
      { id: 'm0', role: 'user', content: 'q0', tool_calls: null },
      {
        id: 'm1',
        role: 'tool',
        content: '{}',
        tool_calls: null,
        retrieved_resources: [{ resourceType: 'knowledge_source', resourceId: 'ks-restricted' }],
      },
      ...userRows(9),
    ]
    const supabase = createFakeSupabase({
      conversations: [{ data: { summary_json: null, summary_through_message_id: null }, error: null }],
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
      resource_access_policies: [{ data: [{ resource_id: 'ks-restricted', information_sensitivity: 'restricted' }], error: null }],
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    listMessagesMock.mockResolvedValue(rows)
    const generateStructured = vi.fn().mockResolvedValue({ data: { objective: 'o' }, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'groq', generateStructured })
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 0)

    expect(generateStructured).not.toHaveBeenCalled()
    expect(supabase._calls.find((c) => c.table === 'conversations' && c.method === 'update')).toBeUndefined()
    errorSpy.mockRestore()
  })

  it('never throws -- a generation failure is logged, not surfaced, mirroring embedApprovedVersion', async () => {
    const supabase = createFakeSupabase({
      conversations: [{ data: { summary_json: null, summary_through_message_id: null }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(10))
    getActiveStructuredOutputProviderMock.mockRejectedValue(new Error('provider down'))
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 0)).resolves.toBeUndefined()

    errorSpy.mockRestore()
  })

  it('does nothing when the conversation row lookup fails', async () => {
    const supabase = createFakeSupabase({ conversations: [{ data: null, error: new Error('not found') }] })

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 1)

    expect(listMessagesMock).not.toHaveBeenCalled()
  })

  // The cut moves in steps, so most truncated turns cut nothing new: those
  // must not cost a summary call or change the start of the next prompt.
  it('does not refresh when the summary already covers everything the context cut', async () => {
    const supabase = createFakeSupabase({
      conversations: [{ data: { summary_json: { objective: 'o' }, summary_through_message_id: 'm3' }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(6))

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 4)

    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('refreshes from the previous summary plus only the messages after it', async () => {
    const supabase = createFakeSupabase({
      conversations: [
        { data: { summary_json: { objective: 'earlier objective' }, summary_through_message_id: 'm1' }, error: null },
        { data: null, error: null },
      ],
      ai_providers: [{ data: { id: 'provider-1' }, error: null }],
    })
    listMessagesMock.mockResolvedValue(userRows(6))
    const generateStructured = vi.fn().mockResolvedValue({ data: { objective: 'o' }, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'groq', generateStructured })

    await maybeRefreshSummary(fakeCtx(supabase), 'conv-1', 4)

    const { prompt } = generateStructured.mock.calls[0][0] as { prompt: string }
    expect(prompt).toContain('earlier objective')
    expect(prompt).toContain('user: q2')
    expect(prompt).toContain('user: q5')
    expect(prompt).not.toContain('user: q0')
    expect(prompt).not.toContain('user: q1')
  })
})
