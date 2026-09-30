import type { ArtifactCounts } from './artifact-summary'

// Project summary: a point-in-time, plain-Markdown status report of a
// Project -- the text counterpart to the Ontology Map, opened from the same
// page header and downloadable the same way. Pure (no React, no DOM, no
// server-only imports) so the project page can hand the already-fetched,
// already-RLS-scoped data to a client component that stamps and builds it at
// click time, and so the formatting is unit-testable on its own.

export interface ProjectSummaryWorkstream {
  name: string
  status: string
  lifecycleStage: string | null
  operationalStatus: string
  goal: string | null
  deliverables: { label: string; completed: boolean }[]
  artifacts: ArtifactCounts
}

export interface ProjectSummaryInput {
  name: string
  typeLabel: string
  // null when the viewer isn't shown the status (a draft they can't approve),
  // same rule as the page's own status badge.
  status: string | null
  objective: string | null
  goal: string | null
  members: { email: string | null; role: string }[]
  workstreams: ProjectSummaryWorkstream[]
  knowledgeBases: { name: string; status?: string }[]
  wikiArticles: string[]
  evalDatasets: { name: string; status: string }[]
  governance: { approvalTypes: number; authorityGaps: string[] }
  ontology: { objects: number; workstreams: number; flowEdges: number; objectLinks: number }
  openNotes: { subject: string; authorEmail: string | null }[]
  // Only for viewers who can act on them (curator+); omitted otherwise.
  pendingReview?: { joinRequests: number; sourceSubmissions: number; workstreamPromotions: number }
}

function humanize(value: string) {
  return value.replace(/_/g, ' ')
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

// Collapse free text onto one line so it can't break a list item or table.
function inline(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function cell(text: string) {
  return inline(text).replace(/\|/g, '\\|')
}

export function buildProjectSummaryMarkdown(input: ProjectSummaryInput, generatedAt: string): string {
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(`# ${inline(input.name)} -- project summary`, '')
  push(`_Generated ${generatedAt}. A snapshot -- the live project may have changed since._`, '')

  push('## Overview', '')
  push(`- **Type:** ${input.typeLabel}`)
  if (input.status) push(`- **Status:** ${humanize(input.status)}`)
  if (input.objective) push(`- **Objective:** ${inline(input.objective)}`)
  if (input.goal) push(`- **Goal:** ${inline(input.goal)}`)
  push(`- **Members:** ${input.members.length}`)
  push('')

  // At-a-glance totals across every workstream.
  const deliverables = input.workstreams.flatMap((w) => w.deliverables)
  const deliverablesDone = deliverables.filter((d) => d.completed).length
  const artifacts = input.workstreams.reduce(
    (acc, w) => ({
      total: acc.total + w.artifacts.total,
      awaitingReview: acc.awaitingReview + w.artifacts.awaitingReview,
      approved: acc.approved + w.artifacts.approved,
    }),
    { total: 0, awaitingReview: 0, approved: 0 }
  )
  const byStatus = new Map<string, number>()
  for (const w of input.workstreams) byStatus.set(w.status, (byStatus.get(w.status) ?? 0) + 1)

  push('## At a glance', '')
  push(
    `- **Workstreams:** ${input.workstreams.length}` +
      (byStatus.size > 0 ? ` (${[...byStatus].map(([s, n]) => `${n} ${humanize(s)}`).join(', ')})` : '')
  )
  if (deliverables.length > 0) {
    push(`- **Deliverables:** ${deliverablesDone}/${deliverables.length} complete (${Math.round((deliverablesDone / deliverables.length) * 100)}%)`)
  }
  push(`- **Artifacts:** ${artifacts.total} (${artifacts.approved} approved, ${artifacts.awaitingReview} awaiting review)`)
  push(`- **Open notes:** ${input.openNotes.length}`)
  if (input.governance.authorityGaps.length > 0) {
    push(`- **Authority gaps:** ${input.governance.authorityGaps.map(humanize).join(', ')}`)
  }
  if (input.pendingReview) {
    const { joinRequests, sourceSubmissions, workstreamPromotions } = input.pendingReview
    const items = [
      joinRequests > 0 && plural(joinRequests, 'join request'),
      sourceSubmissions > 0 && plural(sourceSubmissions, 'source submission'),
      workstreamPromotions > 0 && plural(workstreamPromotions, 'workstream promotion'),
    ].filter(Boolean)
    if (items.length > 0) push(`- **Waiting on a curator:** ${items.join(', ')}`)
  }
  push('')

  push('## Workstreams', '')
  if (input.workstreams.length === 0) {
    push('No workstreams defined yet.', '')
  } else {
    push('| Workstream | Status | Stage | Deliverables | Artifacts |', '| --- | --- | --- | --- | --- |')
    for (const w of input.workstreams) {
      const done = w.deliverables.filter((d) => d.completed).length
      const status = w.operationalStatus === 'concluded' ? `${humanize(w.status)} (concluded)` : humanize(w.status)
      const artifactsCell =
        w.artifacts.total === 0 ? '--' : `${w.artifacts.total}` + (w.artifacts.awaitingReview > 0 ? ` (${w.artifacts.awaitingReview} to review)` : '')
      push(
        `| ${cell(w.name)} | ${status} | ${w.lifecycleStage ? humanize(w.lifecycleStage) : '--'} | ${
          w.deliverables.length === 0 ? '--' : `${done}/${w.deliverables.length}`
        } | ${artifactsCell} |`
      )
    }
    push('')
    for (const w of input.workstreams) {
      if (!w.goal && w.deliverables.length === 0) continue
      push(`### ${inline(w.name)}`, '')
      if (w.goal) push(`**Goal:** ${inline(w.goal)}`, '')
      for (const d of w.deliverables) push(`- [${d.completed ? 'x' : ' '}] ${inline(d.label)}`)
      if (w.deliverables.length > 0) push('')
    }
  }

  push('## Knowledge', '')
  if (input.knowledgeBases.length === 0 && input.wikiArticles.length === 0) {
    push('No project-specific knowledge attached yet.')
  }
  for (const kb of input.knowledgeBases) push(`- Knowledge base: ${inline(kb.name)}${kb.status === 'pending' ? ' (pending review)' : ''}`)
  for (const a of input.wikiArticles) push(`- Wiki: ${inline(a)}`)
  push('')

  push('## Ontology', '')
  const o = input.ontology
  push(
    o.objects === 0 && o.flowEdges === 0 && o.objectLinks === 0
      ? 'No domain objects or workstream links modelled yet.'
      : `${plural(o.objects, 'domain object')}, ${plural(o.workstreams, 'workstream')}, ${plural(o.flowEdges, 'pipeline link')} between workstreams, ${plural(o.objectLinks, 'workstream-object link')}.`,
    ''
  )

  push('## Evals', '')
  if (input.evalDatasets.length === 0) push('No benchmark attached yet.')
  for (const d of input.evalDatasets) push(`- ${inline(d.name)} (${humanize(d.status)})`)
  push('')

  push('## Governance', '')
  push(
    input.governance.approvalTypes === 0
      ? 'No approval requirements configured.'
      : `${plural(input.governance.approvalTypes, 'approval type')} configured` +
          (input.governance.authorityGaps.length > 0 ? ` -- ${plural(input.governance.authorityGaps.length, 'authority gap')}.` : '.'),
    ''
  )

  push('## Open notes', '')
  if (input.openNotes.length === 0) push('No open notes.')
  for (const n of input.openNotes) push(`- ${inline(n.subject)}${n.authorEmail ? ` (${n.authorEmail})` : ''}`)
  push('')

  if (input.members.length > 0) {
    push('## Members', '')
    for (const m of input.members) push(`- ${m.email ?? 'Unknown'} -- ${m.role}`)
    push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}
