import { describe, it, expect } from 'vitest'
import { buildProposalSummaryMarkdown } from './proposal-summary'

describe('buildProposalSummaryMarkdown', () => {
  it('covers the goal, deliverables, guardrails and approved material, ending with next steps', () => {
    const md = buildProposalSummaryMarkdown(
      {
        title: 'Acme Order Automation',
        preparedBy: 'Bea (bea@example.com)',
        goal: 'Automate order intake.\n## Why\nManual entry is slow.',
        guardrail: 'No changes to the ERP.',
        deliverables: [
          { label: 'Intake agent', completed: false },
          { label: 'Process map', completed: true },
        ],
        artifacts: [{ title: 'Architecture', typeLabel: 'Design Note', content: 'Three services.', externalUrl: 'https://example.com/a' }],
      },
      '1 Oct 2026, 9:00'
    )

    expect(md).toContain('# Acme Order Automation -- proposal')
    expect(md).toContain('_Prepared 1 Oct 2026, 9:00 by Bea (bea@example.com)._')
    // An embedded heading can't break the document's own structure.
    expect(md).toContain('**Why**')
    expect(md).toContain('- Intake agent\n- Process map (ready)')
    expect(md).toContain('## Scope and guardrails')
    expect(md).toContain('### Architecture')
    expect(md).toContain('Link: https://example.com/a')
    expect(md).toContain('reply to Bea (bea@example.com)')
  })

  it('leaves out empty sections', () => {
    const md = buildProposalSummaryMarkdown({ title: 'X', preparedBy: null, goal: null, guardrail: null, deliverables: [], artifacts: [] }, 'now')
    expect(md).not.toContain('## Deliverables')
    expect(md).not.toContain('## Supporting material')
    expect(md).toContain('still being written')
  })
})
