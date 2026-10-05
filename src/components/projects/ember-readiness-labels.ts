import type { ReadinessDisplayVerdict } from '@/lib/projects/ember-readiness'

export const READINESS_VERDICT_LABELS: Record<ReadinessDisplayVerdict, string> = {
  ready: 'Ready',
  needs_more_sources: 'Needs more sources',
  not_assessed: 'Not assessed',
}

export const READINESS_VERDICT_STYLES: Record<ReadinessDisplayVerdict, string> = {
  ready: 'bg-green-100 text-green-800',
  needs_more_sources: 'bg-amber-100 text-amber-800',
  not_assessed: 'bg-zinc-100 text-zinc-600',
}

export function formatReadinessDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
