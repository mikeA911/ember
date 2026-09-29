import type { ChatMessageRow } from '@/types/database'

// "Save as note" in the Ember header (ChatSession) -- turns a conversation's
// persisted rows into the Markdown body of a Working Knowledge working_note.
// Only the visible user/assistant turns: tool calls/results are internal
// plumbing, and an assistant row that only requested tools has no content.
export function conversationToTranscript(rows: Pick<ChatMessageRow, 'role' | 'content'>[]): string {
  return rows
    .filter((r) => (r.role === 'user' || r.role === 'assistant') && r.content?.trim())
    .map((r) => `**${r.role === 'user' ? 'You' : 'Ember'}:**\n\n${r.content!.trim()}`)
    .join('\n\n---\n\n')
}

const MAX_TITLE_CHARS = 80

// Default note title: the conversation's own title if it has one, else the
// opening question -- trimmed to one line.
export function defaultNoteTitle(conversationTitle: string | null | undefined, firstUserMessage: string | undefined): string {
  const source = conversationTitle?.trim() || firstUserMessage?.trim().split('\n')[0]?.trim() || 'Ember conversation'
  return source.length > MAX_TITLE_CHARS ? `${source.slice(0, MAX_TITLE_CHARS - 1)}…` : source
}
