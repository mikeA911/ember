import 'server-only'
import JSZip from 'jszip'
import { isZipFileName, type ChatAttachment } from './attachments'
import { readAttachmentFile, AttachmentReadError } from './attachment-reader'

// Ember's Attach button, .zip case: each readable file inside becomes its
// own attachment (so e.g. the ontology importer still finds
// "community-power-ontology.ttl" by name), read exactly like a file
// attached on its own (attachment-reader.ts). OS/tool clutter is ignored;
// nested zips and binary files are skipped and reported.

export const MAX_ZIP_ENTRIES = 20
// More files than this and it's a repo dump, not a set of attachments.
const MAX_ZIP_CANDIDATES = 200
// Guards against zip bombs (a small archive that expands to gigabytes),
// checked from the zip's own directory before anything is decompressed.
const MAX_ENTRY_UNCOMPRESSED_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_UNCOMPRESSED_BYTES = 50 * 1024 * 1024

export class ZipAttachmentError extends Error {}

// Not hidden files in general -- a .env or .gitignore is exactly what a
// developer might mean to attach -- only OS metadata and tool directories.
function isClutter(path: string): boolean {
  const parts = path.split('/')
  const file = parts[parts.length - 1]
  return (
    parts.some((p) => p === '__MACOSX' || p === '.git' || p === 'node_modules') || file === '.DS_Store' || file.startsWith('._')
  )
}

export async function readZipAttachments(buffer: Buffer): Promise<{ attachments: ChatAttachment[]; skipped: string[] }> {
  let zip: JSZip
  try {
    zip = await JSZip.loadAsync(buffer)
  } catch {
    throw new ZipAttachmentError("That zip file couldn't be opened")
  }

  const candidates = Object.values(zip.files)
    .filter((f) => !f.dir && !isClutter(f.name))
    .sort((a, b) => a.name.localeCompare(b.name))
  if (candidates.length === 0) throw new ZipAttachmentError('That zip is empty')
  if (candidates.length > MAX_ZIP_CANDIDATES) {
    throw new ZipAttachmentError(`That zip has ${candidates.length} files -- zip just the files you want Ember to read (at most ${MAX_ZIP_ENTRIES})`)
  }

  const attachments: ChatAttachment[] = []
  const skipped: string[] = []
  let totalBytes = 0
  for (const entry of candidates) {
    if (isZipFileName(entry.name)) {
      skipped.push(`${entry.name} (zip inside a zip)`)
      continue
    }
    // JSZip's directory record; not in its public types.
    const uncompressed = (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
    if (uncompressed === undefined || uncompressed > MAX_ENTRY_UNCOMPRESSED_BYTES || totalBytes + uncompressed > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      skipped.push(`${entry.name} (too large)`)
      continue
    }
    if (attachments.length >= MAX_ZIP_ENTRIES) {
      skipped.push(`${entry.name} (over the ${MAX_ZIP_ENTRIES}-file limit)`)
      continue
    }
    totalBytes += uncompressed
    try {
      attachments.push(await readAttachmentFile(entry.name, await entry.async('nodebuffer')))
    } catch (err) {
      skipped.push(`${entry.name} (${err instanceof AttachmentReadError ? err.message : "couldn't be read"})`)
    }
  }
  if (attachments.length === 0) throw new ZipAttachmentError(`None of the files in that zip could be read: ${skipped.join(', ')}`)
  return { attachments, skipped }
}
