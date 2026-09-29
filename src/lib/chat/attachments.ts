// "Attach file" in the Ember composer (ChatSession). The file is parsed
// server-side (extractChatAttachmentAction) and its text is folded into the
// outgoing message itself -- no new storage or conversation schema, so the
// attachment is persisted, replayed and shown in History exactly like any
// other turn. Curated, retrievable knowledge still goes through Sources &
// Curation (/upload); this is only "let Ember read this file right now".

// Under next.config's 6MB serverActions.bodySizeLimit, same headroom
// reasoning as the branding icon cap.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
// Keeps a single attachment from swamping the model's context window.
export const MAX_ATTACHMENT_CHARS = 20_000
export const ATTACHMENT_ACCEPT = '.pdf,.docx,.txt,.md,.csv'

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/plain',
  csv: 'text/plain',
}

// Browsers report '' or inconsistent types for .md/.csv, so the extension
// decides -- mapped onto the three MIME types parseDocument understands.
export function attachmentMimeType(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return MIME_BY_EXTENSION[ext] ?? null
}

export interface ChatAttachment {
  name: string
  text: string
  truncated: boolean
}

export function truncateAttachmentText(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_ATTACHMENT_CHARS) return { text: trimmed, truncated: false }
  return { text: trimmed.slice(0, MAX_ATTACHMENT_CHARS), truncated: true }
}

// A tilde fence longer than any tilde run inside the text, so file content
// can never close the block early.
export function formatMessageWithAttachment(message: string, attachment: ChatAttachment): string {
  const longestRun = Math.max(0, ...(attachment.text.match(/~+/g) ?? []).map((run) => run.length))
  const fence = '~'.repeat(Math.max(3, longestRun + 1))
  const note = attachment.truncated ? ` (first ${MAX_ATTACHMENT_CHARS.toLocaleString('en-US')} characters)` : ''
  const header = `Attached file: ${attachment.name}${note}`
  const body = `${header}\n\n${fence}\n${attachment.text}\n${fence}`
  return message ? `${message}\n\n${body}` : body
}
