import type { PresentationStatus, WorkstreamPromotionStatus, WorkstreamStatus } from '@/types/database'

// Shared by the agency dashboard (AgencyDashboardView.tsx) and its
// downloadable summary (agency-summary.ts), so both say the same thing.

// Project status labels live in lib/projects/status-labels.ts, shared by
// every screen that shows a project's status (including "Live").
export { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from '@/lib/projects/status-labels'

export const WORKSTREAM_STATUS_LABELS: Record<WorkstreamStatus, string> = {
  draft: 'Draft',
  active: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
}

export const PRESENTATION_LABELS: Record<PresentationStatus, string> = {
  draft: 'Proposal drafted',
  review_open: 'Proposal in review',
  review_closed: 'Review closed',
  builder_revision: 'Revising proposal',
  curator_review: 'Proposal with curator',
  approved: 'Proposal approved',
}

export const PROMOTION_LABELS: Record<WorkstreamPromotionStatus, string> = {
  pending: 'Client project requested',
  approved: 'Client project created',
  rejected: 'Request declined',
}
export const PROMOTION_STYLES: Record<WorkstreamPromotionStatus, string> = {
  pending: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-zinc-200 text-zinc-600',
}

export const CONFIDENCE_LABELS: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' }
export const CONFIDENCE_STYLES: Record<string, string> = {
  on_track: 'bg-green-100 text-green-800',
  at_risk: 'bg-amber-100 text-amber-800',
  blocked: 'bg-red-100 text-red-800',
}

// A proposal's furthest stage: the client-project request if there is
// one, else its presentation, else the workstream status.
export function proposalStageLabel(p: {
  promotionStatus: WorkstreamPromotionStatus | null
  presentationStatus: PresentationStatus | null
  status: WorkstreamStatus
}): string {
  if (p.promotionStatus) return PROMOTION_LABELS[p.promotionStatus]
  if (p.presentationStatus) return PRESENTATION_LABELS[p.presentationStatus]
  return WORKSTREAM_STATUS_LABELS[p.status]
}
