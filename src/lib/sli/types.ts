// DTOs returned by the SLI database functions
// (supabase/migrations/20261101100001_sli_organizations_and_departments.sql,
// 20261101100002_sli_triggers.sql).

export type SliDepartment = {
  id: string
  code: string
  name: string
  role: 'lead' | 'member'
  canSponsor: boolean
  isDiscoveryTeam: boolean
}

export type SliContext = {
  organizationId: string
  organizationName: string
  productName: string
  byline: string
  triggerVisibility: 'own' | 'all_members'
  isMember: boolean
  isDepartmentMember: boolean
  isDiscoveryMember: boolean
  canSponsor: boolean
  isPlatformAdmin: boolean
  departments: SliDepartment[]
}

export const TRIGGER_STAGES = [
  'new',
  'researching',
  'concept',
  'feasibility',
  'under_review',
  'approved',
  'targeting',
  'promoted',
  'deferred',
  'declined',
  'rejected',
] as const
export type TriggerStage = (typeof TRIGGER_STAGES)[number]

export const STAGE_LABELS: Record<TriggerStage, string> = {
  new: 'New',
  researching: 'Researching',
  concept: 'Concept',
  feasibility: 'Feasibility',
  under_review: 'Under review',
  approved: 'Approved',
  targeting: 'Targeting',
  promoted: 'Promoted',
  deferred: 'Deferred',
  declined: 'Declined',
  rejected: 'Rejected',
}

// The Discovery board's columns, in lifecycle order. Closed outcomes
// (declined, rejected) and shelved Triggers (deferred) sit below the board.
export const BOARD_STAGES: TriggerStage[] = ['new', 'researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting', 'promoted']
export const SHELF_STAGES: TriggerStage[] = ['deferred', 'declined', 'rejected']

export type TriggerAccess = 'full' | 'raiser' | 'summary'

export type TriggerSummary = {
  id: string
  code: string
  title: string
  triggerType: string
  triggerTypeLabel: string | null
  stage: TriggerStage
  priority: 'low' | 'normal' | 'high'
  raisedByName: string
  raisedByMe: boolean
  sponsorName: string | null
  sponsoredByMe: boolean
  sourceDepartment: string | null
  archived: boolean
  createdAt: string
  updatedAt: string
  access: TriggerAccess
  // Present for 'full' and 'raiser' access only.
  summary?: string
  eventDate?: string | null
  eventReference?: string | null
  strategicObjective?: string | null
  informationSensitivity?: string
  archivedAt?: string | null
  archiveReason?: string | null
}

export type TriggerAction = {
  action: 'accept' | 'decline' | 'advance' | 'submit' | 'step_back' | 'withdraw' | 'revisit' | 'archive' | 'unarchive'
  toStage: TriggerStage | null
  reasonRequired: boolean
}

export type TriggerHistoryEntry = {
  event: 'raised' | 'stage_change' | 'archived' | 'unarchived'
  fromStage: TriggerStage | null
  toStage: TriggerStage
  reason: string | null
  changedByName: string
  changedAt: string
}

export type TriggerDetail = TriggerSummary & {
  allowedActions: TriggerAction[]
  history: TriggerHistoryEntry[]
}

export type TriggerType = { code: string; label: string }

export function actionLabel(a: TriggerAction): string {
  const to = a.toStage ? STAGE_LABELS[a.toStage] : ''
  switch (a.action) {
    case 'accept':
      return 'Accept and sponsor'
    case 'decline':
      return 'Decline'
    case 'advance':
      return `Move to ${to}`
    case 'submit':
      return 'Submit for review'
    case 'step_back':
      return `Back to ${to}`
    case 'withdraw':
      return `Withdraw to ${to}`
    case 'revisit':
      return `Revisit in ${to}`
    case 'archive':
      return 'Archive'
    case 'unarchive':
      return 'Unarchive'
  }
}
