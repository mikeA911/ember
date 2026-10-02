import { describe, expect, it } from 'vitest'
import {
  formatMessageWithAttachments,
  isZipFileName,
  documentMimeType,
  findingsContentForAttachment,
  findingsNotesForAttachment,
  isProbablyText,
  redactSecrets,
  REDACTED,
  extractAttachmentsFromMessage,
  formatMessageWithAttachment,
  truncateAttachmentText,
  MAX_ATTACHMENT_CHARS,
} from './attachments'

describe('documentMimeType', () => {
  it('only names the formats that need an extractor', () => {
    expect(documentMimeType('Report.PDF')).toBe('application/pdf')
    expect(documentMimeType('a.b.docx')).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(documentMimeType('notes.md')).toBeNull()
    expect(documentMimeType('README')).toBeNull()
  })
})

describe('isProbablyText', () => {
  const enc = (t: string) => new TextEncoder().encode(t)

  it('accepts Markdown, code, .env and extensionless text', () => {
    expect(isProbablyText(enc('# Title\n\n- item\n'))).toBe(true)
    expect(isProbablyText(enc('export const x = 1\r\n\tif (x) {}\n'))).toBe(true)
    expect(isProbablyText(enc('API_KEY=abc\nPORT=3000\n'))).toBe(true)
    expect(isProbablyText(enc('Comunidad — Kuryente ✓'))).toBe(true)
  })

  it('rejects binary content, invalid UTF-8 and empty files', () => {
    expect(isProbablyText(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]))).toBe(false) // PNG
    expect(isProbablyText(new Uint8Array([0xff, 0xfe, 0x41, 0x00]))).toBe(false) // UTF-16
    expect(isProbablyText(new Uint8Array([0x61, 0xc3, 0x28]))).toBe(false)
    expect(isProbablyText(new Uint8Array([]))).toBe(false)
  })
})

describe('redactSecrets', () => {
  it('hides secret-looking values in .env files and keeps the names', () => {
    const env = ['# Supabase', 'SUPABASE_SERVICE_ROLE_KEY=abc123', 'export OPENAI_API_KEY="sk-xyz"', 'DB_PASSWORD=hunter2', 'PORT=3000', 'NEXT_PUBLIC_SITE_URL=https://example.com', 'EMPTY_TOKEN='].join('\n')
    const { text, hidden } = redactSecrets('.env.local', env)
    expect(text).toBe(
      ['# Supabase', `SUPABASE_SERVICE_ROLE_KEY=${REDACTED}`, `export OPENAI_API_KEY=${REDACTED}`, `DB_PASSWORD=${REDACTED}`, 'PORT=3000', 'NEXT_PUBLIC_SITE_URL=https://example.com', 'EMPTY_TOKEN='].join('\n')
    )
    expect(hidden).toBe(3)
  })

  it('hides private keys, known token formats and URL passwords in any file', () => {
    const code = [
      'const key = "sk-proj-abcdefghijklmnopqrstuvwxyz123456"',
      'DATABASE_URL=postgres://app:s3cret@db.example.com:5432/app',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----',
      'const apiKey = process.env.API_KEY',
    ].join('\n')
    const { text, hidden } = redactSecrets('config.ts', code)
    expect(text).not.toContain('abcdefghijklmnop')
    expect(text).not.toContain('s3cret')
    expect(text).toContain(`postgres://app:${REDACTED}@db.example.com`)
    expect(text).not.toContain('MIIEow')
    expect(text).toContain('const apiKey = process.env.API_KEY')
    expect(hidden).toBe(3)
  })

  it('leaves ordinary text alone', () => {
    expect(redactSecrets('notes.md', '# Notes\nThe key insight is pricing.')).toEqual({ text: '# Notes\nThe key insight is pricing.', hidden: 0 })
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

describe('findingsContentForAttachment', () => {
  it('keeps prose as-is and fences code and config with a language', () => {
    expect(findingsContentForAttachment({ name: 'notes.md', text: '# Hi', truncated: false })).toBe('# Hi')
    expect(findingsContentForAttachment({ name: 'src/app.ts', text: 'const a = 1', truncated: false })).toBe('```typescript\nconst a = 1\n```')
    expect(findingsContentForAttachment({ name: '.env.local', text: 'A=1', truncated: false })).toBe('```bash\nA=1\n```')
    expect(findingsContentForAttachment({ name: 'Makefile', text: 'all:', truncated: false })).toBe('```\nall:\n```')
  })

  it('uses a fence longer than any backtick run inside', () => {
    expect(findingsContentForAttachment({ name: 'doc.ttl', text: 'x ``` y', truncated: false })).toBe('````turtle\nx ``` y\n````')
  })

  it('notes truncation and hidden secrets', () => {
    expect(findingsNotesForAttachment({ name: 'a', text: 'x', truncated: true, hiddenSecrets: 2 })).toBe(
      'Uploaded in Ember chat. Only the first 50,000 characters were kept. 2 secret value(s) were hidden before saving.'
    )
  })
})
