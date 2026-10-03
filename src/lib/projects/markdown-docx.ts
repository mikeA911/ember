import { Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'

// Word export for the summaries Ember writes itself (status-summary.ts,
// proposal-summary.ts, agency-summary.ts). Not a general Markdown
// renderer: it covers the subset those builders emit -- headings, bullets,
// checkboxes, quotes, italic notes, pipe tables and **bold** runs. Anything
// else (e.g. an artifact's own code, passed through as-is) becomes plain
// paragraphs, which keeps every word but not that formatting. Runs in the browser at click time;
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

// One pipe-table row's cells; "\|" is a literal pipe inside a cell.
function tableCells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
    .map((c) => c.trim().replace(/\\\|/g, '|'))
}

const isTableLine = (line: string) => line.trimStart().startsWith('|')
const isSeparatorRow = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c))

function markdownTable(lines: string[]): Table | null {
  const rows = lines.map(tableCells).filter((cells) => !isSeparatorRow(cells))
  if (rows.length === 0) return null
  const width = Math.max(...rows.map((r) => r.length))
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (cells, i) =>
        new TableRow({
          tableHeader: i === 0,
          children: Array.from(
            { length: width },
            (_, c) => new TableCell({ children: [new Paragraph({ children: i === 0 ? [new TextRun({ text: cells[c] ?? '', bold: true })] : inlineRuns(cells[c] ?? '') })] })
          ),
        })
    ),
  })
}

export function markdownToParagraphs(markdown: string): (Paragraph | Table)[] {
  const paragraphs: (Paragraph | Table)[] = []
  let inCode = false
  const lines = markdown.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trimEnd()
    if (line.trimStart().startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) {
      paragraphs.push(new Paragraph({ children: [new TextRun({ text: line, font: 'Courier New' })] }))
      continue
    }
    if (!line.trim()) continue

    if (isTableLine(line)) {
      const tableLines = [line]
      while (i + 1 < lines.length && isTableLine(lines[i + 1])) tableLines.push(lines[++i].trimEnd())
      const table = markdownTable(tableLines)
      if (table) paragraphs.push(table)
      continue
    }

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
