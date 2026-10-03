// "Attach file" in the Ember composer (ChatSession). The file is parsed
// server-side (extractChatAttachmentAction) and its text is folded into the
// outgoing message itself -- no new storage or conversation schema, so the
// attachment is persisted, replayed and shown in History exactly like any
// other turn. Curated, retrievable knowledge still goes through Sources &
// Curation (/upload); this is only "let Ember read this file right now".

// Under next.config's 6MB serverActions.bodySizeLimit, same headroom
// reasoning as the branding icon cap.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024
// Keeps a single attachment from swamping the model's context window --
// roughly 12k tokens, room for a modest ontology or a long document.
export const MAX_ATTACHMENT_CHARS = 50_000
// All attachments on one message together (several picked files, or the
// files inside a zip) -- about 25k tokens, which every later turn of the
// conversation also carries.
export const MAX_TOTAL_ATTACHMENT_CHARS = 100_000

// Anything that is genuinely text can be attached -- notes, Markdown,
// source code, config, .env, ontologies, files with no extension at all --
// decided from the file's bytes (isProbablyText), not a list of extensions:
// a fixed list kept missing real cases, and iPad Safari's file picker
// greys out extensions it doesn't recognise when given an accept= list.
// PDF and Word have real extractors (parseDocument); a zip is unpacked
// (zip-attachments.ts). Images and other binaries are refused.
export const ATTACHMENT_TYPES_LABEL = 'any text or code file (md, txt, csv, json, ttl, .env, …), pdf, docx, or a zip of them'

const DOCUMENT_MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

// PDF/Word need parseDocument's extractor; everything else is read as text.
export function documentMimeType(fileName: string): string | null {
  const ext = fileName.toLowerCase().split('.').pop() ?? ''
  return DOCUMENT_MIME_BY_EXTENSION[ext] ?? null
}

export function isZipFileName(fileName: string): boolean {
  return fileName.toLowerCase().endsWith('.zip')
}

// Valid UTF-8 with (almost) no control characters other than tab/newline/
// carriage return/form feed. Catches images, executables, archives, and
// UTF-16 files, which would otherwise arrive as mojibake.
export function isProbablyText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return false
  let control = 0
  for (const b of bytes) {
    if (b === 0) return false
    if (b < 0x20 && b !== 0x09 && b !== 0x0a && b !== 0x0d && b !== 0x0c && b !== 0x1b) control++
  }
  if (control / bytes.length > 0.01) return false
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return true
  } catch {
    return false
  }
}

// --- Secrets --------------------------------------------------------------
// Attachments are sent to the AI provider and stored in the conversation,
// so obvious secrets are hidden before that: in .env-style files, the
// values of secret-looking keys (names stay, so the config can still be
// discussed); in any file, private-key blocks and well-known token formats.

export const REDACTED = '[hidden by Ember]'

const SECRET_KEY_NAME = /(key|token|secret|passw(or)?d|pwd|credential|private|auth|session|cookie|signature|salt|dsn|connection_string)/i
const ENV_FILE_NAME = /(^|\/)\.env($|\.)|\.env$|(^|\/)\.envrc$/i
const ENV_LINE = /^(\s*(?:export\s+)?)([A-Za-z_][A-Za-z0-9_.-]*)(\s*[=:]\s*)(.*)$/
const PRIVATE_KEY_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g
const TOKEN_PATTERNS = [
  /\bsk-(?:proj-|ant-)?[A-Za-z0-9_-]{20,}/g, // OpenAI / Anthropic
  /\bgh[pousr]_[A-Za-z0-9]{30,}/g, // GitHub
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key id
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API key
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT
]
// The password in scheme://user:password@host (database URLs and the like).
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi

export function redactSecrets(fileName: string, text: string): { text: string; hidden: number } {
  let hidden = 0
  let out = text.replace(PRIVATE_KEY_BLOCK, () => {
    hidden++
    return `-----PRIVATE KEY ${REDACTED}-----`
  })
  for (const pattern of TOKEN_PATTERNS) {
    out = out.replace(pattern, () => {
      hidden++
      return REDACTED
    })
  }
  out = out.replace(URL_PASSWORD, (_m, before: string, _password: string, at: string) => {
    hidden++
    return `${before}${REDACTED}${at}`
  })
  if (ENV_FILE_NAME.test(fileName)) {
    out = out
      .split('\n')
      .map((line) => {
        const m = line.match(ENV_LINE)
        if (!m || line.trimStart().startsWith('#')) return line
        const [, lead, key, sep, value] = m
        if (!value.trim() || value.includes(REDACTED) || !SECRET_KEY_NAME.test(key)) return line
        hidden++
        return `${lead}${key}${sep}${REDACTED}`
      })
      .join('\n')
  }
  return { text: out, hidden }
}

export interface ChatAttachment {
  name: string
  text: string
  truncated: boolean
  // How many secrets redactSecrets hid -- shown next to the attachment.
  hiddenSecrets?: number
}

export function truncateAttachmentText(text: string): { text: string; truncated: boolean } {
  const trimmed = text.trim()
  if (trimmed.length <= MAX_ATTACHMENT_CHARS) return { text: trimmed, truncated: false }
  return { text: trimmed.slice(0, MAX_ATTACHMENT_CHARS), truncated: true }
}

// A tilde fence longer than any tilde run inside the text, so file content
// can never close the block early.
export function formatMessageWithAttachments(message: string, attachments: ChatAttachment[]): string {
  return attachments.reduce((text, attachment) => formatMessageWithAttachment(text, attachment), message)
}

export function totalAttachmentChars(attachments: ChatAttachment[]): number {
  return attachments.reduce((sum, a) => sum + a.text.length, 0)
}

export function formatMessageWithAttachment(message: string, attachment: ChatAttachment): string {
  const longestRun = Math.max(0, ...(attachment.text.match(/~+/g) ?? []).map((run) => run.length))
  const fence = '~'.repeat(Math.max(3, longestRun + 1))
  const note = attachment.truncated ? ` (first ${MAX_ATTACHMENT_CHARS.toLocaleString('en-US')} characters)` : ''
  const header = `Attached file: ${attachment.name}${note}`
  const body = `${header}\n\n${fence}\n${attachment.text}\n${fence}`
  return message ? `${message}\n\n${body}` : body
}

// The inverse of formatMessageWithAttachment, for tools that need the file
// itself rather than the model's retelling of it (ontology-file-import-
// tool.ts): the header line, then a tilde fence longer than any tilde run
// inside, so the first matching closing fence ends the file.
export function extractAttachmentsFromMessage(message: string): ChatAttachment[] {
  const found: ChatAttachment[] = []
  const pattern = /^Attached file: (.+?)( \(first [\d,]+ characters\))?\n\n(~{3,})\n([\s\S]*?)\n\3$/gm
  for (const match of message.matchAll(pattern)) {
    found.push({ name: match[1], truncated: Boolean(match[2]), text: match[4] })
  }
  return found
}

// --- Saving an attachment as a workstream Findings artifact ----------------
// Artifact content renders as Markdown: prose files go in as-is; anything
// else (code, config, data, ontologies) as a fenced code block so `#`
// comments and indentation survive.

const PROSE_EXTENSIONS = new Set(['md', 'markdown', 'mdx', 'txt', 'text', 'pdf', 'docx'])
const FENCE_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript', cjs: 'javascript', py: 'python', rb: 'ruby',
  go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', cs: 'csharp', php: 'php', swift: 'swift', sh: 'bash', bash: 'bash', zsh: 'bash',
  sql: 'sql', json: 'json', jsonld: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', html: 'html', css: 'css',
  ttl: 'turtle', n3: 'turtle', nt: 'turtle', owl: 'xml', rdf: 'xml', csv: 'csv', env: 'bash', ini: 'ini', dockerfile: 'dockerfile',
}

function extensionOf(fileName: string): string {
  const base = fileName.split('/').pop()!.toLowerCase()
  if (base === 'dockerfile') return 'dockerfile'
  if (/^\.env(\..*)?$/.test(base)) return 'env'
  return base.includes('.') ? base.split('.').pop()! : ''
}

export function findingsContentForAttachment(attachment: ChatAttachment): string {
  const ext = extensionOf(attachment.name)
  if (PROSE_EXTENSIONS.has(ext)) return attachment.text
  const longestRun = Math.max(0, ...(attachment.text.match(/`+/g) ?? []).map((run) => run.length))
  const fence = '`'.repeat(Math.max(3, longestRun + 1))
  return `${fence}${FENCE_LANGUAGE[ext] ?? ''}\n${attachment.text}\n${fence}`
}

export function findingsNotesForAttachment(attachment: ChatAttachment): string {
  const parts = ['Uploaded in Ember chat.']
  if (attachment.truncated) parts.push(`Only the first ${MAX_ATTACHMENT_CHARS.toLocaleString('en-US')} characters were kept.`)
  if (attachment.hiddenSecrets) parts.push(`${attachment.hiddenSecrets} secret value(s) were hidden before saving.`)
  return parts.join(' ')
}

// Shown in the user's own message so Ember (and anyone reading History)
// knows the files already exist as artifacts.
export function savedAsFindingsNote(count: number, workstreamName: string): string {
  return `(${count === 1 ? 'This attached file was' : `These ${count} attached files were`} saved as Findings in the "${workstreamName}" workstream.)`
}
