import { describe, it, expect } from 'vitest'
import type { AgencyBuilderRow, AgencyDashboard } from '@/lib/workbench/agency-dashboard'
import { buildAgencySummaryMarkdown } from './agency-summary'

const builder: AgencyBuilderRow = {
  builderId: 'builder-1',
  email: 'b1@example.com',
  fullName: 'Bea Builder',
  isActive: true,
  agencyId: 'agency-1',
  pendingPromotions: [],
  lastActivityAt: '2026-09-20T00:00:00Z',
  attention: null,
  spend: null,
  rates: { platformRatePct: null, builderSharePct: null },
  clientProjects: [
    {
      id: 'p-acme',
      name: 'Acme | HR',
      status: 'active',
      category: 'foundation',
      clientViewerCount: 1,
      fee: { amount: 1000, currency: 'USD', period: 'monthly', platformRatePct: 10, builderSharePct: 10, monthlyAmount: 1000, platformMonthly: 100, builderMonthly: 100 },
      createdAt: '2026-09-10T00:00:00Z',
      workstreamCount: 2,
      activeWorkstreamCount: 1,
      workstreams: [
        { id: 'ws-1', name: 'Kickoff', status: 'completed', completion: { done: 1, total: 1, pct: 100 }, knowledgeBases: [] },
        { id: 'ws-2', name: 'Setup', status: 'active', completion: { done: 2, total: 3, pct: 67 }, knowledgeBases: ['Acme Data'] },
      ],
      knowledgeBases: ['HR Policies'],
      completion: { done: 3, total: 4, pct: 75 },
      lastActivityAt: '2026-09-20T00:00:00Z',
      latestUpdate: {
        workstreamName: 'Setup',
        currentStage: 'Importing',
        progress: 'Half the records in',
        nextStep: 'Finish import',
        helpRequested: null,
        confidence: 'on_track',
        updatedAt: '2026-09-20T00:00:00Z',
      },
    },
  ],
  proposals: [
    {
      workstreamId: 'ws-p',
      name: 'Globex',
      status: 'active',
      presentationStatus: 'review_open',
      promotionStatus: null,
      category: 'builder_lab',
      completion: { done: 1, total: 2, pct: 50 },
      knowledgeBases: ['Builder Playbook'],
      lastActivityAt: '2026-09-25T00:00:00Z',
      latestUpdate: null,
    },
  ],
}

const dashboard: AgencyDashboard = {
  viewerIsAdmin: false,
  platformRatePct: 10,
  builderSharePct: 10,
  agencies: [{ agencyId: 'agency-1', email: 'agency@example.com', fullName: 'North Agency', builders: [builder] }],
  unassigned: [],
  completionByCategory: [
    { category: 'foundation', clientProjectCount: 1, proposalCount: 0, workstreamCount: 2, completion: { done: 3, total: 4, pct: 75 } },
    { category: 'builder_lab', clientProjectCount: 0, proposalCount: 1, workstreamCount: 1, completion: { done: 1, total: 2, pct: 50 } },
  ],
  overallCompletion: { done: 4, total: 6, pct: 67 },
}

describe('buildAgencySummaryMarkdown', () => {
  const md = buildAgencySummaryMarkdown(dashboard, 'Oct 3, 2026, 9:00 AM')

  it('opens with totals, overall completion and fees', () => {
    expect(md).toContain('# My builders — summary')
    expect(md).toContain('_Generated Oct 3, 2026, 9:00 AM.')
    expect(md).toContain('- **Client projects:** 1, with 2 workstreams')
    expect(md).toContain('- **Overall completion:** 67% (4 of 6 items, client projects and proposals)')
    expect(md).toContain('- **Open proposals:** 1')
    expect(md).toMatch(/Maintenance fees \(USD\):\*\* \$1,000(\.00)?\/month, platform share \$100(\.00)?\/month/)
  })

  it('lists each client project with its workstreams, knowledge bases and completion', () => {
    expect(md).toContain('| Acme \\| HR | Foundation | Bea Builder | Working on it | 2 | 75% |')
    expect(md).toContain('#### Acme | HR')
    expect(md).toContain('**Project knowledge bases:** HR Policies')
    expect(md).toContain('| Kickoff | Completed | 100% | — |')
    expect(md).toContain('| Setup | In progress | 67% | Acme Data |')
    expect(md).toContain('**Latest update** (Setup): Importing (On track) — Half the records in — Next: Finish import')
  })

  it('breaks completion down by portfolio category', () => {
    expect(md).toContain('## Completion by category')
    expect(md).toContain('| Foundation | 1 | 0 | 2 | 75% (3 of 4) |')
    expect(md).toContain('| Builder Lab | 0 | 1 | 1 | 50% (1 of 2) |')
  })

  it("lists the builder's proposals with their stage", () => {
    expect(md).toContain('## North Agency')
    expect(md).toContain('### Bea Builder')
    expect(md).toContain('| Globex | Proposal in review | 50% | Builder Playbook | — |')
  })
})
