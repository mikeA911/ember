'use client'

import { buildProjectSummaryMarkdown, type ProjectSummaryInput } from '@/lib/projects/status-summary'
import { SummaryDialogButton } from './SummaryDialogButton'

// The project page's summary (newcomer brief + current status).
export function ProjectSummaryButton({ summary }: { summary: ProjectSummaryInput }) {
  return (
    <SummaryDialogButton
      buttonLabel="Project summary"
      title="Project summary"
      description="A brief for anyone new to the project -- its goal, requirements, workstreams and where to learn more -- followed by where the work stands right now."
      filenameBase={summary.name}
      filenameSuffix="summary"
      build={(when) => buildProjectSummaryMarkdown(summary, when)}
    />
  )
}
