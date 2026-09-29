import type { WorkstreamArtifactStatus } from '@/types/database'

// Workstream page / project page artifact overview: counts for the header
// and workstream list, review-first ordering, and a one-line preview so a
// collapsed artifact says what it is without being opened.

export interface ArtifactCounts {
  total: number
  awaitingReview: number
  approved: number
}

export function countArtifacts(artifacts: { status: WorkstreamArtifactStatus }[]): ArtifactCounts {
  return {
    total: artifacts.length,
    awaitingReview: artifacts.filter((a) => a.status === 'ready_for_review').length,
    approved: artifacts.filter((a) => a.status === 'approved').length,
  }
}

// e.g. "4 artifacts · 1 awaiting review"; null when there are none.
export function artifactCountLabel(counts: ArtifactCounts): string | null {
  if (counts.total === 0) return null
  const base = `${counts.total} ${counts.total === 1 ? 'artifact' : 'artifacts'}`
  return counts.awaitingReview > 0 ? `${base} · ${counts.awaitingReview} awaiting review` : base
}

// What needs someone's attention first; newest first within each status.
const STATUS_ORDER: Record<WorkstreamArtifactStatus, number> = {
  ready_for_review: 0,
  validation_failed: 1,
  draft: 2,
  approved: 3,
  rejected: 4,
}

export function sortArtifactsForReview<T extends { status: WorkstreamArtifactStatus; created_at: string }>(artifacts: T[]): T[] {
  return [...artifacts].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || b.created_at.localeCompare(a.created_at)
  )
}

const MAX_PREVIEW_CHARS = 140

// First meaningful text of the content, with the commonest Markdown
// syntax stripped -- a hint, not a rendering.
export function artifactPreview(content: string | null): string | null {
  if (!content) return null
  const text = content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, '')
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return null
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1).trimEnd()}…` : text
}
