import { describe, expect, it } from 'vitest'
import { buildProjectSummaryMarkdown, type ProjectSummaryInput } from './status-summary'

const base: ProjectSummaryInput = {
  name: 'Lunch Ordering',
  typeLabel: 'AI Experiment',
  status: 'approved',
  objective: 'Order lunch\nwith an agent',
  goal: '## Approach\nPrototype, then measure.',
  details: {
    hypothesis: 'An agent can order lunch',
    success_criteria: '',
    constraints: { budget: '$20/day', vendors: ['A', 'B'] },
  },
  findings: 'Vendor API is rate-limited.',
  starterPrompt: 'What should I read first?',
  members: [
    { email: 'owner@example.com', role: 'owner' },
    { email: 'member@example.com', role: 'member' },
  ],
  workstreams: [
    {
      name: 'Menu | intake',
      status: 'active',
      lifecycleStage: 'presales',
      operationalStatus: 'open',
      goal: 'Parse menus',
      guardrail: 'No PII',
      outcome: null,
      repositoryScope: ['org/menu-parser'],
      deliverables: [
        { label: 'Parser', completed: true },
        { label: 'Eval set', completed: false },
      ],
      artifacts: { total: 3, awaitingReview: 1, approved: 2 },
      dependsOn: [],
      feedsInto: ['Checkout'],
      objects: [{ name: 'Menu', accessModes: ['reads', 'creates'] }],
    },
    {
      name: 'Checkout',
      status: 'completed',
      lifecycleStage: null,
      operationalStatus: 'concluded',
      goal: null,
      guardrail: null,
      outcome: 'Orders placed end to end.',
      repositoryScope: [],
      deliverables: [],
      artifacts: { total: 0, awaitingReview: 0, approved: 0 },
      dependsOn: ['Menu | intake'],
      feedsInto: [],
      objects: [],
    },
  ],
  objects: [
    { id: 'o2', name: 'Menu item', parentId: 'o1' },
    { id: 'o1', name: 'Menu', parentId: null },
    { id: 'o3', name: 'Order', parentId: null },
  ],
  knowledgeBases: [{ name: 'Menus', status: 'pending' }],
  wikiArticles: ['RAG basics'],
  evalDatasets: [],
  governance: { approvalTypes: 2, authorityGaps: ['data_access'] },
  ontology: { flowEdges: 1, objectLinks: 1 },
  openNotes: [{ subject: 'Check vendor API', authorEmail: null }],
  pendingReview: { joinRequests: 1, sourceSubmissions: 0, workstreamPromotions: 0 },
}

describe('buildProjectSummaryMarkdown -- newcomer brief', () => {
  const md = buildProjectSummaryMarkdown(base, 'Sep 30, 2026, 9:00 AM')

  it('explains purpose, goal and requirements', () => {
    expect(md).toContain('# Lunch Ordering -- project summary')
    expect(md).toContain('_Generated Sep 30, 2026, 9:00 AM.')
    expect(md).toContain('## Part 1 -- Project brief')
    expect(md).toContain('Order lunch\nwith an agent')
    // Embedded headings are demoted so they can't break the document's structure.
    expect(md).toContain('### Goal and approach\n\n**Approach**\nPrototype, then measure.')
    expect(md).toContain('**Hypothesis:** An agent can order lunch')
    expect(md).not.toContain('Success criteria')
    expect(md).toContain('**Constraints:**\n\n- **Budget:** $20/day\n- **Vendors:** A, B')
  })

  it('describes each workstream and the domain objects', () => {
    expect(md).toContain('#### Menu | intake\n\n_Active · presales_')
    expect(md).toContain('**Guardrails:**\n\nNo PII')
    expect(md).toContain('**Scope:** `org/menu-parser`')
    expect(md).toContain('- [x] Parser\n- [ ] Eval set')
    expect(md).toContain('**Feeds into:** Checkout')
    expect(md).toContain('**Depends on:** Menu | intake')
    expect(md).toContain('**Works with:** Menu (reads, creates)')
    expect(md).toContain('**Outcome so far:**\n\nOrders placed end to end.')
    expect(md).toContain('- Menu\n  - Menu item\n- Order')
  })

  it('points to findings, sources, contacts and a starter prompt', () => {
    expect(md).toContain('### Findings so far\n\nVendor API is rate-limited.')
    expect(md).toContain('- Knowledge base: Menus (pending review)\n- Wiki: RAG basics')
    expect(md).toContain('### Who to ask\n\n- owner@example.com (owner)\n\n')
    expect(md).toContain('> What should I read first?')
  })
})

describe('buildProjectSummaryMarkdown -- current status', () => {
  it('summarizes totals and workstream progress', () => {
    const md = buildProjectSummaryMarkdown(base, 'now')
    expect(md).toContain('## Part 2 -- Current status')
    expect(md).toContain('- **Project status:** approved')
    expect(md).toContain('- **Workstreams:** 2 (1 active, 1 completed)')
    expect(md).toContain('- **Deliverables:** 1/2 complete (50%)')
    expect(md).toContain('- **Artifacts:** 3 (2 approved, 1 awaiting review)')
    expect(md).toContain('- **Ontology:** 3 domain objects, 1 pipeline link, 1 workstream-object link')
    expect(md).toContain('- **Governance:** 2 approval types configured -- authority gaps: data access')
    expect(md).toContain('- **Waiting on a curator:** 1 join request')
    expect(md).toContain('| Menu \\| intake | active | presales | 1/2 | 3 (1 to review) |')
    expect(md).toContain('| Checkout | completed (concluded) | -- | -- | -- |')
    expect(md).toContain('- Check vendor API\n')
  })

  it('omits hidden status and curator-only counts, and handles an empty project', () => {
    const md = buildProjectSummaryMarkdown(
      {
        ...base,
        status: null,
        objective: null,
        goal: null,
        details: {},
        findings: null,
        starterPrompt: null,
        workstreams: [],
        objects: [],
        knowledgeBases: [],
        wikiArticles: [],
        members: [],
        openNotes: [],
        governance: { approvalTypes: 0, authorityGaps: [] },
        ontology: { flowEdges: 0, objectLinks: 0 },
        pendingReview: undefined,
      },
      'now'
    )
    expect(md).not.toContain('Project status')
    expect(md).not.toContain('Waiting on a curator')
    expect(md).not.toContain('Requirements and success criteria')
    expect(md).not.toContain('Key concepts')
    expect(md).not.toContain('Who to ask')
    expect(md).not.toContain('Workstream progress')
    expect(md).toContain('No objective written yet.')
    expect(md).toContain('No workstreams defined yet.')
    expect(md).toContain('No project-specific knowledge attached yet.')
    expect(md).toContain('- **Governance:** no approval requirements configured')
    expect(md).toContain('No open notes.')
  })
})
