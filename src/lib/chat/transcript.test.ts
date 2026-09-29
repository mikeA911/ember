import { describe, expect, it } from 'vitest'
import { conversationToTranscript, defaultNoteTitle } from './transcript'

describe('conversationToTranscript', () => {
  it('keeps only visible user/assistant turns, in order', () => {
    const out = conversationToTranscript([
      { role: 'user', content: 'What is RAG?' },
      { role: 'assistant', content: null },
      { role: 'tool', content: '{"results":[]}' },
      { role: 'assistant', content: '  Retrieval-augmented generation.  ' },
    ])
    expect(out).toBe('**You:**\n\nWhat is RAG?\n\n---\n\n**Ember:**\n\nRetrieval-augmented generation.')
  })

  it('is empty for a conversation with no visible turns', () => {
    expect(conversationToTranscript([{ role: 'assistant', content: '   ' }])).toBe('')
  })
})

describe('defaultNoteTitle', () => {
  it('prefers the conversation title', () => {
    expect(defaultNoteTitle('Pricing research', 'hi')).toBe('Pricing research')
  })

  it('falls back to the first line of the opening message, then a generic title', () => {
    expect(defaultNoteTitle(null, 'Compare vendors\nAttached file: a.pdf')).toBe('Compare vendors')
    expect(defaultNoteTitle(null, undefined)).toBe('Ember conversation')
  })

  it('caps long titles', () => {
    const title = defaultNoteTitle(null, 'x'.repeat(200))
    expect(title).toHaveLength(80)
    expect(title.endsWith('…')).toBe(true)
  })
})
