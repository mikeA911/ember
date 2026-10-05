import type {
  RequirementAppliesFrom,
  RequirementCategory,
  RequirementPriority,
  RequirementSourceKind,
  RequirementStatus,
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

export const options = <K extends string>(labels: Record<K, string>) => Object.entries(labels) as [K, string][]
