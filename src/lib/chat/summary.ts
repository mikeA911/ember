import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, ChatMessageRow, ConversationSummary, InformationSensitivity } from '@/types/database'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { getActiveStructuredOutputProvider, withPolicyGate, type ContextManifest } from '@/lib/ai'
import { listMessages } from './conversations'

export const SUMMARY_VERSION = 'v1'

// Mirrors ConversationSummary in src/types/database.ts -- kept as a separate
// zod schema (not derived from the interface) since this is specifically the
// shape asked of the model, not just the stored shape.
const ConversationSummarySchema = z.object({
  objective: z.string(),
  confirmedRequirements: z.array(z.string()),
  decisions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  createdRecords: z.array(z.string()),
  referencedEvidence: z.array(z.string()),
  nextAction: z.string(),
})

// Refresh roughly every 10 turns (the doc's own suggested cadence), or as
// soon as composeWorkingContext has cut turns the summary doesn't cover yet.
// The cut moves in steps (CUT_STEP_TURNS), so a long conversation refreshes
// once per step, not on every turn -- each refresh is a model call, and a
// changed summary changes the start of the next chat prompt, which the
// provider then can't serve from its cache.
const REFRESH_TURN_THRESHOLD = 10

export async function getConversationSummary(
  supabase: SupabaseClient<Database>,
  conversationId: string
): Promise<ConversationSummary | null> {
  const { data, error } = await supabase.from('conversations').select('summary_json').eq('id', conversationId).single()
  if (error || !data) return null
  return data.summary_json
}

function countTurnsSince(rows: ChatMessageRow[], throughMessageId: string | null): number {
  const startIndex = throughMessageId ? rows.findIndex((r) => r.id === throughMessageId) : -1
  const relevant = startIndex >= 0 ? rows.slice(startIndex + 1) : rows
  return relevant.filter((r) => r.role === 'user').length
}

// rows: only the messages since the previous summary when there is one --
// the previous summary already stands for everything before them.
function buildSummaryPrompt(rows: ChatMessageRow[], previous: ConversationSummary | null): string {
  const transcript = rows
    .map((r) => {
      if (r.role === 'assistant' && r.tool_calls && r.tool_calls.length > 0) {
        return `assistant: [requested tools: ${r.tool_calls.map((c) => c.name).join(', ')}]`
      }
      return `${r.role}: ${r.content ?? ''}`
    })
    .join('\n')
  const previousBlock = previous ? `Previous summary:\n${JSON.stringify(previous)}\n\n` : ''
  return (
    `${previousBlock}${previous ? 'Conversation since that summary' : 'Conversation transcript so far'}:\n${transcript}\n\n` +
    'Produce an updated structured summary of this conversation between a user and the Ember Workbench Assistant, ' +
    'as a single JSON object with exactly these fields:\n' +
    '- objective: string, the user\'s overall goal in this conversation\n' +
    '- confirmedRequirements: array of strings, requirements or constraints the user has confirmed\n' +
    '- decisions: array of strings, decisions made and their rationale\n' +
    '- openQuestions: array of strings, questions still unresolved\n' +
    '- createdRecords: array of strings, projects/workstreams/artifacts created (name and kind)\n' +
    '- referencedEvidence: array of strings, Wiki articles or other evidence referenced\n' +
    '- nextAction: string, the agreed or suggested next step\n' +
    'Use an empty array or empty string for any field the transcript does not support -- do not omit fields or invent other field names. ' +
    'Carry forward anything from the previous summary that still holds.'
  )
}

// Builds the FULL retrieval manifest for this conversation by unioning every
// row's retrieved_resources -- not response_payload.citations, which only
// captures what the model chose to cite (a subset of what was actually
// retrieved; see 20260829130001_chat_message_retrieved_resources.sql's own
// comment). buildSummaryPrompt below resends every row's raw content
// regardless of citation status, so the policy check has to cover every row
// too, or it would understate sensitivity for anything retrieved-but-never-
// cited in an earlier turn.
function buildManifest(rows: ChatMessageRow[], projectSensitivity: InformationSensitivity | null | undefined): ContextManifest {
  return {
    entries: rows.flatMap((r) => r.retrieved_resources ?? []),
    projectSensitivity,
  }
}

// Must never block a chat turn -- mirrors embedApprovedVersion's established
// "best-effort, log and move on" pattern in src/lib/wiki/review.ts. Re-fetches
// the persisted rows itself (rather than being passed the in-memory
// ChatMessage[] history) because it needs real row ids for
// summary_through_message_id, which the in-memory chat messages don't carry.
// projectSensitivity comes from the live turn's own already-resolved
// projectContext (loop.ts) -- undefined for a non-project conversation, null
// for a bound-but-unclassified project, matching getEffectiveSensitivity's
// own convention throughout.
export async function maybeRefreshSummary(
  ctx: WorkbenchCallerContext,
  conversationId: string,
  // How many of the conversation's messages, oldest first, the last turn's
  // working context left out (composeWorkingContext). 0 = nothing cut.
  omittedMessageCount: number,
  projectSensitivity?: InformationSensitivity | null,
  // A Live client Project (src/lib/ai/hosting-policy.ts): summarize with a
  // Sandz-hosted model, or not at all -- SelfHostedAIUnavailableError lands
  // in the catch-all below and the refresh is skipped.
  selfHostedOnly = false
): Promise<void> {
  try {
    const { data: conversation, error } = await ctx.supabase
      .from('conversations')
      .select('summary_json, summary_through_message_id')
      .eq('id', conversationId)
      .single()
    if (error || !conversation) return

    const rows = await listMessages(ctx.supabase, conversationId)
    const turnsSince = countTurnsSince(rows, conversation.summary_through_message_id)
    const summarizedThrough = conversation.summary_through_message_id
      ? rows.findIndex((r) => r.id === conversation.summary_through_message_id)
      : -1
    const cutBeyondSummary = omittedMessageCount > 0 && summarizedThrough < omittedMessageCount - 1
    if (turnsSince < REFRESH_TURN_THRESHOLD && !cutBeyondSummary) return
    if (rows.length === 0) return
    // With a previous summary, send only what came after it.
    const previous = summarizedThrough >= 0 ? conversation.summary_json : null
    const rowsToSummarize = previous ? rows.slice(summarizedThrough + 1) : rows

    const provider = await getActiveStructuredOutputProvider(ctx.supabase, { task: 'conversation_summary', requestedBy: ctx.user.id }, { selfHostedOnly })
    // A separately-resolved provider than the live turn's chatProvider --
    // exactly why this needs its own gate rather than trusting the turn's
    // already-passed check (docs/design-notes/ai-policy-enforcement-service-
    // and-context-manifest.md §2.3). A block throws AISensitivityError,
    // caught by this function's own catch-all below -- refresh is skipped,
    // the conversation continues normally, nothing reaches the model.
    const { data: providerRow, error: providerRowError } = await ctx.supabase.from('ai_providers').select('id').eq('name', provider.name).single()
    if (providerRowError || !providerRow) throw providerRowError ?? new Error(`Provider row not found: ${provider.name}`)
    const gatedProvider = withPolicyGate(ctx.supabase, provider, buildManifest(rows, projectSensitivity), { providerId: providerRow.id })

    const { data, model } = await gatedProvider.generateStructured({
      system: 'You maintain a running summary of a Workbench Assistant conversation so it can continue past its context window.',
      prompt: buildSummaryPrompt(rowsToSummarize, previous),
      schema: ConversationSummarySchema,
      maxOutputTokens: 1024,
    })

    const lastMessage = rows[rows.length - 1]
    await ctx.supabase
      .from('conversations')
      .update({
        summary_json: data,
        summary_through_message_id: lastMessage.id,
        summary_updated_at: new Date().toISOString(),
        summary_provider: provider.name,
        summary_model: model,
        summary_version: SUMMARY_VERSION,
      })
      .eq('id', conversationId)
  } catch (err) {
    console.error(`Conversation summary refresh failed for ${conversationId}:`, err)
  }
}
