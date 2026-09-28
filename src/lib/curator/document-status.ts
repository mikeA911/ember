import type { Document } from '@/types/database'
import type { SourceReviewCounts } from '@/lib/projects/queries'

// What the Status column says. A document's processing_status tracks its
// workflow stage, and approving every chunk (which is what makes it
// searchable) leaves it at 'review' -- only the optional "send to admin for
// sign-off" moves it on, to 'submitted', and an admin's sign-off to
// 'completed'. Showing that raw stage made a fully approved, fully
// searchable source look unfinished, so once parsing is done the badge
// follows the chunks instead, and sign-off is a secondary note.
export type RowStatus = { label: string; className: string; note?: string; needsReview: boolean }

const STAGE_LABELS: Partial<Record<Document['processing_status'], string>> = {
  pending: 'Queued',
  parsing: 'Processing…',
  chunking: 'Processing…',
  failed: 'Failed',
}

const SIGN_OFF_NOTES: Partial<Record<Document['processing_status'], string>> = {
  submitted: 'Awaiting admin sign-off',
  completed: 'Signed off by admin',
}

export function documentRowStatus(document: Document, counts: SourceReviewCounts | undefined): RowStatus {
  const stage = STAGE_LABELS[document.processing_status]
  if (stage) {
    const className = document.processing_status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-700'
    return { label: stage, className, needsReview: false }
  }
  const total = counts?.total ?? 0
  const approved = counts?.approved ?? 0
  const undecided = total - approved - (counts?.rejected ?? 0)
  const note = SIGN_OFF_NOTES[document.processing_status]
  if (total === 0) return { label: 'No chunks', className: 'bg-zinc-100 text-zinc-700', note, needsReview: false }
  if (undecided > 0) return { label: 'Needs review', className: 'bg-amber-100 text-amber-800', note, needsReview: true }
  if (approved > 0) return { label: 'Searchable', className: 'bg-emerald-100 text-emerald-800', note, needsReview: false }
  return { label: 'All chunks rejected', className: 'bg-zinc-200 text-zinc-700', note, needsReview: false }
}
