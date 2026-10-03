'use client'

import type { AgencyDashboard } from '@/lib/workbench/agency-dashboard'
import { SummaryDialogButton } from '@/components/projects/SummaryDialogButton'
import { buildAgencySummaryMarkdown } from './agency-summary'

// The agency dashboard as a document to present or send -- same dialog,
// copy and Markdown/Word download as the Project summary.
export function AgencySummaryButton({ dashboard }: { dashboard: AgencyDashboard }) {
  return (
    <SummaryDialogButton
      buttonLabel="Agency summary"
      title="Agency summary"
      description="Every client project with its workstreams, knowledge bases and completion, plus each builder's open proposals -- the same names, statuses and shared updates as this dashboard, nothing private to the builders."
      filenameBase={dashboard.viewerIsAdmin ? 'builder-agencies' : 'my-builders'}
      filenameSuffix="summary"
      build={(when) => buildAgencySummaryMarkdown(dashboard, when)}
      wordDownload
    />
  )
}
