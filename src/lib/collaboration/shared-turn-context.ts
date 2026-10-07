import type { ChatMessage } from '@/lib/ai'
import type { SharedEvidence } from './types'

// Shared workspace sessions, Phase 3: what Ember sees for one shared-chat
// turn. Pure functions, so the access rules they apply are unit-tested
// (shared-turn-context.test.ts); the database calls are in shared-turn.ts.

// A claimed turn, as collaboration_claim_turn returns it.
export interface ClaimedTurn {
  state: 'claimed'
  turnId: string
  leaseId: string
  conversationId: string
  projectId: string
  sessionId: string
  requestedByName: string
  prompt: { id: string; kind: 'message' | 'comment'; content: string; authorName: string }
  history: { kind: 'message' | 'comment' | 'reply'; authorName: string | null; content: string; evidence: SharedEvidence[] }[]
}

export const OMITTED_REPLY =
  '(An earlier answer is left out here: it drew on sources that not everyone in this conversation can open.)'

export const evidenceKey = (e: Pick<SharedEvidence, 'type' | 'id'>) => `${e.type}:${e.id}`

// Adds items to a list of evidence, once each.
export function mergeEvidence(into: SharedEvidence[], items: SharedEvidence[]): SharedEvidence[] {
  const seen = new Set(into.map(evidenceKey))
  const out = [...into]
  for (const e of items) {
    if (seen.has(evidenceKey(e))) continue
    seen.add(evidenceKey(e))
    out.push({ type: e.type, id: e.id, ...(e.title ? { title: e.title } : {}) })
  }
  return out
}

// Turns the conversation so far into model messages. An earlier reply is
// kept only if every reader can still open everything it drew on (common:
// the keys collaboration_common_evidence returned); otherwise it's replaced
// by a placeholder, so restricted text is never resent. Returns the
// evidence of the replies kept: the new answer may restate them, so it
// carries their evidence too.
export function buildSharedHistory(
  turn: Pick<ClaimedTurn, 'history' | 'prompt' | 'requestedByName'>,
  common: Set<string>
): { messages: ChatMessage[]; carried: SharedEvidence[] } {
  let carried: SharedEvidence[] = []
  const messages: ChatMessage[] = []
  for (const h of turn.history) {
    if (h.kind === 'reply') {
      const usable = h.evidence.every((e) => common.has(evidenceKey(e)))
      if (usable) carried = mergeEvidence(carried, h.evidence)
      messages.push({ role: 'assistant', content: usable ? h.content : OMITTED_REPLY })
    } else {
      messages.push({ role: 'user', content: labelled(h.kind, h.authorName ?? 'Someone', h.content) })
    }
  }
  const prompt =
    turn.prompt.kind === 'comment'
      ? `${labelled('comment', turn.prompt.authorName, turn.prompt.content)}\n\n(${turn.requestedByName} passed this comment on and asked you to respond.)`
      : labelled('message', turn.prompt.authorName, turn.prompt.content)
  messages.push({ role: 'user', content: prompt })
  return { messages, carried }
}

function labelled(kind: 'message' | 'comment', name: string, content: string) {
  return kind === 'comment' ? `[Comment from ${name}, a viewer]\n${content}` : `[${name}]\n${content}`
}

// What collaboration_turn_context returns for a claimed turn.
export interface TurnContext {
  summary: { id: string; uptoOrd: number; content: string; evidence: SharedEvidence[] } | null
  unsummarized: { kind: 'message' | 'comment' | 'reply'; ord: number; authorName: string | null; content: string; evidence: SharedEvidence[] }[]
}

// Write a new summary once this many messages have dropped out of Ember's
// window since the last one.
export const SUMMARIZE_AFTER = 10

// A summary is used only if every reader can still open all it drew on.
export function usableSummary(summary: TurnContext['summary'], common: Set<string>): TurnContext['summary'] {
  return summary && summary.evidence.every((e) => common.has(evidenceKey(e))) ? summary : null
}

// The model input for a new summary: the previous one (when still usable)
// and the messages it doesn't cover, with answers on non-common evidence
// left out. Returns the evidence the new summary is built from.
export function buildSummaryInput(
  context: TurnContext,
  common: Set<string>
): { text: string; evidence: SharedEvidence[]; uptoOrd: number } | null {
  if (context.unsummarized.length === 0) return null
  const previous = usableSummary(context.summary, common)
  let evidence: SharedEvidence[] = previous ? mergeEvidence([], previous.evidence) : []
  const lines: string[] = []
  for (const m of context.unsummarized) {
    if (m.kind === 'reply') {
      const usable = m.evidence.every((e) => common.has(evidenceKey(e)))
      if (usable) evidence = mergeEvidence(evidence, m.evidence)
      lines.push(`Ember: ${usable ? m.content : OMITTED_REPLY}`)
    } else {
      lines.push(labelled(m.kind, m.authorName ?? 'Someone', m.content).replace('\n', ': '))
    }
  }
  const text = [
    previous ? `Summary so far:\n${previous.content}` : 'There is no summary yet.',
    `Messages since then:\n${lines.join('\n\n')}`,
  ].join('\n\n')
  return { text, evidence, uptoOrd: Math.max(...context.unsummarized.map((m) => m.ord)) }
}

export const SUMMARY_SYSTEM_PROMPT = [
  'You keep a running summary of a shared conversation between project members and Ember, an AI assistant.',
  'Rewrite the summary so it also covers the new messages: what was asked, by whom, what Ember answered, and any decisions or open questions.',
  'Use only what is in the summary and messages; add nothing. Leave out anything marked as left out. Do not list project members.',
  'Plain Markdown, at most about 400 words.',
].join(' ')

export function sharedSystemPrompt(input: {
  projectName: string
  goal: string | null
  objective: string | null
  pairNames: string[]
  viewerCount: number
  summary?: string | null
}): string {
  const audience =
    input.viewerCount > 0
      ? `${input.pairNames.join(' and ')} (working together live), and ${input.viewerCount} viewer${input.viewerCount === 1 ? '' : 's'} who read along`
      : `${input.pairNames.join(' and ')}, working together live`
  return [
    'You are Ember, an AI assistant for project work, answering in a shared conversation.',
    `Project: ${input.projectName}.`,
    input.goal ? `Project goal: ${input.goal}` : '',
    input.objective ? `Project description: ${input.objective}` : '',
    `Everyone in this conversation reads every answer: ${audience}. Each message is labelled with who wrote it; answer the latest one, addressing its author by name when it helps.`,
    'You can search this project\'s knowledge with search_project_knowledge. It only returns sources that everyone in the conversation may open, so do not guess at or refer to anything else, and do not repeat details from earlier messages that are marked as left out.',
    'You can list the project\'s workstreams and members. You cannot change anything or send anything yourself. When someone asks you to draft a Project note or new text for the goal, description, starter prompt or a workstream summary, use propose_project_note or propose_field_edit: the proposal appears under your answer and one of them decides whether to use it. Mention that in your answer.',
    'Answer in plain Markdown. When you use a search result, name its title. If the knowledge does not cover the question, say so plainly.',
    input.summary ? `Summary of the earlier part of this conversation:\n${input.summary}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')
}
