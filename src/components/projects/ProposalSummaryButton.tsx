'use client'

import { buildProposalSummaryMarkdown, type ProposalSummaryInput } from '@/lib/projects/proposal-summary'
import { SummaryDialogButton } from './SummaryDialogButton'

// One workstream's client-facing proposal -- see proposal-summary.ts for
// what it deliberately leaves out.
export function ProposalSummaryButton({ proposal }: { proposal: ProposalSummaryInput }) {
  return (
    <SummaryDialogButton
      buttonLabel="Proposal summary"
      title="Proposal summary"
      description="For the client: this workstream's goal, deliverables, guardrails and approved artifacts only -- nothing from your other workstreams, notes or drafts."
      filenameBase={proposal.title}
      filenameSuffix="proposal"
      build={(when) => buildProposalSummaryMarkdown(proposal, when)}
      wordDownload
    />
  )
}
