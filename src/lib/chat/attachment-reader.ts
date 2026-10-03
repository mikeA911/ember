import 'server-only'
import { parseDocument } from '@/lib/parsing'
import { documentMimeType, isProbablyText, redactSecrets, truncateAttachmentText, type ChatAttachment } from './attachments'

// Turns one uploaded file (or one file inside a zip) into a chat
// attachment: PDF/Word through their extractors, anything else only if its
// bytes are genuinely text. Secrets are hidden before the text goes
// anywhere. Shared by extractChatAttachmentAction and zip-attachments.ts.

export class AttachmentReadError extends Error {}

export async function readAttachmentFile(name: string, bytes: Buffer): Promise<ChatAttachment> {
  const documentMime = documentMimeType(name)
  let raw: string
  if (documentMime) {
    try {
      const parsed = await parseDocument(bytes, documentMime)
      raw = parsed.pages.map((p) => p.text).join('\n\n')
    } catch {
      throw new AttachmentReadError("couldn't be read")
    }
  } else if (isProbablyText(bytes)) {
    raw = bytes.toString('utf-8').replace(/^\uFEFF/, '')
  } else {
    throw new AttachmentReadError("isn't a text file (images and other binary files can't be attached)")
  }

  const { text: safe, hidden } = redactSecrets(name, raw)
  const { text, truncated } = truncateAttachmentText(safe)
  if (!text) throw new AttachmentReadError('has no readable text')
  return { name, text, truncated, ...(hidden > 0 ? { hiddenSecrets: hidden } : {}) }
}
