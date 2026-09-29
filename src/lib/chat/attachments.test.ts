import { describe, expect, it } from 'vitest'
import {
  formatMessageWithAttachments,
  isZipFileName,
  attachmentMimeType,
  extractAttachmentsFromMessage,
  formatMessageWithAttachment,
  truncateAttachmentText,
  MAX_ATTACHMENT_CHARS,
} from './attachments'

describe('attachmentMimeType', () => {
  it('maps supported extensions case-insensitively', () => {
    expect(attachmentMimeType('Report.PDF')).toBe('application/pdf')
    expect(attachmentMimeType('notes.md')).toBe('text/plain')
    expect(attachmentMimeType('a.b.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
  })

  it('reads ontology serializations as plain text', () => {
    for (const name of ['onto.ttl', 'onto.owl', 'onto.rdf', 'onto.jsonld', 'onto.json', 'onto.yaml', 'onto.yml', 'onto.xml']) {
      expect(attachmentMimeType(name)).toBe('text/plain')
    }
  })

  it('rejects unsupported or missing extensions', () => {
    expect(attachmentMimeType('image.png')).toBeNull()
    expect(attachmentMimeType('README')).toBeNull()
  })
})

describe('truncateAttachmentText', () => {
  it('trims and leaves short text alone', () => {
    expect(truncateAttachmentText('  hi \n')).toEqual({ text: 'hi', truncated: false })
  })

  it('caps long text', () => {
    const result = truncateAttachmentText('x'.repeat(MAX_ATTACHMENT_CHARS + 10))
    expect(result.text).toHaveLength(MAX_ATTACHMENT_CHARS)
    expect(result.truncated).toBe(true)
  })
})

describe('formatMessageWithAttachment', () => {
  it('appends the file below the typed message', () => {
    expect(formatMessageWithAttachment('Summarize this', { name: 'a.txt', text: 'hello', truncated: false })).toBe(
      'Summarize this\n\nAttached file: a.txt\n\n~~~\nhello\n~~~'
    )
  })

  it('works with no typed message and notes truncation', () => {
    const out = formatMessageWithAttachment('', { name: 'a.txt', text: 'hello', truncated: true })
    expect(out.startsWith('Attached file: a.txt (first 50,000 characters)')).toBe(true)
  })

  it('uses a fence longer than any tilde run in the content', () => {
    const out = formatMessageWithAttachment('', { name: 'a.md', text: 'x\n~~~~\ny', truncated: false })
    expect(out).toContain('\n~~~~~\nx\n~~~~\ny\n~~~~~')
  })
})

describe('extractAttachmentsFromMessage', () => {
  it('round-trips what formatMessageWithAttachment wrote', () => {
    const text = '@prefix ex: <x#> .\n# comment\nex:A ~~~~ ex:B .'
    const message = formatMessageWithAttachment('Import this please', { name: 'onto.ttl', text, truncated: false })
    expect(extractAttachmentsFromMessage(message)).toEqual([{ name: 'onto.ttl', text, truncated: false }])
  })

  it('flags a truncated attachment and ignores messages without one', () => {
    const message = formatMessageWithAttachment('', { name: 'big.ttl', text: 'abc', truncated: true })
    expect(extractAttachmentsFromMessage(message)).toEqual([{ name: 'big.ttl', text: 'abc', truncated: true }])
    expect(extractAttachmentsFromMessage('Just a question about Attached file: nothing')).toEqual([])
  })
})

describe('formatMessageWithAttachments', () => {
  it('appends each attachment as its own block, recoverable one by one', () => {
    const files = [
      { name: 'ontology.ttl', text: 'ex:A a owl:Class .', truncated: false },
      { name: 'shapes.ttl', text: 'ex:AShape a sh:NodeShape .', truncated: false },
    ]
    const message = formatMessageWithAttachments('Import these', files)
    expect(message.startsWith('Import these\n\nAttached file: ontology.ttl')).toBe(true)
    expect(extractAttachmentsFromMessage(message)).toEqual(files)
  })

  it('recognises zip names', () => {
    expect(isZipFileName('Files.ZIP')).toBe(true)
    expect(isZipFileName('onto.ttl')).toBe(false)
  })
})
