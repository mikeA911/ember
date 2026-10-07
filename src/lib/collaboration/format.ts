import type { SharedChatMessage, SharedTextFieldName } from './types'

// "12 min", "1 h 5 min" -- how long someone has been inactive.
export function minutesLabel(seconds: number): string {
  const minutes = Math.max(1, Math.floor(seconds / 60))
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`
}

// The shared chat in reading order: each Ember answer directly under the
// question or comment it answers (the server keeps arrival order, and an
// answer can arrive after later questions).
export function orderForDisplay(messages: SharedChatMessage[]): SharedChatMessage[] {
  const seqOf = new Map(messages.map((m) => [m.id, m.seq]))
  const key = (m: SharedChatMessage) => (m.kind === 'reply' && m.promptId && seqOf.has(m.promptId) ? seqOf.get(m.promptId)! + 0.5 : m.seq)
  return [...messages].sort((a, b) => key(a) - key(b) || a.seq - b.seq)
}

export const FIELD_LABELS: Record<SharedTextFieldName, string> = {
  project_goal: 'Goal',
  project_objective: 'Description',
  project_starter_prompt: 'Starter prompt',
  workstream_summary: 'Summary',
}
