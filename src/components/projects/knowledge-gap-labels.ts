import type { KnowledgeGapFailureKind, KnowledgeGapStatus } from '@/types/database'

export const FAILURE_KIND_LABELS: Record<KnowledgeGapFailureKind, string> = {
  wrong: 'Wrong',
  incomplete: 'Incomplete',
  outdated: 'Outdated',
  wrong_source: 'Cited the wrong source',
  could_not_answer: 'Could not answer',
}

export const FAILURE_KIND_OPTIONS = Object.entries(FAILURE_KIND_LABELS) as [KnowledgeGapFailureKind, string][]

export const GAP_STATUS_LABELS: Record<KnowledgeGapStatus, string> = {
  new: 'New',
  needs_source: 'Needs a source',
  wiki_needed: 'Wiki article needed',
  resolved: 'Resolved',
  out_of_scope: 'Out of scope',
  product_issue: 'Ember product issue',
  duplicate: 'Duplicate',
}

export const GAP_STATUS_STYLES: Record<KnowledgeGapStatus, string> = {
  new: 'bg-blue-100 text-blue-800',
  needs_source: 'bg-amber-100 text-amber-800',
  wiki_needed: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-800',
  out_of_scope: 'bg-zinc-100 text-zinc-600',
  product_issue: 'bg-purple-100 text-purple-800',
  duplicate: 'bg-zinc-100 text-zinc-600',
}
