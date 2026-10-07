import { describe, expect, it } from 'vitest'
import { PROPOSE_FIELD_EDIT_TOOL_NAME, PROPOSE_PROJECT_NOTE_TOOL_NAME, toProposal } from './shared-chat-tools'
import { OMITTED_REPLY, buildSummaryInput, usableSummary } from './shared-turn-context'

const ctx = { projectId: 'p1', members: [{ userId: 'u1', displayLabel: 'Gil Guest' }], workstreams: [{ id: 'w1', name: 'Call intake' }] }

describe('proposal tools', () => {
  it('accepts a note to a listed member or the team, never an invented recipient', () => {
    expect(toProposal(PROPOSE_PROJECT_NOTE_TOOL_NAME, { recipientUserId: 'u1', subject: ' Hi ', body: ' Body ' }, ctx)).toEqual({
      proposal: { kind: 'note', recipientType: 'user', recipientUserId: 'u1', recipientName: 'Gil Guest', subject: 'Hi', body: 'Body' },
    })
    expect(toProposal(PROPOSE_PROJECT_NOTE_TOOL_NAME, { toProjectTeam: true, subject: 'S', body: 'B' }, ctx)).toMatchObject({ proposal: { recipientType: 'project_team' } })
    expect(toProposal(PROPOSE_PROJECT_NOTE_TOOL_NAME, { recipientUserId: 'someone', subject: 'S', body: 'B' }, ctx)).toHaveProperty('error')
    expect(toProposal(PROPOSE_PROJECT_NOTE_TOOL_NAME, { recipientUserId: 'u1', subject: '', body: 'B' }, ctx)).toHaveProperty('error')
  })

  it('accepts field text for the Project or one of its workstreams', () => {
    expect(toProposal(PROPOSE_FIELD_EDIT_TOOL_NAME, { field: 'project_goal', text: 'Go live by March' }, ctx)).toEqual({
      proposal: { kind: 'field', field: 'project_goal', targetId: 'p1', targetName: null, text: 'Go live by March' },
    })
    expect(toProposal(PROPOSE_FIELD_EDIT_TOOL_NAME, { field: 'workstream_summary', workstreamId: 'w1', text: 'Mapped' }, ctx)).toMatchObject({
      proposal: { targetId: 'w1', targetName: 'Call intake' },
    })
    expect(toProposal(PROPOSE_FIELD_EDIT_TOOL_NAME, { field: 'workstream_summary', workstreamId: 'other', text: 'x' }, ctx)).toHaveProperty('error')
    expect(toProposal(PROPOSE_FIELD_EDIT_TOOL_NAME, { field: 'name', text: 'x' }, ctx)).toHaveProperty('error')
  })
})

describe('summary input', () => {
  const ks = (id: string) => ({ type: 'knowledge_source' as const, id })
  const context = {
    summary: { id: 's', uptoOrd: 4, content: 'Earlier: Hana asked about pricing.', evidence: [ks('pricing')] },
    unsummarized: [
      { kind: 'message' as const, ord: 5, authorName: 'Gil', content: 'And staffing?', evidence: [] },
      { kind: 'reply' as const, ord: 5, authorName: null, content: 'Two dispatchers.', evidence: [ks('staffing')] },
      { kind: 'reply' as const, ord: 7, authorName: null, content: 'Secret figure 40k', evidence: [ks('pricing')] },
    ],
  }

  it('drops a summary or answer built on evidence not every reader can open, and records what it used', () => {
    const common = new Set(['knowledge_source:staffing'])
    expect(usableSummary(context.summary, common)).toBeNull()
    const input = buildSummaryInput(context, common)!
    expect(input.text).not.toContain('pricing')
    expect(input.text).not.toContain('40k')
    expect(input.text).toContain(OMITTED_REPLY)
    expect(input.text).toContain('[Gil]: And staffing?')
    expect(input.evidence).toEqual([ks('staffing')])
    expect(input.uptoOrd).toBe(7)
  })

  it('builds on the previous summary while it is still common', () => {
    const input = buildSummaryInput(context, new Set(['knowledge_source:staffing', 'knowledge_source:pricing']))!
    expect(input.text).toContain('Summary so far:\nEarlier: Hana asked about pricing.')
    expect(input.evidence.map((e) => e.id).sort()).toEqual(['pricing', 'staffing'])
  })
})
