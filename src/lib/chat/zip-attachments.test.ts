import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { readZipAttachments, MAX_ZIP_ENTRIES } from './zip-attachments'

async function zipOf(files: Record<string, string>): Promise<Buffer> {
  const zip = new JSZip()
  for (const [name, content] of Object.entries(files)) zip.file(name, content)
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
}

describe('readZipAttachments', () => {
  it('turns each supported file into its own attachment and reports what it skipped', async () => {
    const buffer = await zipOf({
      'onto/ontology.ttl': 'ex:A a owl:Class .',
      'onto/shapes.ttl': 'ex:AShape a sh:NodeShape .',
      'onto/diagram.png': 'not text',
      'onto/inner.zip': 'nested',
      '__MACOSX/onto/._ontology.ttl': 'resource fork',
      'onto/.DS_Store': 'finder',
    })

    const { attachments, skipped } = await readZipAttachments(buffer)

    expect(attachments).toEqual([
      { name: 'onto/ontology.ttl', text: 'ex:A a owl:Class .', truncated: false },
      { name: 'onto/shapes.ttl', text: 'ex:AShape a sh:NodeShape .', truncated: false },
    ])
    expect(skipped.sort()).toEqual(['onto/diagram.png', 'onto/inner.zip'])
  })

  it('truncates a single oversized text file like a normal attachment', async () => {
    const { attachments } = await readZipAttachments(await zipOf({ 'big.txt': 'x'.repeat(60_000) }))
    expect(attachments[0].truncated).toBe(true)
    expect(attachments[0].text).toHaveLength(50_000)
  })

  it('refuses a zip with nothing supported, too many files, or that is not a zip', async () => {
    await expect(readZipAttachments(await zipOf({ 'a.png': 'x' }))).rejects.toThrow(/No supported files/)
    const many = Object.fromEntries(Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, i) => [`f${i}.txt`, 'x']))
    await expect(readZipAttachments(await zipOf(many))).rejects.toThrow(/at most 20/)
    await expect(readZipAttachments(Buffer.from('definitely not a zip'))).rejects.toThrow(/couldn't be opened/)
  })
})
