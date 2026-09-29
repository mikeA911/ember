import type { ChatMessageRow } from '@/types/database'

// "Save as note" in the Ember header (ChatSession) -- turns a conversation's
// persisted rows into the Markdown body of a Working Knowledge working_note.
// Only the visible user/assistant turns: tool calls/results are internal
// plumbing, and an assistant row that only requested tools has no content.
type TranscriptRow = Pick<ChatMessageRow, 'role' | 'content'>

export function isTranscriptRow<T extends TranscriptRow>(row: T): row is T & { role: 'user' | 'assistant'; content: string } {
  return (row.role === 'user' || row.role === 'assistant') && Boolean(row.content?.trim())
}

export function conversationToTranscript(rows: TranscriptRow[]): string {
  return rows
    .filter(isTranscriptRow)
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

const MAX_PREVIEW_CHARS = 140

// One-line snippet for the "Save as note" message picker.
export function messagePreview(content: string): string {
  const oneLine = content.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_PREVIEW_CHARS ? `${oneLine.slice(0, MAX_PREVIEW_CHARS - 1)}…` : oneLine
}
