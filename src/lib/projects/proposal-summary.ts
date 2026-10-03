import { block, inline } from './status-summary'

// Proposal summary: a client-facing document for ONE workstream -- the
// builder's proposal to that client -- opened from the workstream page and
// downloaded (Markdown or Word) to send or present. Deliberately narrower
// than the Project summary (status-summary.ts), which covers a whole
// Project: in a builder's workspace that means every other client's
// workstreams, plus members, notes and governance gaps no client should
// see. Here: only this workstream's goal, deliverables, guardrails and its
// APPROVED artifacts -- the same "approved only" line workstream promotion
// draws when it copies work into the client's Project. Pure, like
// status-summary.ts, so it's testable and can be built at click time.

export interface ProposalSummaryInput {
  title: string
  preparedBy: string | null
  goal: string | null
  guardrail: string | null
  deliverables: { label: string; completed: boolean }[]
  artifacts: { title: string; typeLabel: string; content: string | null; externalUrl: string | null }[]
}

export function buildProposalSummaryMarkdown(input: ProposalSummaryInput, generatedAt: string): string {
  const lines: string[] = []
  const push = (...l: string[]) => lines.push(...l)

  push(`# ${inline(input.title)} -- proposal`, '')
  push(`_Prepared ${generatedAt}${input.preparedBy ? ` by ${inline(input.preparedBy)}` : ''}._`, '')

  push("## What we'll deliver", '')
  if (input.goal?.trim()) push(...block(input.goal))
  else push('The goal for this engagement is still being written.', '')

  if (input.deliverables.length > 0) {
    push('## Deliverables', '')
    for (const d of input.deliverables) push(`- ${inline(d.label)}${d.completed ? ' (ready)' : ''}`)
    push('')
  }

  if (input.guardrail?.trim()) push('## Scope and guardrails', '', ...block(input.guardrail))

  if (input.artifacts.length > 0) {
    push('## Supporting material', '')
    for (const a of input.artifacts) {
      push(`### ${inline(a.title)}`, '', `_${a.typeLabel}_`, '')
      if (a.content?.trim()) push(...block(a.content))
      if (a.externalUrl) push(`Link: ${a.externalUrl}`, '')
    }
  }

  push('## Next steps', '')
  push(
    input.preparedBy
      ? `To go ahead, or to talk anything through, reply to ${inline(input.preparedBy)}. Once you accept, we set up a project where you can follow the work as it happens.`
      : 'To go ahead, or to talk anything through, reply to whoever sent you this proposal. Once you accept, we set up a project where you can follow the work as it happens.',
    ''
  )

  return lines.join('\n').trimEnd() + '\n'
}
