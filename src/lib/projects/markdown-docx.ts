import { Document, HeadingLevel, Packer, Paragraph, TextRun } from 'docx'

// Word export for the summaries Ember writes itself (status-summary.ts,
// proposal-summary.ts). Not a general Markdown renderer: it covers the
// subset those builders emit -- headings, bullets, checkboxes, quotes,
// italic notes and **bold** runs. Anything else (an artifact's own tables
// or code, passed through as-is) becomes plain paragraphs, which keeps
// every word but not that formatting. Runs in the browser at click time;
// docx's Packer.toBlob needs no server.

const HEADINGS: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.TITLE,
  2: HeadingLevel.HEADING_1,
  3: HeadingLevel.HEADING_2,
  4: HeadingLevel.HEADING_3,
  5: HeadingLevel.HEADING_4,
  6: HeadingLevel.HEADING_5,
}

// **bold** spans into runs; everything else stays plain text.
export function inlineRuns(text: string, base: { italics?: boolean; font?: string } = {}): TextRun[] {
  return text
    .split(/(\*\*[^*]+\*\*)/)
    .filter(Boolean)
    .map((part) =>
      part.startsWith('**') && part.endsWith('**') && part.length > 4
        ? new TextRun({ text: part.slice(2, -2), bold: true, ...base })
        : new TextRun({ text: part, ...base })
    )
}

export function markdownToParagraphs(markdown: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  let inCode = false
  for (const raw of markdown.split('\n')) {
    const line = raw.trimEnd()
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }))
      continue
    }
    if (!line.trim()) continue

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      paragraphs.push(new Paragraph({ text: heading[2], heading: HEADINGS[heading[1].length] }))
      continue
    }
    const bullet = /^(\s*)[-*]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line)
    if (bullet) {
      const level = Math.min(Math.floor(bullet[1].length / 2), 3)
      const box = bullet[2] === undefined ? '' : bullet[2] === ' ' ? '☐ ' : '☑ '
      paragraphs.push(new Paragraph({ children: inlineRuns(box + bullet[3]), bullet: { level } }))
      continue
    }
    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      paragraphs.push(new Paragraph({ children: inlineRuns(quote[1], { italics: true }), indent: { left: 360 } }))
      continue
    }
    const note = /^_(.+)_$/.exec(line)
    if (note) {
      paragraphs.push(new Paragraph({ children: inlineRuns(note[1], { italics: true }) }))
      continue
    }
    paragraphs.push(new Paragraph({ children: inlineRuns(line) }))
  }
  return paragraphs
}

export async function markdownToDocxBlob(markdown: string): Promise<Blob> {
  const doc = new Document({ sections: [{ children: markdownToParagraphs(markdown) }] })
  return Packer.toBlob(doc)
}
