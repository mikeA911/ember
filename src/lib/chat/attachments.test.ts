import { describe, expect, it } from 'vitest'
import {
  attachmentMimeType,
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
