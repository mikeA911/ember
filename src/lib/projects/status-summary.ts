import type { ArtifactCounts } from './artifact-summary'

// Project summary: a point-in-time, plain-Markdown document about a Project
// -- the text counterpart to the Ontology Map, opened from the same page
// header and downloadable the same way. Two parts in one document:
//   1. a brief for someone new to the project -- what it's for, its goal
//      and requirements, what each workstream is meant to deliver and within
//      what guardrails, the domain vocabulary, and where to learn more;
//   2. the current status for builders -- totals, per-workstream progress,
//      governance gaps and open notes.
// Pure (no React, no DOM, no server-only imports) so the project page can
// hand the already-fetched, already-RLS-scoped data to a client component
// that stamps and builds it at click time, and so the formatting is
// unit-testable on its own.

export interface ProjectSummaryWorkstream {
  name: string
  status: string
  lifecycleStage: string | null
  operationalStatus: string
  goal: string | null
  guardrail: string | null
  // Outcome summary -- what has come of it so far, distinct from the goal.
  outcome: string | null
  repositoryScope: string[]
  deliverables: { label: string; completed: boolean }[]
  artifacts: ArtifactCounts
  // Pipeline order and domain objects, from the Ontology Map's own data.
  dependsOn: string[]
  feedsInto: string[]
  objects: { name: string; accessModes: string[] }[]
}

export interface ProjectSummaryInput {
  name: string
  typeLabel: string
  // null when the viewer isn't shown the status (a draft they can't approve),
  // same rule as the page's own status badge.
  status: string | null
  objective: string | null
  goal: string | null
  // Project.details -- type-specific requirements (hypothesis,
  // success_criteria, business_problem, ...). No schema, so any JSON value.
  details: Record<string, unknown>
  // Project.notes -- the free-text findings shown on the project page.
  findings: string | null
  starterPrompt: string | null
  members: { email: string | null; role: string }[]
  workstreams: ProjectSummaryWorkstream[]
  // The domain-object tree (project_objects).
  objects: { id: string; name: string; parentId: string | null }[]
  knowledgeBases: { name: string; status?: string }[]
  wikiArticles: string[]
  evalDatasets: { name: string; status: string }[]
  governance: { approvalTypes: number; authorityGaps: string[] }
  ontology: { flowEdges: number; objectLinks: number }
  openNotes: { subject: string; authorEmail: string | null }[]
  // Only for viewers who can act on them (curator+); omitted otherwise.
  pendingReview?: { joinRequests: number; sourceSubmissions: number; workstreamPromotions: number }
}

function humanize(value: string) {
  return value.replace(/_/g, ' ')
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
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

// Free text that is often already Markdown (goals, guardrails, findings) --
// kept as-is except that its own headings become bold lines, so they can't
// break this document's heading structure.
function block(text: string): string[] {
  return [...text.trim().split('\n').map((line) => line.replace(/^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/, '**$1**')), '']
}

function isEmpty(value: unknown) {
  return (
    value === null ||
    value === undefined ||
    value === '' ||
    (Array.isArray(value) && value.length === 0) ||
    (typeof value === 'object' && !Array.isArray(value) && Object.keys(value as object).length === 0)
  )
}

function valueText(value: unknown): string {
  if (typeof value === 'string') return inline(value)
  if (Array.isArray(value) && value.every((v) => typeof v !== 'object' || v === null)) return value.map(String).join(', ')
  return JSON.stringify(value)
}

// One Project.details entry, whatever JSON shape a curator gave it.
function detailLines(key: string, value: unknown): string[] {
  const label = capitalize(humanize(key))
  if (typeof value === 'string' && !value.includes('\n')) return [`**${label}:** ${value.trim()}`, '']
  if (typeof value === 'string') return [`**${label}:**`, '', ...block(value)]
  if (Array.isArray(value)) return [`**${label}:**`, '', ...value.map((v) => `- ${valueText(v)}`), '']
  if (typeof value === 'object' && value !== null) {
    return [
      `**${label}:**`,
      '',
      ...Object.entries(value)
        .filter(([, v]) => !isEmpty(v))
        .map(([k, v]) => `- **${capitalize(humanize(k))}:** ${valueText(v)}`),
      '',
    ]
  }
  return [`**${label}:** ${String(value)}`, '']
}

// The domain-object tree as a nested list; anything unreachable from a root
// (a cycle, or a parent that isn't visible) is listed at the top level.
function objectTreeLines(objects: ProjectSummaryInput['objects']): string[] {
  const ids = new Set(objects.map((o) => o.id))
  const children = new Map<string | null, ProjectSummaryInput['objects']>()
  for (const o of objects) {
    const parent = o.parentId && ids.has(o.parentId) ? o.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), o])
  }
  const lines: string[] = []
  const seen = new Set<string>()
  const walk = (o: ProjectSummaryInput['objects'][number], depth: number) => {
    if (seen.has(o.id)) return
    seen.add(o.id)
    lines.push(`${'  '.repeat(depth)}- ${inline(o.name)}`)
    for (const c of children.get(o.id) ?? []) walk(c, depth + 1)
  }
  for (const root of children.get(null) ?? []) walk(root, 0)
  for (const o of objects) walk(o, 0)
  return lines
}

function workstreamStatus(w: ProjectSummaryWorkstream) {
  return w.operationalStatus === 'concluded' ? `${humanize(w.status)} (concluded)` : humanize(w.status)
}

export function buildProjectSummaryMarkdown(input: ProjectSummaryInput, generatedAt: string): string {
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(`# ${inline(input.name)} -- project summary`, '')
  push(`_Generated ${generatedAt}. A snapshot -- the live project may have changed since._`, '')
  push('Part 1 is a brief for anyone new to the project. Part 2 is where the work stands right now.', '')

  // ---------------------------------------------------------------- Part 1
  push('## Part 1 -- Project brief', '')

  push('### What this project is for', '')
  push(`**Type:** ${input.typeLabel}`, '')
  if (input.objective) push(...block(input.objective))
  else push('No objective written yet.', '')

  if (input.goal) push('### Goal and approach', '', ...block(input.goal))

  const details = Object.entries(input.details).filter(([, v]) => !isEmpty(v))
  if (details.length > 0) {
    push('### Requirements and success criteria', '')
    for (const [k, v] of details) push(...detailLines(k, v))
  }

  push('### Workstreams', '')
  if (input.workstreams.length === 0) {
    push('No workstreams defined yet.', '')
  } else {
    push(`The work is split into ${plural(input.workstreams.length, 'workstream')}:`, '')
    for (const w of input.workstreams) {
      push(`#### ${inline(w.name)}`, '')
      push(`_${capitalize(workstreamStatus(w))}${w.lifecycleStage ? ` · ${humanize(w.lifecycleStage)}` : ''}_`, '')
      if (w.goal) push('**Goal:**', '', ...block(w.goal))
      if (w.guardrail) push('**Guardrails:**', '', ...block(w.guardrail))
      if (w.repositoryScope.length > 0) push(`**Scope:** ${w.repositoryScope.map((r) => `\`${r}\``).join(', ')}`, '')
      if (w.deliverables.length > 0) {
        push('**Deliverables:**', '')
        for (const d of w.deliverables) push(`- [${d.completed ? 'x' : ' '}] ${inline(d.label)}`)
        push('')
      }
      if (w.dependsOn.length > 0) push(`**Depends on:** ${w.dependsOn.map(inline).join(', ')}`, '')
      if (w.feedsInto.length > 0) push(`**Feeds into:** ${w.feedsInto.map(inline).join(', ')}`, '')
      if (w.objects.length > 0) {
        push(
          `**Works with:** ${w.objects
            .map((o) => (o.accessModes.length > 0 ? `${inline(o.name)} (${o.accessModes.join(', ')})` : inline(o.name)))
            .join(', ')}`,
          ''
        )
      }
      if (w.outcome) push('**Outcome so far:**', '', ...block(w.outcome))
    }
  }

  if (input.objects.length > 0) {
    push('### Key concepts', '', "The domain objects this project's work is about:", '')
    push(...objectTreeLines(input.objects), '')
  }

  if (input.findings?.trim()) push('### Findings so far', '', ...block(input.findings))

  push('### Where to learn more', '')
  const sources = [
    ...input.knowledgeBases.map((kb) => `- Knowledge base: ${inline(kb.name)}${kb.status === 'pending' ? ' (pending review)' : ''}`),
    ...input.wikiArticles.map((a) => `- Wiki: ${inline(a)}`),
    ...input.evalDatasets.map((d) => `- Benchmark: ${inline(d.name)} (${humanize(d.status)})`),
  ]
  push(...(sources.length > 0 ? sources : ['No project-specific knowledge attached yet.']), '')

  const contacts = input.members.filter((m) => m.role === 'owner' || m.role === 'curator')
  if (contacts.length > 0) {
    push('### Who to ask', '')
    for (const m of contacts) push(`- ${m.email ?? 'Unknown'} (${m.role})`)
    push('')
  }

  if (input.starterPrompt?.trim()) {
    push('### Getting started', '', 'A good first question to ask Ember about this project:', '', `> ${inline(input.starterPrompt)}`, '')
  }

  // ---------------------------------------------------------------- Part 2
  push('## Part 2 -- Current status', '')

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

  push('### At a glance', '')
  if (input.status) push(`- **Project status:** ${humanize(input.status)}`)
  push(`- **Members:** ${input.members.length}`)
  push(
    `- **Workstreams:** ${input.workstreams.length}` +
      (byStatus.size > 0 ? ` (${[...byStatus].map(([s, n]) => `${n} ${humanize(s)}`).join(', ')})` : '')
  )
  if (deliverables.length > 0) {
    push(`- **Deliverables:** ${deliverablesDone}/${deliverables.length} complete (${Math.round((deliverablesDone / deliverables.length) * 100)}%)`)
  }
  push(`- **Artifacts:** ${artifacts.total} (${artifacts.approved} approved, ${artifacts.awaitingReview} awaiting review)`)
  push(
    `- **Ontology:** ${plural(input.objects.length, 'domain object')}, ${plural(input.ontology.flowEdges, 'pipeline link')}, ${plural(
      input.ontology.objectLinks,
      'workstream-object link'
    )}`
  )
  push(
    `- **Governance:** ` +
      (input.governance.approvalTypes === 0
        ? 'no approval requirements configured'
        : `${plural(input.governance.approvalTypes, 'approval type')} configured` +
          (input.governance.authorityGaps.length > 0 ? ` -- authority gaps: ${input.governance.authorityGaps.map(humanize).join(', ')}` : ''))
  )
  push(`- **Open notes:** ${input.openNotes.length}`)
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

  if (input.workstreams.length > 0) {
    push('### Workstream progress', '')
    push('| Workstream | Status | Stage | Deliverables | Artifacts |', '| --- | --- | --- | --- | --- |')
    for (const w of input.workstreams) {
      const done = w.deliverables.filter((d) => d.completed).length
      const artifactsCell =
        w.artifacts.total === 0 ? '--' : `${w.artifacts.total}` + (w.artifacts.awaitingReview > 0 ? ` (${w.artifacts.awaitingReview} to review)` : '')
      push(
        `| ${cell(w.name)} | ${workstreamStatus(w)} | ${w.lifecycleStage ? humanize(w.lifecycleStage) : '--'} | ${
          w.deliverables.length === 0 ? '--' : `${done}/${w.deliverables.length}`
        } | ${artifactsCell} |`
      )
    }
    push('')
  }

  push('### Open notes', '')
  if (input.openNotes.length === 0) push('No open notes.')
  for (const n of input.openNotes) push(`- ${inline(n.subject)}${n.authorEmail ? ` (${n.authorEmail})` : ''}`)
  push('')

  if (input.members.length > 0) {
    push('### Members', '')
    for (const m of input.members) push(`- ${m.email ?? 'Unknown'} -- ${m.role}`)
    push('')
  }

  return lines.join('\n').trimEnd() + '\n'
}
