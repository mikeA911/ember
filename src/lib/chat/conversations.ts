import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Conversation, ChatMessageRow, ChatMessageRole } from '@/types/database'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { PersistedAssistantEnvelopeSchema, type PersistedAssistantEnvelope, type VerifiedAssistantEnvelope } from './response-envelope'
import { resolveEnvelopeForDisplay } from './envelope-resolution'
import { extractCreatedRecordRef, resolveCreatedRecord, type CreatedRecordRef, type ResolvedCreatedRecord } from './created-records'
import { GATEWAY_TOOL_PREFIX } from '@/lib/mcp-gateway/discovery'
import { SEARCH_WEB_TOOL_NAME } from './web-search-tool'
import { resolvePendingInvocation, type PendingGatewayInvocation } from '@/lib/mcp-gateway/execute'

// projectId binds this conversation to a project at creation time. Only ever
// set once -- see the immutability trigger in
// 20260824190001_conversations_project_binding.sql -- "changing project
// context" means starting a new conversation, not re-pointing this one.
export async function createConversation(
  supabase: SupabaseClient<Database>,
  userId: string,
  title?: string,
  projectId?: string | null,
  kind?: 'chat' | 'feedback'
): Promise<Conversation> {
  const { data, error } = await supabase
    .from('conversations')
    .insert({ user_id: userId, title: title ?? null, project_id: projectId ?? null, kind: kind ?? 'chat' })
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Failed to create conversation')
  return data
}

// An empty result IS the first-use signal the onboarding UI checks for --
// no separate "is this a new user" boolean needed. projectId omitted means
// "all of this user's conversations" (today's behavior, the global
// ChatPanel's history list); projectId: null explicitly means "general
// (unbound) conversations only"; a project id filters to that project's
// conversations only (the project page's own history list).
export async function listRecentConversations(
  supabase: SupabaseClient<Database>,
  userId: string,
  opts: { projectId?: string | null; limit?: number } = {}
): Promise<Conversation[]> {
  let query = supabase
    .from('conversations')
    .select('*')
    .eq('user_id', userId)
    // Feedback-intake conversations are never resumed and never shown in
    // the normal History list -- see conversations.kind's own comment.
    .eq('kind', 'chat')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(opts.limit ?? 10)
  if (opts.projectId !== undefined) {
    query = opts.projectId === null ? query.is('project_id', null) : query.eq('project_id', opts.projectId)
  }
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

export interface DisplayMessage {
  role: 'user' | 'assistant'
  content: string
  providerDisplayName?: string
  modelDisplayName?: string
  toolsUsed?: string[]
  // Queries sent to Tavily while producing this reply -- see loop.ts's
  // AssistantTurnResult.webSearchQueries.
  webSearchQueries?: string[]
  structured?: VerifiedAssistantEnvelope
  createdRecords?: ResolvedCreatedRecord[]
  pendingGatewayInvocations?: PendingGatewayInvocation[]
}

// Turns persisted rows back into the same shape ChatPanel renders live.
// Display-name resolution is passed in as a lookup rather than queried here
// (kept from the original design). No longer pure/synchronous -- a
// structured response_payload's links/documents/citations and any
// tool-created records must be re-resolved against the current user's
// access every time history is read (routes/labels are never cached; see
// response-envelope.ts's comments), which requires ctx and real queries. A
// provider/model no longer in the lookup falls back to the raw identifier
// stored on the row -- provenance is never silently dropped.
export async function toDisplayMessages(
  rows: ChatMessageRow[],
  displayNameByKey: Map<string, { providerDisplayName: string; modelDisplayName: string }>,
  ctx: WorkbenchCallerContext
): Promise<DisplayMessage[]> {
  const out: DisplayMessage[] = []
  let pendingTools = new Set<string>()
  let pendingCreatedRefs: CreatedRecordRef[] = []
  let pendingInvocationIds: string[] = []
  let pendingWebQueries: string[] = []

  for (const row of rows) {
    if (row.role === 'user') {
      out.push({ role: 'user', content: row.content ?? '' })
      continue
    }

    if (row.role === 'tool') {
      if (row.tool_name && row.content) {
        pendingCreatedRefs.push(...extractCreatedRecordRef(row.tool_name, row.content))
        if (row.tool_name === SEARCH_WEB_TOOL_NAME) {
          const query = sentWebSearchQuery(row.content)
          if (query) pendingWebQueries.push(query)
        }
        if (row.tool_name.startsWith(GATEWAY_TOOL_PREFIX)) {
          try {
            const parsed = JSON.parse(row.content) as { status?: string; invocationId?: string }
            if (parsed.status === 'awaiting_human_confirmation' && parsed.invocationId) pendingInvocationIds.push(parsed.invocationId)
          } catch {
            // Not JSON, or not this shape -- not a pending Gateway action.
          }
        }
      }
      continue
    }

    // An assistant row carrying tool_calls is an intermediate step, never
    // the final reply (runAssistantTurn only stops the loop once a reply
    // has no tool calls, or the model calls present_assistant_response) --
    // fold its tool names into the next real reply.
    if (row.tool_calls && row.tool_calls.length > 0) {
      for (const call of row.tool_calls) pendingTools.add(call.name)
      continue
    }

    const key = row.provider && row.model ? `${row.provider}::${row.model}` : null
    const names = key ? displayNameByKey.get(key) : undefined

    let structured: VerifiedAssistantEnvelope | undefined
    if (row.response_payload) {
      const parsed = PersistedAssistantEnvelopeSchema.safeParse(row.response_payload)
      // A row from before this feature, or a future incompatible schema
      // version, fails closed to "no structured payload" -- the plain
      // content above still renders.
      if (parsed.success) structured = await resolveEnvelopeForDisplay(ctx, parsed.data as PersistedAssistantEnvelope)
    }

    const resolvedCreatedRecords = (await Promise.all(pendingCreatedRefs.map((ref) => resolveCreatedRecord(ctx, ref)))).filter(
      (r): r is ResolvedCreatedRecord => r !== null
    )
    const resolvedPendingInvocations = (await Promise.all(pendingInvocationIds.map((id) => resolvePendingInvocation(ctx, id)))).filter(
      (r): r is PendingGatewayInvocation => r !== null
    )

    out.push({
      role: 'assistant',
      content: row.content ?? '',
      providerDisplayName: names?.providerDisplayName ?? row.provider ?? undefined,
      modelDisplayName: names?.modelDisplayName ?? row.model ?? undefined,
      toolsUsed: pendingTools.size > 0 ? [...pendingTools] : undefined,
      webSearchQueries: pendingWebQueries.length > 0 ? pendingWebQueries : undefined,
      structured,
      createdRecords: resolvedCreatedRecords.length > 0 ? resolvedCreatedRecords : undefined,
      pendingGatewayInvocations: resolvedPendingInvocations.length > 0 ? resolvedPendingInvocations : undefined,
    })
    pendingTools = new Set()
    pendingCreatedRefs = []
    pendingInvocationIds = []
    pendingWebQueries = []
  }

  return out
}

// A search_web tool result records `query` only when the request actually
// went to Tavily (success, or a failure after sending) -- refused calls and
// invalid input carry no query. Results persisted before queries were
// recorded have none either, so older conversations simply show nothing.
function sentWebSearchQuery(content: string): string | null {
  try {
    const parsed = JSON.parse(content) as { query?: unknown }
    return typeof parsed.query === 'string' && parsed.query.trim() ? parsed.query : null
  } catch {
    return null
  }
}

export async function listMessages(supabase: SupabaseClient<Database>, conversationId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data ?? []
}

export async function appendMessage(
  supabase: SupabaseClient<Database>,
  input: {
    conversationId: string
    userId: string
    role: ChatMessageRole
    content: string | null
    toolCalls?: { id: string; name: string; arguments: Record<string, unknown> }[] | null
    toolCallId?: string | null
    toolName?: string | null
    provider?: string | null
    model?: string | null
    responsePayload?: PersistedAssistantEnvelope | null
    retrievedResources?: { resourceType: 'wiki_article' | 'knowledge_source'; resourceId: string }[] | null
  }
): Promise<ChatMessageRow> {
  const { data, error } = await supabase
    .from('chat_messages')
    .insert({
      conversation_id: input.conversationId,
      user_id: input.userId,
      role: input.role,
      content: input.content,
      tool_calls: input.toolCalls ?? null,
      tool_call_id: input.toolCallId ?? null,
      tool_name: input.toolName ?? null,
      provider: input.provider ?? null,
      model: input.model ?? null,
      response_payload: (input.responsePayload ?? null) as Record<string, unknown> | null,
      retrieved_resources: input.retrievedResources ?? null,
    })
    .select()
    .single()
  if (error || !data) throw error ?? new Error('Failed to save chat message')
  return data
}

// M6E: a real (not simulated) activity indicator for the Assistant UI --
// reads whatever the tool-calling loop has most recently persisted for this
// conversation and maps it to a short human-readable phrase. Genuinely
// reflects progress since appendMessage writes happen synchronously as the
// loop advances; this is a poll target, not a push -- streaming stays
// explicitly out of scope (design note §17).
const TOOL_ACTIVITY_LABELS: Record<string, string> = {
  search_wiki: 'Searching the Workbench Handbook & Wiki…',
  list_project_notes: 'Checking project notes…',
  create_project: 'Setting up the project…',
  approve_project: 'Approving the project…',
  create_workstream: 'Creating the workstream…',
  attach_workstream_artifact: 'Attaching the artifact…',
  search_my_working_knowledge: 'Checking your Working Knowledge…',
  search_shared_working_knowledge: 'Checking shared Working Knowledge…',
  save_working_knowledge: 'Saving to Working Knowledge…',
}

export async function getLatestActivityLabel(supabase: SupabaseClient<Database>, conversationId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('role, tool_calls, tool_name')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return null

  if (data.role === 'assistant' && data.tool_calls && data.tool_calls.length > 0) {
    return TOOL_ACTIVITY_LABELS[data.tool_calls[0].name] ?? null
  }
  if (data.role === 'tool' && data.tool_name) {
    return TOOL_ACTIVITY_LABELS[data.tool_name] ? 'Reviewing results…' : null
  }
  return null
}
