import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readZipAttachments, MAX_ZIP_ENTRIES } from './zip-attachments'

async function zipOf(files: Record<string, string | Uint8Array>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('readZipAttachments', () => {
  it('reads every text file (including .env and extensionless ones), hiding secrets and skipping binaries and clutter', async () => {
    const buffer = await zipOf({
      'onto/ontology.ttl': 'ex:A a owl:Class .',
      'onto/README': 'Read me first',
      'onto/.env': 'API_KEY=abc\nPORT=3000',
      'onto/diagram.png': new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x00]),
      'onto/inner.zip': 'nested',
      '__MACOSX/onto/._ontology.ttl': 'resource fork',
      'onto/.DS_Store': 'finder',
      'node_modules/x/index.js': 'module.exports = 1',
    })

    const { attachments, skipped } = await readZipAttachments(buffer)

    expect(attachments).toEqual([
      { name: 'onto/.env', text: 'API_KEY=[hidden by Ember]\nPORT=3000', truncated: false, hiddenSecrets: 1 },
      { name: 'onto/ontology.ttl', text: 'ex:A a owl:Class .', truncated: false },
      { name: 'onto/README', text: 'Read me first', truncated: false },
    ])
    expect(skipped).toEqual([expect.stringMatching(/^onto\/diagram\.png \(isn't a text file/), 'onto/inner.zip (zip inside a zip)'])
  })

  it('truncates a single oversized text file like a normal attachment', async () => {
    const { attachments } = await readZipAttachments(await zipOf({ 'big.txt': 'x'.repeat(60_000) }))
    expect(attachments[0].truncated).toBe(true)
    expect(attachments[0].text).toHaveLength(50_000)
  })

  it('attaches at most 20 files and lists the rest', async () => {
    const files = Object.fromEntries(Array.from({ length: MAX_ZIP_ENTRIES + 2 }, (_, i) => [`f${String(i).padStart(2, '0')}.txt`, 'x']))
    const { attachments, skipped } = await readZipAttachments(await zipOf(files))
    expect(attachments).toHaveLength(MAX_ZIP_ENTRIES)
    expect(skipped).toEqual(['f20.txt (over the 20-file limit)', 'f21.txt (over the 20-file limit)'])
  })

  it('refuses a zip with nothing readable, far too many files, or that is not a zip', async () => {
    await expect(readZipAttachments(await zipOf({ 'a.png': new Uint8Array([0x89, 0x00]) }))).rejects.toThrow(/None of the files/)
    const many = Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`f${i}.txt`, 'x']))
    await expect(readZipAttachments(await zipOf(many))).rejects.toThrow(/201 files/)
    await expect(readZipAttachments(Buffer.from('definitely not a zip'))).rejects.toThrow(/couldn't be opened/)
  })
})
