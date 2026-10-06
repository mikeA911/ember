import type {
  ArtifactType,
  ReverificationEventKind,
  BaselineStatus,
  ConformanceApprovalType,
  ConformanceDecisionType,
  ConformanceStatus,
  WaiverKind,
  RequirementAppliesFrom,
  RequirementCategory,
  RequirementPriority,
  RequirementSourceKind,
  RequirementStatus,
  RequirementVerificationStatus,
  VerificationEnvironment,
  VerificationResult,
  VerificationMethodKind,
  VerificationPerformer,
} from '@/types/database'

// Solution conformance, Stage 1: display labels for the requirements
// register, shared by server pages and client forms.

export const CATEGORY_LABELS: Record<RequirementCategory, string> = {
  functional: 'Functional',
  interface: 'Interface',
  performance: 'Performance',
  security: 'Security',
  privacy: 'Privacy',
  operational: 'Operational',
  regulatory: 'Regulatory',
  contractual: 'Contractual',
}

export const PRIORITY_LABELS: Record<RequirementPriority, string> = { must: 'Must', should: 'Should', could: 'Could' }

export const APPLIES_FROM_LABELS: Record<RequirementAppliesFrom, string> = {
  presales: 'Presales',
  deployment: 'Deployment',
  management_maintenance: 'Management & maintenance',
}

export const STATUS_LABELS: Record<RequirementStatus, string> = {
  draft: 'Draft',
  baselined: 'Baselined',
  superseded: 'Superseded',
  withdrawn: 'Withdrawn',
}

export const STATUS_STYLES: Record<RequirementStatus, string> = {
  draft: 'bg-amber-100 text-amber-800',
  baselined: 'bg-green-100 text-green-800',
  superseded: 'bg-zinc-100 text-zinc-500',
  withdrawn: 'bg-zinc-100 text-zinc-500',
}

export const SOURCE_KIND_LABELS: Record<RequirementSourceKind, string> = {
  standard: 'Standard',
  regulation: 'Regulation',
  contract: 'Contract',
  customer_need: 'Customer need',
  vendor_claim: 'Vendor claim (to verify)',
}

export const METHOD_LABELS: Record<VerificationMethodKind, string> = {
  test: 'Test',
  demonstration: 'Demonstration',
  inspection: 'Inspection',
  analysis: 'Analysis',
  vendor_evidence: 'Vendor evidence',
  operational_measure: 'Operational measure',
}

export const PERFORMER_LABELS: Record<VerificationPerformer, string> = {
  vendor: 'Vendor',
  integrator: 'Integrator',
  customer: 'Customer',
  independent_tester: 'Independent tester',
  project_team: 'Project team',
}

// Stage 2: verification records.
export const RESULT_LABELS: Record<VerificationResult, string> = {
  pass: 'Pass',
  fail: 'Fail',
  conditional_pass: 'Conditional pass',
  not_run: 'Not run',
  not_applicable: 'Not applicable',
}

export const RESULT_STYLES: Record<VerificationResult, string> = {
  pass: 'bg-green-100 text-green-800',
  fail: 'bg-red-100 text-red-800',
  conditional_pass: 'bg-amber-100 text-amber-800',
  not_run: 'bg-zinc-100 text-zinc-600',
  not_applicable: 'bg-zinc-100 text-zinc-600',
}

export const ENVIRONMENT_LABELS: Record<VerificationEnvironment, string> = {
  lab: 'Lab',
  factory: 'Factory (FAT)',
  staging: 'Staging',
  site: 'Site (SAT)',
  production: 'Production',
  vendor: 'Vendor facility',
  other: 'Other',
}

export const VERIFICATION_STATUS_LABELS: Record<RequirementVerificationStatus, string> = {
  no_method: 'No method',
  not_verified: 'Not verified',
  failed: 'Failed',
  passed: 'Passed',
  conditional: 'Conditional',
  not_applicable: 'Not applicable',
  partial: 'Partly verified',
}

export const VERIFICATION_STATUS_STYLES: Record<RequirementVerificationStatus, string> = {
  no_method: 'bg-amber-50 text-amber-800',
  not_verified: 'bg-zinc-100 text-zinc-600',
  failed: 'bg-red-100 text-red-800',
  passed: 'bg-green-100 text-green-800',
  conditional: 'bg-amber-100 text-amber-800',
  not_applicable: 'bg-zinc-100 text-zinc-600',
  partial: 'bg-blue-50 text-blue-800',
}

// Evidence artifacts, as named on the workstream page.
export const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  capability_inventory: 'Capability Inventory',
  endpoint_inventory: 'Endpoint Inventory',
  openapi_spec: 'OpenAPI Spec',
  mcp_server: 'MCP Server',
  evidence_map: 'Evidence Map',
  test_results: 'Test Results',
  findings: 'Findings',
  design_note: 'Design Note',
  implementation_handoff: 'Implementation Handoff',
  research_dossier: 'Research Dossier',
  other: 'Other',
}

// Stage 3: baselines, waivers and conformance decisions.
export const DECISION_TYPE_LABELS: Record<ConformanceDecisionType, string> = {
  presales_claim_validation: 'Presales claim validation',
  factory_acceptance: 'Factory acceptance',
  site_acceptance: 'Site acceptance',
  customer_acceptance: 'Customer acceptance',
  go_live: 'Go-live',
  post_change_reverification: 'Post-change re-verification',
}

export const CONFORMANCE_APPROVAL_LABELS: Record<ConformanceApprovalType, string> = {
  technical: 'Technical',
  security_compliance: 'Security & compliance',
  customer_acceptance: 'Customer acceptance',
  production_change: 'Production change',
}

// The approval type a decision usually needs; the curator can change it.
export const DEFAULT_APPROVAL_FOR_DECISION: Record<ConformanceDecisionType, ConformanceApprovalType> = {
  presales_claim_validation: 'technical',
  factory_acceptance: 'technical',
  site_acceptance: 'technical',
  customer_acceptance: 'customer_acceptance',
  go_live: 'production_change',
  post_change_reverification: 'production_change',
}

export const BASELINE_STATUS_LABELS: Record<BaselineStatus, string> = { draft: 'Draft', active: 'Active', superseded: 'Superseded' }

export const BASELINE_STATUS_STYLES: Record<BaselineStatus, string> = {
  draft: 'bg-amber-100 text-amber-800',
  active: 'bg-green-100 text-green-800',
  superseded: 'bg-zinc-100 text-zinc-500',
}

export const CONFORMANCE_STATUS_LABELS: Record<ConformanceStatus, string> = {
  pending: 'Pending',
  approved: 'Approved',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
}

export const CONFORMANCE_STATUS_STYLES: Record<ConformanceStatus, string> = {
  pending: 'bg-blue-50 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  withdrawn: 'bg-zinc-100 text-zinc-500',
}

export const WAIVER_KIND_LABELS: Record<WaiverKind, string> = { waiver: 'Waiver', deviation: 'Deviation' }

export const BASELINE_REQUIREMENT_STATUS_LABELS: Record<RequirementVerificationStatus | 'waived', string> = {
  ...VERIFICATION_STATUS_LABELS,
  waived: 'Waived',
}

export const BASELINE_REQUIREMENT_STATUS_STYLES: Record<RequirementVerificationStatus | 'waived', string> = {
  ...VERIFICATION_STATUS_STYLES,
  waived: 'bg-purple-100 text-purple-800',
}

// Stage 4: re-verification.
export const CHANGE_KIND_LABELS: Record<ReverificationEventKind, string> = {
  component_change: 'Component change',
  source_revision: 'New source version',
  threshold_breach: 'Outside threshold',
  other: 'Other change',
}

export const LINK_STATE_LABELS = { open: 'Needs re-verification', reverified: 'Re-verified', resolved: 'Resolved', closed: 'Requirement closed' } as const

export const LINK_STATE_STYLES = {
  open: 'bg-orange-100 text-orange-800',
  reverified: 'bg-green-100 text-green-800',
  resolved: 'bg-zinc-100 text-zinc-600',
  closed: 'bg-zinc-100 text-zinc-500',
} as const

export const REVERIFY_BADGE = 'bg-orange-100 text-orange-800'

export const options = <K extends string>(labels: Record<K, string>) => Object.entries(labels) as [K, string][]
