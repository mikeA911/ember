import { describe, expect, it } from 'vitest'
import { OMITTED_REPLY, buildSharedHistory, mergeEvidence, sharedSystemPrompt } from './shared-turn-context'

const ks = (id: string, title?: string) => ({ type: 'knowledge_source' as const, id, ...(title ? { title } : {}) })

describe('shared turn context', () => {
  const history = [
    { kind: 'message' as const, authorName: 'Hana', content: 'What does the vendor charge?', evidence: [] },
    { kind: 'reply' as const, authorName: null, content: 'About 40k a year.', evidence: [ks('pricing')] },
    { kind: 'comment' as const, authorName: 'Vera', content: 'And support?', evidence: [] },
    { kind: 'reply' as const, authorName: null, content: 'Support is included.', evidence: [ks('overview', 'Overview')] },
  ]

  it('leaves out earlier answers built on evidence not every reader can open, and carries the evidence of those kept', () => {
    const { messages, carried } = buildSharedHistory(
      { history, prompt: { id: 'p', kind: 'message', content: 'Summarise', authorName: 'Gil' }, requestedByName: 'Gil' },
      new Set(['knowledge_source:overview'])
    )
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', '[Hana]\nWhat does the vendor charge?'],
      ['assistant', OMITTED_REPLY],
      ['user', '[Comment from Vera, a viewer]\nAnd support?'],
      ['assistant', 'Support is included.'],
      ['user', '[Gil]\nSummarise'],
    ])
    expect(carried).toEqual([ks('overview', 'Overview')])
    expect(JSON.stringify(messages)).not.toContain('40k')
  })

  it('attributes a passed-on comment to the viewer who wrote it and the participant who passed it on', () => {
    const { messages } = buildSharedHistory(
      { history: [], prompt: { id: 'p', kind: 'comment', content: 'Is radio covered?', authorName: 'Vera' }, requestedByName: 'Hana' },
      new Set()
    )
    expect(messages).toEqual([{ role: 'user', content: '[Comment from Vera, a viewer]\nIs radio covered?\n\n(Hana passed this comment on and asked you to respond.)' }])
  })

  it('merges evidence once per item', () => {
    expect(mergeEvidence([ks('a')], [ks('a', 'A'), ks('b', 'B'), { type: 'wiki_article', id: 'a' }])).toEqual([ks('a'), ks('b', 'B'), { type: 'wiki_article', id: 'a' }])
  })

  it('tells Ember who reads the conversation and that it cannot act', () => {
    const prompt = sharedSystemPrompt({ projectName: 'Harbour', goal: null, objective: 'CAD', pairNames: ['Hana', 'Gil'], viewerCount: 2 })
    expect(prompt).toContain('Hana and Gil (working together live), and 2 viewers')
    expect(prompt).toContain('cannot change anything')
    expect(prompt).not.toContain('Project goal')
  })
})
