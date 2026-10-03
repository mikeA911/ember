import { describe, it, expect } from 'vitest'
import { Packer } from 'docx'
import JSZip from 'jszip'
import { Document } from 'docx'
import { markdownToParagraphs } from './markdown-docx'

async function documentXml(markdown: string) {
  const buffer = await Packer.toBuffer(new Document({ sections: [{ children: markdownToParagraphs(markdown) }] }))
  return (await JSZip.loadAsync(buffer)).file('word/document.xml')!.async('string')
}

describe('markdownToParagraphs', () => {
  it('keeps headings, bullets, checkboxes, quotes and bold text', async () => {
    const xml = await documentXml(
      ['# Title', '', '## Section', '- one', '- [x] done', '> quoted', '**Label:** value', '```', 'code line', '```'].join('\n')
    )
    expect(xml).toContain('w:val="Title"')
    expect(xml).toContain('w:val="Heading1"')
    expect(xml).toContain('>one<')
    expect(xml).toContain('☑ done')
    expect(xml).toContain('quoted')
    expect(xml).toMatch(/<w:b\/>[\s\S]*Label:/)
    expect(xml).toContain('code line')
    expect(xml).not.toContain('```')
  })

  it('turns a pipe table into a Word table, header bold, escaped pipes kept', async () => {
    const xml = await documentXml(['| Name | Note |', '| --- | --- |', '| Acme | a \\| b |', '| Globex | **75%** |'].join('\n'))
    expect(xml).toContain('<w:tbl>')
    expect(xml.match(/<w:tr>|<w:tr /g)?.length).toBe(3)
    expect(xml).toContain('a | b')
    expect(xml).not.toContain('---')
    expect(xml).toMatch(/<w:b\/>[\s\S]*75%/)
  })
})
