import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const resolveChatProviderMock = vi.fn()
const getDefaultModelMock = vi.fn()
const generateChatMock = vi.fn()
const callToolMock = vi.fn()
const getToolSpecsMock = vi.fn()
const createConversationMock = vi.fn()
const listMessagesMock = vi.fn()
const appendMessageMock = vi.fn()
const updateMock = vi.fn()
const conversationBindUpdateMock = vi.fn()
const getConversationSummaryMock = vi.fn()
const maybeRefreshSummaryMock = vi.fn()
const buildPersistedEnvelopeMock = vi.fn()
const resolveEnvelopeForDisplayMock = vi.fn()
const resolveCreatedRecordMock = vi.fn()
const runSearchWebMock = vi.fn()
const tavilyApiKeyMock = vi.fn()
const runSearchMyWorkingKnowledgeMock = vi.fn()
const runSearchSharedWorkingKnowledgeMock = vi.fn()
const runSaveWorkingKnowledgeMock = vi.fn()

vi.mock('./web-search-tool', () => ({
  SEARCH_WEB_TOOL: { name: 'search_web', description: '', parameters: {} },
  SEARCH_WEB_TOOL_NAME: 'search_web',
  runSearchWeb: (...args: unknown[]) => runSearchWebMock(...args),
}))
vi.mock('./working-knowledge-tool', () => ({
  SEARCH_MY_WORKING_KNOWLEDGE_TOOL: { name: 'search_my_working_knowledge', description: '', parameters: {} },
  SEARCH_MY_WORKING_KNOWLEDGE_TOOL_NAME: 'search_my_working_knowledge',
  SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL: { name: 'search_shared_working_knowledge', description: '', parameters: {} },
  SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL_NAME: 'search_shared_working_knowledge',
  SAVE_WORKING_KNOWLEDGE_TOOL: { name: 'save_working_knowledge', description: '', parameters: {} },
  SAVE_WORKING_KNOWLEDGE_TOOL_NAME: 'save_working_knowledge',
  runSearchMyWorkingKnowledge: (...args: unknown[]) => runSearchMyWorkingKnowledgeMock(...args),
  runSearchSharedWorkingKnowledge: (...args: unknown[]) => runSearchSharedWorkingKnowledgeMock(...args),
  runSaveWorkingKnowledge: (...args: unknown[]) => runSaveWorkingKnowledgeMock(...args),
}))
// Only tavilyApiKey is used by loop.ts itself -- runSearchWeb's own env
// lookup lives inside the mocked ./web-search-tool module above, so it
// never actually runs here. productMode fixed at 'enterprise' -- Builder AI
// Usage Metering + BYOLLM (isOwnBuilderLabProject/resolveBuilderLlmProvider)
// only ever engage in builder mode, so every existing test here stays on
// the untouched platform-default path; that new machinery has its own
// dedicated coverage in metering.test.ts/builder-llm-credentials.test.ts.
vi.mock('@/lib/env', () => ({ env: { tavilyApiKey: () => tavilyApiKeyMock(), productMode: () => 'enterprise' } }))
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai')
  return {
    AIProviderError: actual.AIProviderError,
    classifyProviderError: actual.classifyProviderError,
    // Real implementations (not mocked) -- they only touch ctx.supabase,
    // which fakeCtx() below stubs with sensible defaults ('public'/no
    // eligibility row -> never blocks) for every test that isn't
    // specifically about the sensitivity check itself.
    AISensitivityError: actual.AISensitivityError,
    getEffectiveSensitivity: actual.getEffectiveSensitivity,
    assertProviderEligible: actual.assertProviderEligible,
    resolveChatProvider: (...args: unknown[]) => resolveChatProviderMock(...args),
    getDefaultModel: (...args: unknown[]) => getDefaultModelMock(...args),
    // Real class, never mocked -- loop.ts's catch block does `err instanceof
    // BuilderAllowanceError` on every thrown error regardless of builder
    // mode, so this must be a real constructor even though productMode is
    // fixed at 'enterprise' here and the gate itself never actually throws
    // in these tests. withLogging/withAllowanceGate/getBuilderSpendSummary/
    // instantiateProvider are deliberately left out -- they're only ever
    // called from the builder-mode-only branch these tests never take.
    BuilderAllowanceError: actual.BuilderAllowanceError,
  }
})
vi.mock('@/lib/mcp/tools', () => ({
  callTool: (...args: unknown[]) => callToolMock(...args),
  getToolSpecs: (...args: unknown[]) => getToolSpecsMock(...args),
}))
vi.mock('./conversations', () => ({
  createConversation: (...args: unknown[]) => createConversationMock(...args),
  listMessages: (...args: unknown[]) => listMessagesMock(...args),
  appendMessage: (...args: unknown[]) => appendMessageMock(...args),
}))
// composeWorkingContext (./context) is left unmocked -- pure and cheap, and
// these tiny fixture histories never approach its budget, so it passes
// `history` through unchanged. Only the summary side effects are mocked.
vi.mock('./summary', () => ({
  getConversationSummary: (...args: unknown[]) => getConversationSummaryMock(...args),
  maybeRefreshSummary: (...args: unknown[]) => maybeRefreshSummaryMock(...args),
}))
// The resolvers' own DB-querying logic has dedicated test files
// (navigation-resolver.test.ts, document-resolver.test.ts) -- these tests
// exercise loop.ts's own orchestration (detecting present_assistant_response,
// citation verification against real turn provenance, validation-failure
// fallback), not resolver internals, which fakeCtx()'s minimal supabase
// stub can't support anyway.
vi.mock('./envelope-resolution', () => ({
  buildPersistedEnvelope: (...args: unknown[]) => buildPersistedEnvelopeMock(...args),
  resolveEnvelopeForDisplay: (...args: unknown[]) => resolveEnvelopeForDisplayMock(...args),
}))
vi.mock('./created-records', () => ({
  resolveCreatedRecord: (...args: unknown[]) => resolveCreatedRecordMock(...args),
}))

const { runAssistantTurn, MAX_TOOL_ITERATIONS, SEARCH_WIKI_LIMIT } = await import('./loop')
const { AIProviderError } = await import('@/lib/ai')

// project_id: null keeps every existing test on the general (unbound) path
// -- project-bound behavior (getProjectContext, search_project_knowledge)
// has its own dedicated coverage in project-knowledge-tool.test.ts and
// project-context.test.ts, not here.
// Table-aware from() -- the Information Sensitivity Classification check
// (src/lib/ai/sensitivity.ts) added its own queries against ai_providers,
// resource_access_policies, wiki_articles, and ai_provider_sensitivity_eligibility
// that run on every generateChat call, alongside the pre-existing
// conversations-table calls this stub already supported. Defaults below
// (no policy rows, no eligibility row) resolve to 'public'/'internal' with
// no test-visible effect -- see sensitivity.test.ts for the classification
// logic itself; this file only needs the check to not crash or block.
function fakeCtx(): WorkbenchCallerContext {
  return {
    user: { id: 'user-1' },
    profile: { id: 'user-1', role: 'curator' },
    supabase: {
      from: (table: string) => {
        if (table === 'ai_providers') {
          return { select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'provider-1' }, error: null }) }) }) }
        }
        if (table === 'resource_access_policies') {
          return { select: () => ({ eq: () => ({ in: async () => ({ data: [], error: null }) }) }) }
        }
        if (table === 'wiki_articles') {
          return { select: () => ({ in: async () => ({ data: [], error: null }) }) }
        }
        if (table === 'ai_provider_sensitivity_eligibility') {
          return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }
        }
        if (table === 'conversations') {
          return {
            update: (...args: unknown[]) => {
              conversationBindUpdateMock(...args)
              return { eq: () => ({ is: async () => ({ error: null }) }) }
            },
            select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'conv-1', project_id: null }, error: null }) }) }),
          }
        }
        return {
          update: (...args: unknown[]) => updateMock(...args),
          eq: () => ({}),
          select: () => ({ eq: () => ({ single: async () => ({ data: { id: 'conv-1', project_id: null }, error: null }) }) }),
        }
      },
    },
  } as unknown as WorkbenchCallerContext
}

const CHAT_PROVIDER_INFO = {
  providerName: 'groq',
  providerDisplayName: 'Groq',
  modelId: 'openai/gpt-oss-20b',
  modelDisplayName: 'GPT-OSS 20B',
}
// maxOutputTokens/contextWindow are deliberately not in this fixture --
// they're read for generateChat/composeWorkingContext but never surfaced on
// AssistantTurnResult, and several assertions below build their expected
// value via `...CHAT_PROVIDER_INFO`.
const RESOLVED_CHAT_PROVIDER = { ...CHAT_PROVIDER_INFO, maxOutputTokens: 2048, contextWindow: 8192 }

beforeEach(() => {
  resolveChatProviderMock.mockReset()
  getDefaultModelMock.mockReset()
  generateChatMock.mockReset()
  callToolMock.mockReset()
  getToolSpecsMock.mockReset()
  createConversationMock.mockReset()
  listMessagesMock.mockReset()
  appendMessageMock.mockReset()
  updateMock.mockReset()
  conversationBindUpdateMock.mockReset()
  getConversationSummaryMock.mockReset()
  maybeRefreshSummaryMock.mockReset()
  buildPersistedEnvelopeMock.mockReset()
  resolveEnvelopeForDisplayMock.mockReset()
  resolveCreatedRecordMock.mockReset()
  runSearchWebMock.mockReset()
  tavilyApiKeyMock.mockReset()
  runSearchMyWorkingKnowledgeMock.mockReset()
  runSearchSharedWorkingKnowledgeMock.mockReset()
  runSaveWorkingKnowledgeMock.mockReset()
  // Unset by default -- matches most tests' expectation that search_web is
  // simply absent unless a test opts in.
  tavilyApiKeyMock.mockReturnValue(undefined)

  resolveChatProviderMock.mockResolvedValue({ provider: { generateChat: generateChatMock }, ...RESOLVED_CHAT_PROVIDER })
  getDefaultModelMock.mockResolvedValue({ provider: { name: 'gemini' }, model: { display_name: 'Gemini Embedding' } })
  getToolSpecsMock.mockReturnValue([])
  createConversationMock.mockResolvedValue({ id: 'conv-1' })
  listMessagesMock.mockResolvedValue([])
  appendMessageMock.mockResolvedValue(undefined)
  updateMock.mockReturnValue({ eq: () => Promise.resolve({ error: null }) })
  getConversationSummaryMock.mockResolvedValue(null)
  maybeRefreshSummaryMock.mockResolvedValue(undefined)
  // Identity-ish passthroughs by default -- individual tests override to
  // assert on exactly what loop.ts passed in.
  buildPersistedEnvelopeMock.mockImplementation(async (_ctx, parsed) => parsed)
  resolveEnvelopeForDisplayMock.mockImplementation(async (_ctx, persisted) => persisted)
  resolveCreatedRecordMock.mockResolvedValue(null)
})

describe('runAssistantTurn', () => {
  it('returns a plain text reply with no tool call, in a single provider round-trip, carrying the active model identity', async () => {
    generateChatMock.mockResolvedValue({
      message: { role: 'assistant', content: 'KB Sandbox is a knowledge platform.' },
      model: 'test-model',
      usage: { inputTokens: 10, outputTokens: 8 },
    })

    const result = await runAssistantTurn(fakeCtx(), null, 'What is KB Sandbox?')

    expect(result).toEqual({
      conversationId: 'conv-1',
      reply: 'KB Sandbox is a knowledge platform.',
      toolsUsed: [],
      structured: null,
      createdRecords: [],
      pendingGatewayInvocations: [],
      ...CHAT_PROVIDER_INFO,
    })
    expect(generateChatMock).toHaveBeenCalledTimes(1)
    // The model's configured max_output_tokens (RESOLVED_CHAT_PROVIDER.maxOutputTokens)
    // must reach the actual provider call -- this is what makes an admin-set
    // cap (e.g. to control cost on a new provider) actually take effect.
    expect(generateChatMock).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 2048 }))
    expect(callToolMock).not.toHaveBeenCalled()
    expect(getDefaultModelMock).not.toHaveBeenCalled()
    // A brand-new conversation (conversationId param was null) can't have a
    // summary yet -- not even looked up.
    expect(getConversationSummaryMock).not.toHaveBeenCalled()
    // Refreshed after a successful reply, with the turn's truncation status
    // and (for this non-project conversation) an undefined projectSensitivity.
    expect(maybeRefreshSummaryMock).toHaveBeenCalledWith(expect.anything(), 'conv-1', false, undefined)
  })

  it('passes an explicit model selection straight through to resolveChatProvider', async () => {
    generateChatMock.mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(fakeCtx(), null, 'hi', { providerName: 'gemini', modelId: 'gemini-2.5-flash' })

    expect(resolveChatProviderMock).toHaveBeenCalledWith(
      expect.anything(),
      { providerName: 'gemini', modelId: 'gemini-2.5-flash' },
      expect.anything()
    )
  })

  it('executes one tool-call round trip, stamps provenance on the created project, and reports the tool as used', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'create_project', arguments: { name: 'Test' } }] },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Created the project.' },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 3 },
      })
    callToolMock.mockResolvedValue({ projectId: 'proj-1' })

    const result = await runAssistantTurn(fakeCtx(), null, 'Create a project called Test')

    expect(result.reply).toBe('Created the project.')
    expect(result.toolsUsed).toEqual(['create_project'])
    expect(result.embeddingModelDisplayName).toBeUndefined()
    expect(callToolMock).toHaveBeenCalledWith(expect.anything(), 'create_project', { name: 'Test' })
    expect(generateChatMock).toHaveBeenCalledTimes(2)
    // Provenance stamp: a follow-up update on the projects table for the new row.
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({ created_via: 'assistant', assistant_conversation_id: 'conv-1' })
    )
    // A general conversation that just created a project becomes that
    // project's own history -- bound going forward, not left as stray
    // general chat.
    expect(conversationBindUpdateMock).toHaveBeenCalledWith({ project_id: 'proj-1' })
    // Each persisted assistant message is stamped with the model that produced it.
    expect(appendMessageMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ role: 'assistant', provider: 'groq', model: 'openai/gpt-oss-20b' })
    )
  })

  it('includes the current default embedding model in the response once search_wiki has been used', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_wiki', arguments: { query: 'chunking' } }] },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Found some articles.' },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 3 },
      })
    callToolMock.mockResolvedValue({ articles: [] })

    const result = await runAssistantTurn(fakeCtx(), null, 'What do we know about chunking?')

    expect(result.toolsUsed).toEqual(['search_wiki'])
    expect(result.embeddingModelDisplayName).toBe('Gemini Embedding')
    expect(getDefaultModelMock).toHaveBeenCalledWith(expect.anything(), 'embedding')
  })

  it('stops after the iteration cap and returns a fallback rather than looping forever', async () => {
    generateChatMock.mockResolvedValue({
      message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-x', name: 'search_wiki', arguments: { query: 'x' } }] },
      model: 'test-model',
      usage: { inputTokens: 1, outputTokens: 1 },
    })
    callToolMock.mockResolvedValue({ articles: [] })

    const result = await runAssistantTurn(fakeCtx(), null, 'Loop forever')

    expect(result.reply).toMatch(/wasn't able to finish/i)
    expect(generateChatMock).toHaveBeenCalledTimes(8)
    // The summary is only refreshed after a successful reply, not the
    // iteration-cap fallback.
    expect(maybeRefreshSummaryMock).not.toHaveBeenCalled()
  })

  it('refuses a 3rd search_wiki call in the same turn without invoking the real tool', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_wiki', arguments: { query: 'first' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-2', name: 'search_wiki', arguments: { query: 'second' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-3', name: 'search_wiki', arguments: { query: 'third' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Answering with what I found.' },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    callToolMock.mockResolvedValue({ articles: [] })

    const result = await runAssistantTurn(fakeCtx(), null, 'Find me the right method')

    expect(result.reply).toBe('Answering with what I found.')
    // Only the first two search_wiki calls actually ran the real tool
    // (embedding + RPC) -- the 3rd was refused in-process, for free.
    expect(callToolMock).toHaveBeenCalledTimes(2)
    const refusalMessage = appendMessageMock.mock.calls
      .map(([, args]) => args)
      .find((args) => args.toolCallId === 'call-3')
    expect(refusalMessage.content).toContain('already been called 2 times')
  })

  it('continues an existing conversation by loading its prior history first', async () => {
    listMessagesMock.mockResolvedValue([
      { role: 'user', content: 'earlier question', tool_calls: null, tool_call_id: null, tool_name: null },
      { role: 'assistant', content: 'earlier answer', tool_calls: null, tool_call_id: null, tool_name: null },
    ])
    let capturedMessages: unknown
    generateChatMock.mockImplementation(async (input: { messages: unknown }) => {
      // history is a single mutated array reused across the loop -- snapshot
      // it at call time, since inspecting mock.calls afterwards would see
      // the same reference post-mutation, not what was actually sent.
      capturedMessages = JSON.parse(JSON.stringify(input.messages))
      return { message: { role: 'assistant', content: 'follow-up answer' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } }
    })

    const result = await runAssistantTurn(fakeCtx(), 'conv-1', 'follow-up question')

    expect(result.conversationId).toBe('conv-1')
    expect(createConversationMock).not.toHaveBeenCalled()
    expect(getConversationSummaryMock).toHaveBeenCalledWith(expect.anything(), 'conv-1')
    expect(capturedMessages).toEqual([
      { role: 'user', content: 'earlier question', toolCalls: undefined, toolCallId: undefined, toolName: undefined },
      { role: 'assistant', content: 'earlier answer', toolCalls: undefined, toolCallId: undefined, toolName: undefined },
      { role: 'user', content: 'follow-up question' },
    ])
  })

  // Regression coverage for a live incident: an uncaught AIProviderError
  // (Groq's TPM/413 rate limit) crossed the sendChatMessageAction Server
  // Action boundary and reached the user as an opaque production Next.js
  // digest error ("Minified React error #441") instead of a readable
  // message. generateChat failing must resolve normally, never throw.
  it('turns a provider failure into a normal, friendly result instead of throwing', async () => {
    generateChatMock.mockRejectedValue(
      new AIProviderError('groq', 'generate_chat', 'groq generateChat failed: 413 Request too large...', {
        status: 413,
        message: 'Request too large for model on tokens per minute (TPM): Limit 8000, Requested 9029',
      })
    )

    const result = await runAssistantTurn(fakeCtx(), null, 'what can i offer health care providers')

    expect(result.isProviderError).toBe(true)
    expect(result.reply).toMatch(/capacity limit with groq/i)
    expect(result.conversationId).toBe('conv-1')
    // A failed attempt must not be persisted as if it were a real turn.
    expect(appendMessageMock).toHaveBeenCalledTimes(1) // only the user message
    expect(appendMessageMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ role: 'user' }))
    expect(maybeRefreshSummaryMock).not.toHaveBeenCalled()
  })

  it('still produces a normal-shaped friendly result for a non-AIProviderError throw', async () => {
    generateChatMock.mockRejectedValue(new Error('socket hang up'))

    const result = await runAssistantTurn(fakeCtx(), null, 'hello')

    expect(result.isProviderError).toBe(true)
    expect(result.reply).toMatch(/couldn't get a response/i)
  })
})

describe('runAssistantTurn -- structured responses', () => {
  it('treats present_assistant_response as terminal and returns its resolved envelope', async () => {
    generateChatMock.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'present_assistant_response', arguments: { schemaVersion: '1.0', message: 'Here you go.' } }],
      },
      model: 'test-model',
      usage: { inputTokens: 5, outputTokens: 5 },
    })

    const result = await runAssistantTurn(fakeCtx(), null, 'Help me pick a method')

    expect(result.reply).toBe('Here you go.')
    expect(result.structured).toMatchObject({ message: 'Here you go.' })
    expect(callToolMock).not.toHaveBeenCalled()
    const assistantAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.role === 'assistant')
    expect(assistantAppend?.[1]).toMatchObject({ content: 'Here you go.', responsePayload: { message: 'Here you go.' } })
  })

  it('falls back to plain text when the envelope fails schema validation, recovering the message from the raw arguments', async () => {
    generateChatMock.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call-1', name: 'present_assistant_response', arguments: { message: 'Recovered text.', requirements: 'not-an-array' } }],
      },
      model: 'test-model',
      usage: { inputTokens: 5, outputTokens: 5 },
    })

    const result = await runAssistantTurn(fakeCtx(), null, 'Help me pick a method')

    expect(result.reply).toBe('Recovered text.')
    expect(result.structured).toBeNull()
    expect(buildPersistedEnvelopeMock).not.toHaveBeenCalled()
    const assistantAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.role === 'assistant')
    expect(assistantAppend?.[1]).toMatchObject({ content: 'Recovered text.', responsePayload: null })
  })

  it('accumulates real search_wiki provenance and threads it into buildPersistedEnvelope for citation verification', async () => {
    getToolSpecsMock.mockReturnValue([{ name: 'search_wiki', description: '', parameters: {} }])
    callToolMock.mockResolvedValue({ articles: [{ articleId: 'a1', slug: 'openapi-discovery-workbench-method', title: 'OpenAPI Discovery', category: null, similarity: 0.9, content: '...' }] })
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_wiki', arguments: { query: 'openapi' } }] },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 5 },
      })
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-2', name: 'present_assistant_response', arguments: { schemaVersion: '1.0', message: 'Found it.' } }],
        },
        model: 'test-model',
        usage: { inputTokens: 5, outputTokens: 5 },
      })

    await runAssistantTurn(fakeCtx(), null, 'Which method recovers an API spec?')

    expect(buildPersistedEnvelopeMock).toHaveBeenCalledTimes(1)
    const retrieved = buildPersistedEnvelopeMock.mock.calls[0][2]
    expect(retrieved.wikiArticleSlugs.has('openapi-discovery-workbench-method')).toBe(true)

    // Phase 2, increment 1: the same retrieval also has to be persisted onto
    // the tool-role row (not just held in-memory for this turn), since
    // summary.ts has no access to loop.ts's in-memory maps and rebuilds its
    // policy manifest from chat_messages.retrieved_resources alone.
    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.role === 'tool')
    expect(toolAppend?.[1].retrievedResources).toEqual([{ resourceType: 'wiki_article', resourceId: 'openapi-discovery-workbench-method' }])
  })

  // Information Sensitivity Classification (Shadow AI blog, 2026-08-28):
  // once a retrieved resource is classified above what the active provider
  // is approved to receive, the NEXT generateChat call (which would include
  // that resource's content in its prompt) must never fire -- the check
  // runs before inference, not after.
  it('blocks the next generateChat call once retrieved evidence exceeds the provider\'s approved sensitivity', async () => {
    getToolSpecsMock.mockReturnValue([{ name: 'search_wiki', description: '', parameters: {} }])
    callToolMock.mockResolvedValue({ articles: [{ articleId: 'a1', slug: 'restricted-article', title: 'Restricted', category: null, similarity: 0.9, content: '...' }] })
    generateChatMock.mockResolvedValueOnce({
      message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_wiki', arguments: { query: 'restricted' } }] },
      model: 'test-model',
      usage: { inputTokens: 5, outputTokens: 5 },
    })
    // If the block didn't fire, this second response would be consumed --
    // asserting generateChatMock is called exactly once (below) is what
    // actually proves the pre-inference check worked.

    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'wiki_articles') {
        return { select: () => ({ in: async () => ({ data: [{ id: 'article-restricted' }], error: null }) }) }
      }
      if (table === 'resource_access_policies') {
        return { select: () => ({ eq: () => ({ in: async () => ({ data: [{ resource_id: 'article-restricted', information_sensitivity: 'restricted' }], error: null }) }) }) }
      }
      if (table === 'ai_provider_sensitivity_eligibility') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { max_sensitivity: 'internal' }, error: null }) }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from

    const result = await runAssistantTurn(ctx, null, 'What does the restricted article say?')

    expect(result.isSensitivityBlock).toBe(true)
    expect(result.reply).toMatch(/Restricted information/i)
    expect(generateChatMock).toHaveBeenCalledTimes(1)
  })

  // Closes the gap flagged in docs/dev-request-enterprise-shadow-ai-
  // governance-later-phases.md: a project's own name/goal is embedded into
  // the system prompt on every turn (buildProjectPromptAddendum), not only
  // once a tool has retrieved something -- so a classified project must
  // block the VERY FIRST generateChat call, before any search_wiki/
  // search_project_knowledge call could even run.
  it("blocks the first generateChat call when the bound project itself is classified above the provider's approved sensitivity", async () => {
    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { id: 'proj-1', name: 'Restricted Project', goal: null, information_sensitivity: 'restricted' }, error: null }),
            }),
          }),
        }
      }
      if (table === 'project_knowledge_bases' || table === 'project_wiki_articles') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      if (table === 'ai_provider_sensitivity_eligibility') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { max_sensitivity: 'internal' }, error: null }) }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from
    createConversationMock.mockResolvedValueOnce({ id: 'conv-1', project_id: 'proj-1' })

    const result = await runAssistantTurn(ctx, null, 'What is this project about?', undefined, 'proj-1')

    expect(result.isSensitivityBlock).toBe(true)
    expect(result.reply).toMatch(/Restricted information/i)
    expect(generateChatMock).not.toHaveBeenCalled()
  })

  it('drops other requested tool calls when present_assistant_response is submitted in the same batch', async () => {
    generateChatMock.mockResolvedValue({
      message: {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'search_wiki', arguments: { query: 'openapi' } },
          { id: 'call-2', name: 'present_assistant_response', arguments: { schemaVersion: '1.0', message: 'Done.' } },
        ],
      },
      model: 'test-model',
      usage: { inputTokens: 5, outputTokens: 5 },
    })

    const result = await runAssistantTurn(fakeCtx(), null, 'Help me pick a method')

    expect(callToolMock).not.toHaveBeenCalled()
    expect(result.reply).toBe('Done.')
    // No stray tool-role message should have been appended for the dropped call.
    expect(appendMessageMock.mock.calls.some(([, arg]) => arg.role === 'tool')).toBe(false)
  })
})

// Role-Aware Project Views and Ember-First Member Workspace, Stage 3/4
// (docs/dev-request-role-aware-project-views-and-ember-first-workspace.md).
// Acceptance criterion 30: general (unbound) Ember chat must have no
// member-lookup tool and cannot enumerate a Project roster -- this is the
// direct test for that, at the same level (the `tools` array actually
// handed to generateChat) as every other tool-availability guarantee in
// this file.
describe('runAssistantTurn -- project-bound member tools', () => {
  it('offers list_project_members/send_project_note only in a project-bound conversation, never in general chat', async () => {
    generateChatMock.mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(fakeCtx(), null, 'hi')
    const generalTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(generalTools).not.toContain('list_project_members')
    expect(generalTools).not.toContain('send_project_note')
    expect(generalTools).not.toContain('list_workstreams')

    generateChatMock.mockClear()
    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'proj-1', name: 'Test Project', goal: null, information_sensitivity: null }, error: null }) }),
          }),
        }
      }
      if (table === 'project_knowledge_bases' || table === 'project_wiki_articles') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from
    createConversationMock.mockResolvedValueOnce({ id: 'conv-1', project_id: 'proj-1' })

    await runAssistantTurn(ctx, null, 'hi', undefined, 'proj-1')
    const projectTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(projectTools).toContain('list_project_members')
    expect(projectTools).toContain('send_project_note')
    expect(projectTools).toContain('list_workstreams')
  })
})

// Two live-observed failure modes (2026-09-04), fixed together since both
// stem from the model never being told a real database id and the
// resulting error being unreadable: (1) create_workstream is in the general
// callTool registry and takes a model-supplied projectId, but nothing told
// the model the current project's real UUID, so it guessed a slug from the
// project's name; (2) the Postgrest error that guess produced is a plain
// object (never an Error instance), which every catch block's old
// `err instanceof Error ? err.message : String(err)` rendered as the
// literal string "[object Object]" instead of the real message.
describe('runAssistantTurn -- create_workstream projectId and tool error messages', () => {
  function projectBoundCtx(): WorkbenchCallerContext {
    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'proj-1', name: 'Test Project', goal: null, information_sensitivity: null }, error: null }) }),
          }),
        }
      }
      if (table === 'project_knowledge_bases' || table === 'project_wiki_articles') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from
    createConversationMock.mockResolvedValueOnce({ id: 'conv-1', project_id: 'proj-1' })
    return ctx
  }

  it('overrides a hallucinated create_workstream projectId with the conversation\'s resolved project', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            {
              id: 'call-1',
              name: 'create_workstream',
              // A model-guessed slug, not the real project id -- exactly
              // what was observed live instead of 'proj-1'.
              arguments: { projectId: 'test-project', name: 'Research', slug: 'research', deliverables: [] },
            },
          ],
        },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Created it.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    callToolMock.mockResolvedValue({ workstreamId: 'ws-1' })

    await runAssistantTurn(projectBoundCtx(), null, 'Create a workstream for research', undefined, 'proj-1')

    expect(callToolMock).toHaveBeenCalledWith(
      expect.anything(),
      'create_workstream',
      expect.objectContaining({ projectId: 'proj-1' })
    )
  })

  it('leaves projectId untouched for create_workstream in a general (non-project-bound) conversation', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [{ id: 'call-1', name: 'create_workstream', arguments: { projectId: 'proj-explicit', name: 'Research', slug: 'research', deliverables: [] } }],
        },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Created it.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    callToolMock.mockResolvedValue({ workstreamId: 'ws-1' })

    await runAssistantTurn(fakeCtx(), null, 'Create a workstream for research')

    expect(callToolMock).toHaveBeenCalledWith(expect.anything(), 'create_workstream', expect.objectContaining({ projectId: 'proj-explicit' }))
  })

  it('surfaces a thrown Postgrest-shaped error\'s real message instead of "[object Object]"', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call-1', name: 'attach_workstream_artifact', arguments: { workstreamId: 'Phase 1 -- Showcase', artifactType: 'findings', title: 'x', content: 'y' } },
          ],
        },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'That failed.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    // A Postgrest error is a plain object, never an actual Error instance --
    // this is what supabase-js actually throws/returns on a DB failure.
    callToolMock.mockRejectedValue({ message: 'invalid input syntax for type uuid: "Phase 1 -- Showcase"', code: '22P02' })

    await runAssistantTurn(fakeCtx(), null, 'Attach my findings to Phase 1 -- Showcase')

    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toEqual({ error: 'invalid input syntax for type uuid: "Phase 1 -- Showcase"' })
  })

  it('falls back to String(err) for a genuinely message-less throw', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_wiki', arguments: { query: 'x' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })
    callToolMock.mockRejectedValue('a plain string throw')

    await runAssistantTurn(fakeCtx(), null, 'search for x')

    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toEqual({ error: 'a plain string throw' })
  })
})

// Ember web research for pre-sales, feeding a project's KB. search_web is
// project-scoped (like list_project_members/send_project_note above) AND
// gated on TAVILY_API_KEY being configured -- omitted entirely rather than
// offered-but-erroring, mirroring how resolveChatProvider only offers
// providers with a configured key.
describe('runAssistantTurn -- search_web', () => {
  function projectBoundCtx(): WorkbenchCallerContext {
    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'proj-1', name: 'Test Project', goal: null, information_sensitivity: null }, error: null }) }),
          }),
        }
      }
      if (table === 'project_knowledge_bases' || table === 'project_wiki_articles') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from
    createConversationMock.mockResolvedValueOnce({ id: 'conv-1', project_id: 'proj-1' })
    return ctx
  }

  it('offers search_web in a project-bound conversation only when TAVILY_API_KEY is configured', async () => {
    generateChatMock.mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(projectBoundCtx(), null, 'hi', undefined, 'proj-1')
    const unconfiguredTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(unconfiguredTools).not.toContain('search_web')

    generateChatMock.mockClear()
    tavilyApiKeyMock.mockReturnValue('fake-tavily-key')

    await runAssistantTurn(projectBoundCtx(), null, 'hi', undefined, 'proj-1')
    const configuredTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(configuredTools).toContain('search_web')
  })

  it('never offers search_web in a general (non-project-bound) conversation, even when configured', async () => {
    tavilyApiKeyMock.mockReturnValue('fake-tavily-key')
    generateChatMock.mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(fakeCtx(), null, 'hi')

    const tools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(tools).not.toContain('search_web')
  })

  it('dispatches a search_web tool call to runSearchWeb and round-trips its result', async () => {
    tavilyApiKeyMock.mockReturnValue('fake-tavily-key')
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_web', arguments: { query: 'Acme Corp' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Found some background on Acme Corp.' },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    runSearchWebMock.mockResolvedValue({ results: [{ title: 'Acme Corp', url: 'https://acme.example', content: 'About Acme.', score: 0.9, publishedDate: null }], answer: null })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'Research Acme Corp for me', undefined, 'proj-1')

    expect(result.reply).toBe('Found some background on Acme Corp.')
    expect(result.toolsUsed).toContain('search_web')
    expect(runSearchWebMock).toHaveBeenCalledWith({ query: 'Acme Corp' })
    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toMatchObject({ results: [{ title: 'Acme Corp' }] })
  })

  it('refuses a 3rd search_web call in the same turn without invoking the real tool', async () => {
    tavilyApiKeyMock.mockReturnValue('fake-tavily-key')
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_web', arguments: { query: 'first' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-2', name: 'search_web', arguments: { query: 'second' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-3', name: 'search_web', arguments: { query: 'third' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Answering with what I found.' },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    runSearchWebMock.mockResolvedValue({ results: [], answer: null })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'Research this thoroughly', undefined, 'proj-1')

    expect(result.reply).toBe('Answering with what I found.')
    expect(runSearchWebMock).toHaveBeenCalledTimes(2)
    const refusalMessage = appendMessageMock.mock.calls.map(([, args]) => args).find((args) => args.toolCallId === 'call-3')
    expect(refusalMessage.content).toContain('already been called 2 times')
  })

  it('catches a runSearchWeb failure and surfaces it as a tool-result error instead of failing the turn', async () => {
    tavilyApiKeyMock.mockReturnValue('fake-tavily-key')
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_web', arguments: { query: 'Acme Corp' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: 'Web research is unavailable right now.' },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
    runSearchWebMock.mockRejectedValue(new Error('Tavily search failed (500): server error'))

    const result = await runAssistantTurn(projectBoundCtx(), null, 'Research Acme Corp for me', undefined, 'proj-1')

    expect(result.reply).toBe('Web research is unavailable right now.')
    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toEqual({ error: 'Tavily search failed (500): server error' })
  })
})

// Working Knowledge & Research Notebooks Stage 1+2
// (docs/dev-request-project-scoped-working-knowledge-and-research-notebooks.md).
// Unlike search_web these three tools are NOT gated behind any env
// configuration -- always offered in a project-bound conversation,
// mirroring search_project_knowledge/list_workstreams.
describe('runAssistantTurn -- working knowledge tools', () => {
  function projectBoundCtx(): WorkbenchCallerContext {
    const ctx = fakeCtx()
    const originalFrom = ctx.supabase.from.bind(ctx.supabase)
    ctx.supabase.from = ((table: string) => {
      if (table === 'projects') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: 'proj-1', name: 'Test Project', goal: null, information_sensitivity: null }, error: null }) }),
          }),
        }
      }
      if (table === 'project_knowledge_bases' || table === 'project_wiki_articles') {
        return { select: () => ({ eq: async () => ({ data: [], error: null }) }) }
      }
      return originalFrom(table)
    }) as unknown as typeof ctx.supabase.from
    createConversationMock.mockResolvedValueOnce({ id: 'conv-1', project_id: 'proj-1' })
    return ctx
  }

  it('offers all three working-knowledge tools in a project-bound conversation, never in general chat', async () => {
    generateChatMock.mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(fakeCtx(), null, 'hi')
    const generalTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(generalTools).not.toContain('search_my_working_knowledge')
    expect(generalTools).not.toContain('search_shared_working_knowledge')
    expect(generalTools).not.toContain('save_working_knowledge')

    generateChatMock.mockClear()
    await runAssistantTurn(projectBoundCtx(), null, 'hi', undefined, 'proj-1')
    const projectTools = (generateChatMock.mock.calls[0][0] as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(projectTools).toContain('search_my_working_knowledge')
    expect(projectTools).toContain('search_shared_working_knowledge')
    expect(projectTools).toContain('save_working_knowledge')
  })

  it('refuses all three tools outside a project-bound conversation without invoking the real implementation', async () => {
    generateChatMock
      .mockResolvedValueOnce({
        message: {
          role: 'assistant',
          content: '',
          toolCalls: [
            { id: 'call-1', name: 'search_my_working_knowledge', arguments: {} },
            { id: 'call-2', name: 'search_shared_working_knowledge', arguments: {} },
            { id: 'call-3', name: 'save_working_knowledge', arguments: { type: 'working_note', title: 'x', content: 'y' } },
          ],
        },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'ok' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    await runAssistantTurn(fakeCtx(), null, 'hi')

    expect(runSearchMyWorkingKnowledgeMock).not.toHaveBeenCalled()
    expect(runSearchSharedWorkingKnowledgeMock).not.toHaveBeenCalled()
    expect(runSaveWorkingKnowledgeMock).not.toHaveBeenCalled()
    for (const [id, message] of [
      ['call-1', 'search_my_working_knowledge'],
      ['call-2', 'search_shared_working_knowledge'],
      ['call-3', 'save_working_knowledge'],
    ]) {
      const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === id)
      expect(JSON.parse(toolAppend?.[1].content)).toEqual({ error: `${message} is only available in a project-bound conversation.` })
    }
  })

  it('dispatches search_my_working_knowledge, reports it used, and threads its hits into buildPersistedEnvelope for citation verification', async () => {
    runSearchMyWorkingKnowledgeMock.mockResolvedValue({
      results: [{ id: 'wk-1', type: 'research_notebook', title: 'Acme research', trustStatus: 'working', visibility: 'private', content: '...', lastUsedAt: null, sourceCount: 1 }],
    })
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_my_working_knowledge', arguments: { query: 'Acme' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-2', name: 'present_assistant_response', arguments: { schemaVersion: '1.0', message: 'Found your notes.' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'What did I find on Acme?', undefined, 'proj-1')

    expect(result.toolsUsed).toContain('search_my_working_knowledge')
    expect(runSearchMyWorkingKnowledgeMock).toHaveBeenCalledWith(expect.anything(), 'proj-1', { query: 'Acme' })
    expect(buildPersistedEnvelopeMock).toHaveBeenCalledTimes(1)
    const retrieved = buildPersistedEnvelopeMock.mock.calls[0][2]
    expect(retrieved.workingKnowledgeIds.get('wk-1')).toEqual({ itemType: 'research_notebook', visibility: 'private' })
  })

  it('dispatches search_shared_working_knowledge and round-trips its result', async () => {
    runSearchSharedWorkingKnowledgeMock.mockResolvedValue({
      results: [{ id: 'wk-2', type: 'working_note', title: 'Shared note', trustStatus: 'working', visibility: 'shared_project', content: '...', ownerLabel: 'colleague@example.com', lastUsedAt: null, sourceCount: 0 }],
    })
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'search_shared_working_knowledge', arguments: {} }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Found a shared note.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'What has been shared with me?', undefined, 'proj-1')

    expect(result.reply).toBe('Found a shared note.')
    expect(result.toolsUsed).toContain('search_shared_working_knowledge')
    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toMatchObject({ results: [{ id: 'wk-2', ownerLabel: 'colleague@example.com' }] })
  })

  it('dispatches save_working_knowledge and pushes a createdRecordRefs entry the Created Records panel resolves', async () => {
    runSaveWorkingKnowledgeMock.mockResolvedValue({ itemId: 'wk-3' })
    resolveCreatedRecordMock.mockImplementation(async (_ctx, ref) =>
      ref.kind === 'working_knowledge' ? { kind: 'working_knowledge', id: 'wk-3', label: 'My research', href: '/projects/proj-1/working-knowledge/wk-3' } : null
    )
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'save_working_knowledge', arguments: { type: 'research_notebook', title: 'My research', content: 'Findings...' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Saved it privately.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'Save this research', undefined, 'proj-1')

    expect(runSaveWorkingKnowledgeMock).toHaveBeenCalledWith(
      expect.anything(),
      'proj-1',
      'conv-1',
      { type: 'research_notebook', title: 'My research', content: 'Findings...' },
      { providerName: 'groq', modelId: 'openai/gpt-oss-20b' }
    )
    expect(resolveCreatedRecordMock).toHaveBeenCalledWith(expect.anything(), { kind: 'working_knowledge', id: 'wk-3' })
    expect(result.createdRecords).toEqual([{ kind: 'working_knowledge', id: 'wk-3', label: 'My research', href: '/projects/proj-1/working-knowledge/wk-3' }])
  })

  it('catches a runSaveWorkingKnowledge failure and surfaces it as a tool-result error instead of failing the turn', async () => {
    runSaveWorkingKnowledgeMock.mockRejectedValue(new Error('Title is required'))
    generateChatMock
      .mockResolvedValueOnce({
        message: { role: 'assistant', content: '', toolCalls: [{ id: 'call-1', name: 'save_working_knowledge', arguments: { type: 'working_note', title: '', content: 'y' } }] },
        model: 'test-model',
        usage: { inputTokens: 1, outputTokens: 1 },
      })
      .mockResolvedValueOnce({ message: { role: 'assistant', content: 'Could not save that.' }, model: 'test-model', usage: { inputTokens: 1, outputTokens: 1 } })

    const result = await runAssistantTurn(projectBoundCtx(), null, 'Save this note', undefined, 'proj-1')

    expect(result.reply).toBe('Could not save that.')
    const toolAppend = appendMessageMock.mock.calls.find(([, arg]) => arg.toolCallId === 'call-1')
    expect(JSON.parse(toolAppend?.[1].content)).toEqual({ error: 'Title is required' })
  })
})

// Regression guard for src/lib/workbench/assistant-descriptor.ts, which
// imports these instead of restating them -- a change here should be a
// deliberate choice, not a silent drift the descriptor never notices.
describe('exported runtime constants', () => {
  it('keeps MAX_TOOL_ITERATIONS and SEARCH_WIKI_LIMIT at their current values', () => {
    expect(MAX_TOOL_ITERATIONS).toBe(8)
    expect(SEARCH_WIKI_LIMIT).toBe(2)
  })
})
