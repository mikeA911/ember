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

// contributor: invited to this Trigger's research (sees it, takes no stage actions).
// destination: a member of the department a handoff goes to (sees the
// package, not the research).
export type TriggerAccess = 'full' | 'contributor' | 'destination' | 'raiser' | 'summary'

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
  // Present for 'full' and 'contributor' access only.
  projectId?: string | null
  workstreamId?: string | null
  contributors?: TriggerContributor[]
}

export type TriggerContributor = { userId: string; name: string; departments: string; isMe?: boolean }

export type TriggerAction = {
  action: 'accept' | 'decline' | 'advance' | 'submit' | 'step_back' | 'withdraw' | 'revisit' | 'start_targeting' | 'archive' | 'unarchive'
  toStage: TriggerStage | null
  reasonRequired: boolean
}

export type TriggerHistoryEntry = {
  event:
    | 'raised'
    | 'stage_change'
    | 'archived'
    | 'unarchived'
    | 'contributor_added'
    | 'contributor_removed'
    | 'handoff_proposed'
    | 'handoff_withdrawn'
    | 'handoff_returned'
    | 'send_back_raised'
    | 'send_back_declined'
  fromStage: TriggerStage | null
  toStage: TriggerStage
  reason: string | null
  changedByName: string
  changedAt: string
}

export type TriggerDetail = TriggerSummary & {
  allowedActions: TriggerAction[]
  decisionInfo?: TriggerDecisionInfo
  handoffInfo?: TriggerHandoffInfo
  canManageContributors?: boolean
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
    case 'start_targeting':
      return 'Start Targeting'
    case 'archive':
      return 'Archive'
    case 'unarchive':
      return 'Unarchive'
  }
}

export type DecisionOutcome = 'approve' | 'revise' | 'defer' | 'reject'
export type DecisionRole = 'authority' | 'delegate' | 'platform_admin'

export const OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  approve: 'Approve',
  revise: 'Revise',
  defer: 'Defer',
  reject: 'Reject',
}

export type TriggerRecommendation = {
  by: string
  byMe: boolean
  recommendation: DecisionOutcome
  destination: string | null
  comments: string | null
  recordedAt: string
  current: boolean
}

export type TriggerDecision = {
  id: string
  outcome: DecisionOutcome
  destination: string | null
  returnToStage: TriggerStage | null
  rationale: string | null
  conditions?: string | null
  decidedBy?: string
  decidedAs?: DecisionRole
  decidedAt: string
  sharedWithRaiser?: boolean
  superseded: boolean
  supersededReason?: string | null
  evidence?: { id: string; title: string }[]
}

// Present for 'full' access (everything) and 'raiser' (decisions only).
export type TriggerDecisionInfo = {
  recommendations?: TriggerRecommendation[]
  decisions?: TriggerDecision[]
  canRecommend?: boolean
  canDecide?: boolean
  decideAs?: DecisionRole | null
  decisionBlockedReason?: string | null
  destinations?: { id: string; name: string }[]
}

export type DecisionSettings = {
  decider: { userId: string; name: string; isMe: boolean } | null
  delegate: { userId: string; name: string; isMe: boolean; from: string; until: string; activeToday: boolean } | null
  myRole: DecisionRole | null
  canSetDelegate: boolean
  candidates: { userId: string; name: string }[]
  waitingForMe: { code: string; title: string }[]
}

export const SEND_BACK_REASONS = {
  solution_inadequate: 'Solution inadequate',
  insufficient_evidence: 'Insufficient evidence',
  market_changed: 'Market changed',
  customer_feedback: 'Customer feedback',
  cost_or_risk_higher: 'Cost or risk higher than assessed',
} as const
export type SendBackReason = keyof typeof SEND_BACK_REASONS

export type TriggerHandoff = {
  id: string
  kind: 'promote' | 'send_back'
  status: 'proposed' | 'accepted' | 'returned' | 'withdrawn' | 'declined'
  destination: string
  destinationDepartmentId: string
  toStage: TriggerStage | null
  reasonCategory: SendBackReason | null
  downstreamAction: 'pause' | 'close' | null
  message: string | null
  conditions: string | null
  targetIndustries: string | null
  approvedClaims: string | null
  reason: string | null
  decisionReason: string | null
  proposedBy: string
  proposedAt: string
  decidedBy: string | null
  decidedAt: string | null
  destinationWorkstreamId: string | null
  workspaceProjectId: string | null
  items: { title: string; copiedArtifactId: string | null }[]
  candidates: CandidateSnapshot[]
  canDecide: boolean
  canWithdraw: boolean
}

export type TriggerHandoffInfo = {
  handoffs?: TriggerHandoff[]
  canPropose?: boolean
  proposeTo?: {
    departmentId: string
    name: string
    conditions: string | null
    requiresCandidates: boolean
    acceptedCandidates: number
  } | null
  canSendBack?: boolean
}

export type HandoffInbox = {
  toAnswer: { code: string; title: string; kind: 'promote' | 'send_back'; department: string }[]
  received: { code: string; title: string; department: string; acceptedAt: string; stage: TriggerStage }[]
}

export type CustomerBrief = {
  id: string
  name: string
  domain: string | null
  industry: string | null
  subIndustry: string | null
  group: string | null
  accountRep: string | null
  top1000: number | null
  bsp: number | null
}

export type CustomerListItem = CustomerBrief & { technologies: string[] }

export type CustomerDetail = CustomerBrief & {
  website: string | null
  mainPhone: string | null
  region: string | null
  parentId: string | null
  lifecycleStatus: string | null
  priority: 'low' | 'medium' | 'high' | null
  source: string
  archived: boolean
  canEdit: boolean
  canAssign: Record<'account_rep' | 'isr_owner' | 'account_owner', boolean>
  assignments: { role: 'account_rep' | 'isr_owner' | 'account_owner'; userId: string; name: string; from: string; to: string | null }[]
  rankings: { type: 'top1000' | 'bsp'; rank: number; asOf: string | null; source: string | null; reference: string | null; recordedBy: string; recordedAt: string }[]
  technologies: CustomerTechnology[]
  members: { id: string; name: string }[]
  triggers: { code: string; title: string; stage: TriggerStage; tier: CandidateTier; status: string }[]
  salesMembers: { userId: string; name: string; department: 'sales' | 'marketing' }[]
}

export const TECHNOLOGY_CATEGORIES = {
  virtualisation: 'Virtualisation',
  storage: 'Storage',
  backup_dr: 'Backup and DR',
  cloud: 'Cloud',
  network: 'Network',
  security: 'Security',
  database: 'Database',
  other: 'Other',
} as const
export type TechnologyCategory = keyof typeof TECHNOLOGY_CATEGORIES

export type CustomerTechnology = {
  id: string
  category: TechnologyCategory
  vendor: string
  product: string | null
  status: 'in_use' | 'evaluating' | 'replacing' | 'retired'
  suppliedBySandz: boolean
  scale: string | null
  renewalDate: string | null
  notes: string | null
}

export const CANDIDATE_TIERS = {
  existing_customer: 'Existing customer',
  related_company: 'Related company',
  new_prospect: 'New prospect',
} as const
export type CandidateTier = keyof typeof CANDIDATE_TIERS
export type SolutionFit = 'strong' | 'partial' | 'poor' | 'unknown'

export type CandidateSnapshot = CustomerBrief & {
  tier: CandidateTier
  solutionFit: SolutionFit
  fitRationale: string
  priority: 'low' | 'medium' | 'high' | null
  relationshipPath: string | null
  targetIndustry: string | null
  knownRelationships: string | null
}

export type CandidateCustomer = CandidateSnapshot & {
  candidateId: string
  evidenceReference: string | null
  status: 'proposed' | 'accepted' | 'removed'
  trimmedReason: string | null
  addedBy: string
  createdVia: 'manual' | 'assistant'
}

export type CandidateList = { canEdit: boolean; candidates: CandidateCustomer[] }

export type DuplicateMatch = { id: string; name: string; domain: string | null; reason: string; strength: 'blocking' | 'warning' | 'possible' }

// A change Ember proposed in a conversation, waiting for (or decided by)
// the person (20261110100001_sli_assistant_proposals.sql).
export type SliProposalKind = 'raise_trigger' | 'add_candidate' | 'create_customer' | 'record_recommendation' | 'save_notes'
export type SliProposal = {
  id: string
  kind: SliProposalKind
  summary: string
  payload: Record<string, unknown>
  status: 'proposed' | 'confirmed' | 'cancelled' | 'failed'
  result: { id?: string; code?: string; customerId?: string } | null
  error: string | null
  createdAt: string
  decidedAt: string | null
  triggerCode: string | null
}
