// Thinking aloud (docs/design-notes/ember-sli-calm-workspace.md §4): the
// transcript of a few minutes' free speech, sent as one user message that
// starts with this marker. Ember organises it into notes (SYSTEM_PROMPT in
// loop.ts); the chat shows it folded, not as a wall of text.

export const THINKING_ALOUD_MAX_SECONDS = 600

const MARKER = /^\[Thinking aloud · (\d+:\d{2})\]\n/

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function thinkingAloudMessage(transcript: string, seconds: number): string {
  return `[Thinking aloud · ${formatClock(seconds)}]\n${transcript.trim()}`
}

export function parseThinkingAloud(content: string): { duration: string; transcript: string } | null {
  const m = MARKER.exec(content)
  return m ? { duration: m[1], transcript: content.slice(m[0].length) } : null
}
