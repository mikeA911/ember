import 'server-only'
import type { ChatMessage } from '@/lib/ai'
import type { ConversationSummary } from '@/types/database'

// Exact tokenization is provider-specific; this is a documented, conservative,
// provider-agnostic approximation (the onboarding/history doc explicitly
// allows "computed or conservatively estimated" counts).
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

function estimateMessageTokens(msg: ChatMessage): number {
  let tokens = estimateTokens(msg.content ?? '')
  if (msg.toolCalls) {
    for (const call of msg.toolCalls) tokens += estimateTokens(call.name) + estimateTokens(JSON.stringify(call.arguments))
  }
  return tokens
}

// Groups history into turns: one user message through the next user message,
// inclusive of every assistant/tool round-trip in between. Windowing at turn
// granularity (not per-message) is what guarantees a tool-call/tool-result
// pair is never split without extra bookkeeping -- they always land in the
// same turn as the user message that triggered them.
function groupIntoTurns(history: ChatMessage[]): ChatMessage[][] {
  const turns: ChatMessage[][] = []
  for (const msg of history) {
    if (msg.role === 'user' || turns.length === 0) {
      turns.push([msg])
    } else {
      turns[turns.length - 1].push(msg)
    }
  }
  return turns
}

// The middle of the doc's suggested 12k-24k budget range, used whenever the
// model's own context_window isn't known. TOOL_SCHEMA_OVERHEAD is a rough
// reservation for the tool specs sent alongside messages on every call.
const DEFAULT_BUDGET = 18000
const TOOL_SCHEMA_OVERHEAD = 1500
const MIN_BUDGET = 2000

function computeBudget(contextWindow: number | null | undefined, maxOutputTokens: number | null | undefined): number {
  if (!contextWindow) return DEFAULT_BUDGET
  const reserved = (maxOutputTokens ?? 2048) + TOOL_SCHEMA_OVERHEAD
  return Math.min(DEFAULT_BUDGET, Math.max(MIN_BUDGET, contextWindow - reserved))
}

function formatSummary(summary: ConversationSummary): string {
  const lines = [`Objective: ${summary.objective}`]
  if (summary.confirmedRequirements.length) lines.push(`Confirmed requirements: ${summary.confirmedRequirements.join('; ')}`)
  if (summary.decisions.length) lines.push(`Decisions: ${summary.decisions.join('; ')}`)
  if (summary.openQuestions.length) lines.push(`Open questions: ${summary.openQuestions.join('; ')}`)
  if (summary.createdRecords.length) lines.push(`Created records: ${summary.createdRecords.join('; ')}`)
  if (summary.referencedEvidence.length) lines.push(`Referenced evidence: ${summary.referencedEvidence.join('; ')}`)
  lines.push(`Next action: ${summary.nextAction}`)
  return lines.join('\n')
}

export interface WorkingContextInput {
  history: ChatMessage[]
  summary: ConversationSummary | null
  contextWindow?: number | null
  maxOutputTokens?: number | null
}

export interface WorkingContextResult {
  messages: ChatMessage[]
  wasTruncated: boolean
  // How many history messages, oldest first, were cut (0 when none).
  omittedMessageCount: number
  summaryIncluded: boolean
}

// Once history is over budget, the cut moves forward in steps of this many
// turns rather than one turn at a time. A cut that moved every turn would
// change the start of the history on every call, so the provider's prompt
// cache could only ever reuse the system prompt and tools; a cut that holds
// for several turns keeps the whole kept history cacheable meanwhile.
export const CUT_STEP_TURNS = 4

// Bounds what actually gets sent to the provider on a turn -- the caller's
// own persisted `history` array is untouched; this only shapes the payload.
// Always keeps the newest turn regardless of budget (a turn in progress must
// never be cut mid-tool-call), then keeps as many older turns as fit, with
// the cut rounded forward to a multiple of CUT_STEP_TURNS. Stateless: the
// same history always gives the same cut. Turns that are cut are replaced
// by the rolling summary (if one exists) rather than silently vanishing.
export function composeWorkingContext({ history, summary, contextWindow, maxOutputTokens }: WorkingContextInput): WorkingContextResult {
  const turns = groupIntoTurns(history)
  if (turns.length === 0) return { messages: [], wasTruncated: false, omittedMessageCount: 0, summaryIncluded: false }

  const budget = computeBudget(contextWindow, maxOutputTokens)
  const newest = turns.length - 1
  // The earliest turn that still fits, walking back from the newest.
  let firstFitting = newest
  let used = turns[newest].reduce((sum, m) => sum + estimateMessageTokens(m), 0)
  for (let i = newest - 1; i >= 0; i--) {
    const turnTokens = turns[i].reduce((sum, m) => sum + estimateMessageTokens(m), 0)
    if (used + turnTokens > budget) break
    used += turnTokens
    firstFitting = i
  }

  const wasTruncated = firstFitting > 0
  const start = wasTruncated ? Math.min(Math.ceil(firstFitting / CUT_STEP_TURNS) * CUT_STEP_TURNS, newest) : 0
  const messages = turns.slice(start).flat()
  const omittedMessageCount = history.length - messages.length
  if (wasTruncated && summary) {
    const summaryMessage: ChatMessage = {
      role: 'user',
      content: `[Context note -- earlier turns omitted for length. Conversation summary so far:]\n${formatSummary(summary)}`,
    }
    return { messages: [summaryMessage, ...messages], wasTruncated, omittedMessageCount, summaryIncluded: true }
  }

  return { messages, wasTruncated, omittedMessageCount, summaryIncluded: false }
}
