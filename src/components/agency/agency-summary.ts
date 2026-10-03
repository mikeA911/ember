import { inline } from '@/lib/projects/status-summary'
import type {
  AgencyBuilderRow,
  AgencyClientProjectRow,
  AgencyCompletion,
  AgencyDashboard,
  AgencySharedUpdate,
} from '@/lib/workbench/agency-dashboard'
import { formatMoney, monthlyTotals } from './money'
import { CONFIDENCE_LABELS, PROJECT_STATUS_LABELS, WORKSTREAM_STATUS_LABELS, proposalStageLabel } from './labels'

// Agency summary: the management dashboard (/agency) as a point-in-time
// Markdown document, opened and downloaded (Markdown or Word) the same way
// as the Project summary. Built only from what the dashboard already shows
// -- names, statuses, counts, completion and shared updates -- so it can't
// leak anything the dashboard itself keeps private. Pure, so it's
// unit-testable and can be built client-side at click time.

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`
}

function cell(text: string) {
  return inline(text).replace(/\|/g, '\\|')
}

export function completionLabel(c: AgencyCompletion): string {
  return c.pct === null ? '—' : `${c.pct}%`
}

function kbList(names: string[]) {
  return names.length > 0 ? names.map(inline).join(', ') : 'none'
}

function updateLine(u: AgencySharedUpdate) {
  const parts = [`${inline(u.currentStage)} (${CONFIDENCE_LABELS[u.confidence] ?? u.confidence})`, inline(u.progress), `Next: ${inline(u.nextStep)}`]
  if (u.helpRequested) parts.push(`**Help requested:** ${inline(u.helpRequested)}`)
  return parts.join(' — ')
}

function clientProjectLines(p: AgencyClientProjectRow): string[] {
  const facts = [PROJECT_STATUS_LABELS[p.status], `${completionLabel(p.completion)} complete`]
  if (p.fee) facts.push(`${formatMoney(p.fee.amount, p.fee.currency)} ${p.fee.period === 'annual' ? 'per year' : 'per month'}`)
  const lines = [`#### ${inline(p.name)}`, '', facts.join(' · '), '', `**Project knowledge bases:** ${kbList(p.knowledgeBases)}`, '']
  if (p.workstreams.length > 0) {
    lines.push('| Workstream | Status | Complete | Knowledge bases |', '| --- | --- | --- | --- |')
    for (const w of p.workstreams) {
      lines.push(
        `| ${cell(w.name)} | ${WORKSTREAM_STATUS_LABELS[w.status]} | ${completionLabel(w.completion)} | ${cell(w.knowledgeBases.join(', ') || '—')} |`
      )
    }
    lines.push('')
  } else {
    lines.push('_No workstreams yet._', '')
  }
  if (p.latestUpdate) lines.push(`**Latest update** (${inline(p.latestUpdate.workstreamName)}): ${updateLine(p.latestUpdate)}`, '')
  return lines
}

function builderLines(b: AgencyBuilderRow): string[] {
  const name = b.fullName || b.email || b.builderId
  const lines = [`### ${inline(name)}`, '']
  lines.push(
    `${plural(b.clientProjects.length, 'client project')} · ${plural(b.proposals.length, 'proposal')}${
      b.pendingPromotions.length > 0 ? ` · ${plural(b.pendingPromotions.length, 'client-project request')} waiting` : ''
    }${b.isActive ? '' : ' · inactive'}`,
    ''
  )
  for (const p of b.clientProjects) lines.push(...clientProjectLines(p))
  if (b.proposals.length > 0) {
    lines.push('#### Proposals', '', '| Proposal | Stage | Complete | Knowledge bases | Latest update |', '| --- | --- | --- | --- | --- |')
    for (const p of b.proposals) {
      lines.push(
        `| ${cell(p.name)} | ${proposalStageLabel(p)} | ${completionLabel(p.completion)} | ${cell(p.knowledgeBases.join(', ') || '—')} | ${
          p.latestUpdate ? cell(updateLine(p.latestUpdate)) : '—'
        } |`
      )
    }
    lines.push('')
  }
  return lines
}

export function buildAgencySummaryMarkdown(dashboard: AgencyDashboard, generatedAt: string): string {
  const sections = [
    ...dashboard.agencies.map((a) => ({ title: a.fullName || a.email || 'Agency', builders: a.builders })),
    ...(dashboard.unassigned.length > 0 ? [{ title: 'Not assigned to an agency', builders: dashboard.unassigned }] : []),
  ]
  const builders = sections.flatMap((s) => s.builders)
  const clientProjects = builders.flatMap((b) => b.clientProjects)
  const workstreams = clientProjects.flatMap((p) => p.workstreams)
  const openProposals = builders.flatMap((b) => b.proposals).filter((p) => p.promotionStatus !== 'approved')
  const done = clientProjects.reduce((n, p) => n + p.completion.done, 0)
  const total = clientProjects.reduce((n, p) => n + p.completion.total, 0)

  const lines = [
    `# ${dashboard.viewerIsAdmin ? 'Builder agencies' : 'My builders'} — summary`,
    '',
    `_Generated ${generatedAt}. Completion counts each workstream deliverable checked off; a workstream without a checklist counts once, when it's completed._`,
    '',
    '## Overview',
    '',
    `- **Builders:** ${builders.length}`,
    `- **Client projects:** ${clientProjects.length}, with ${plural(workstreams.length, 'workstream')}`,
    `- **Overall completion:** ${total > 0 ? `${Math.round((done / total) * 100)}% (${done} of ${total} items)` : '—'}`,
    `- **Open proposals:** ${openProposals.length}`,
  ]
  for (const [currency, t] of monthlyTotals(clientProjects.flatMap((p) => (p.fee ? [p.fee] : [])))) {
    lines.push(`- **Maintenance fees (${currency}):** ${formatMoney(t.clientMonthly, currency)}/month, platform share ${formatMoney(t.platformMonthly, currency)}/month`)
  }
  lines.push('')

  if (clientProjects.length > 0) {
    lines.push('## Client projects at a glance', '', '| Project | Builder | Status | Workstreams | Complete |', '| --- | --- | --- | --- | --- |')
    for (const b of builders) {
      for (const p of b.clientProjects) {
        lines.push(
          `| ${cell(p.name)} | ${cell(b.fullName || b.email || b.builderId)} | ${PROJECT_STATUS_LABELS[p.status]} | ${p.workstreams.length} | ${completionLabel(p.completion)} |`
        )
      }
    }
    lines.push('')
  }

  for (const section of sections) {
    lines.push(`## ${inline(section.title)}`, '')
    if (section.builders.length === 0) lines.push('_No builders assigned yet._', '')
    for (const b of section.builders) lines.push(...builderLines(b))
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}
