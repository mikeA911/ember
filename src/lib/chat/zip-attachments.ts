import 'server-only'
import JSZip from 'jszip'
import { parseDocument } from '@/lib/parsing'
import { attachmentMimeType, truncateAttachmentText, type ChatAttachment } from './attachments'

// Ember's Attach button, .zip case: each supported file inside becomes its
// own attachment (so e.g. the ontology importer still finds
// "community-power-ontology.ttl" by name). Folders, hidden/OS metadata
// files, nested zips and unsupported types are skipped and reported.

export const MAX_ZIP_ENTRIES = 20
// Per entry, uncompressed -- a guard against zip bombs (a small archive
// that expands to gigabytes), checked from the zip's own directory before
// anything is decompressed.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024

export class ZipAttachmentError extends Error {}

function isHiddenOrMetadata(path: string): boolean {
  return path.split('/').some((part) => part.startsWith('.') || part === '__MACOSX')
}

export async function readZipAttachments(buffer: Buffer): Promise<{ attachments: ChatAttachment[]; skipped: string[] }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ZipAttachmentError("That zip file couldn't be opened")
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir && !isHiddenOrMetadata(f.name))
  const supported = entries.filter((f) => attachmentMimeType(f.name))
  const skipped = entries.filter((f) => !attachmentMimeType(f.name)).map((f) => f.name)

  if (supported.length === 0) {
    throw new ZipAttachmentError('No supported files in that zip (nested zips are not opened)')
  }
  if (supported.length > MAX_ZIP_ENTRIES) {
    throw new ZipAttachmentError(`That zip has ${supported.length} supported files -- attach at most ${MAX_ZIP_ENTRIES} at a time`)
  }

  const attachments: ChatAttachment[] = []
  for (const entry of supported.sort((a, b) => a.name.localeCompare(b.name))) {
    // JSZip's directory record; not in its public types.
    const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (uncompressed === undefined || uncompressed > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      skipped.push(`${entry.name} (too large)`)
      continue
    }
    try {
      const parsed = await parseDocument(await entry.async('nodebuffer'), attachmentMimeType(entry.name)!)
      const { text, truncated } = truncateAttachmentText(parsed.pages.map((p) => p.text).join('\n\n'))
      if (text) attachments.push({ name: entry.name, text, truncated })
      else skipped.push(`${entry.name} (no readable text)`)
    } catch {
      skipped.push(`${entry.name} (couldn't be read)`)
    }
  }
  if (attachments.length === 0) throw new ZipAttachmentError("None of the files in that zip could be read")
  return { attachments, skipped }
}
