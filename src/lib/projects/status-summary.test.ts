import { describe, expect, it } from 'vitest'
import { buildProjectSummaryMarkdown, type ProjectSummaryInput } from './status-summary'

const base: ProjectSummaryInput = {
  name: 'Lunch Ordering',
  typeLabel: 'AI Experiment',
  status: 'approved',
  objective: 'Order lunch\nwith an agent',
  goal: null,
  members: [{ email: 'owner@example.com', role: 'owner' }],
  workstreams: [
    {
      name: 'Menu | intake',
      status: 'active',
      lifecycleStage: 'presales',
      operationalStatus: 'open',
      goal: 'Parse menus',
      deliverables: [
        { label: 'Parser', completed: true },
        { label: 'Eval set', completed: false },
      ],
      artifacts: { total: 3, awaitingReview: 1, approved: 2 },
    },
    {
      name: 'Checkout',
      status: 'completed',
      lifecycleStage: null,
      operationalStatus: 'concluded',
      goal: null,
      deliverables: [],
      artifacts: { total: 0, awaitingReview: 0, approved: 0 },
    },
  ],
  knowledgeBases: [{ name: 'Menus', status: 'pending' }],
  wikiArticles: ['RAG basics'],
  evalDatasets: [],
  governance: { approvalTypes: 2, authorityGaps: ['data_access'] },
  ontology: { objects: 4, workstreams: 2, flowEdges: 1, objectLinks: 3 },
  openNotes: [{ subject: 'Check vendor API', authorEmail: null }],
  pendingReview: { joinRequests: 1, sourceSubmissions: 0, workstreamPromotions: 0 },
}

describe('buildProjectSummaryMarkdown', () => {
  it('summarizes totals, workstreams and deliverables', () => {
    const md = buildProjectSummaryMarkdown(base, 'Sep 30, 2026, 9:00 AM')
    expect(md).toContain('# Lunch Ordering -- project summary')
    expect(md).toContain('_Generated Sep 30, 2026, 9:00 AM.')
    expect(md).toContain('- **Objective:** Order lunch with an agent')
    expect(md).toContain('- **Workstreams:** 2 (1 active, 1 completed)')
    expect(md).toContain('- **Deliverables:** 1/2 complete (50%)')
    expect(md).toContain('- **Artifacts:** 3 (2 approved, 1 awaiting review)')
    expect(md).toContain('- **Authority gaps:** data access')
    expect(md).toContain('- **Waiting on a curator:** 1 join request')
    expect(md).toContain('| Menu \\| intake | active | presales | 1/2 | 3 (1 to review) |')
    expect(md).toContain('| Checkout | completed (concluded) | -- | -- | -- |')
    expect(md).toContain('- [x] Parser\n- [ ] Eval set')
    expect(md).toContain('- Knowledge base: Menus (pending review)')
    expect(md).toContain('4 domain objects, 2 workstreams, 1 pipeline link between workstreams, 3 workstream-object links.')
    expect(md).toContain('2 approval types configured -- 1 authority gap.')
    expect(md).toContain('- Check vendor API\n')
  })

  it('omits hidden status and curator-only counts, and handles an empty project', () => {
    const md = buildProjectSummaryMarkdown(
      {
        ...base,
        status: null,
        workstreams: [],
        knowledgeBases: [],
        wikiArticles: [],
        members: [],
        openNotes: [],
        governance: { approvalTypes: 0, authorityGaps: [] },
        ontology: { objects: 0, workstreams: 0, flowEdges: 0, objectLinks: 0 },
        pendingReview: undefined,
      },
      'now'
    )
    expect(md).not.toContain('**Status:**')
    expect(md).not.toContain('Waiting on a curator')
    expect(md).not.toContain('## Members')
    expect(md).toContain('No workstreams defined yet.')
    expect(md).toContain('No project-specific knowledge attached yet.')
    expect(md).toContain('No domain objects or workstream links modelled yet.')
    expect(md).toContain('No approval requirements configured.')
    expect(md).toContain('No open notes.')
  })
})
