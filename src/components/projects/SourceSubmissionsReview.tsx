'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveSourceSubmissionAction, rejectSourceSubmissionAction } from '@/app/actions/source-submissions'

export interface SourceSubmissionRow {
  id: string
  title: string
  sourceKind: 'file' | 'artifact' | 'working_knowledge'
  submitterEmail: string
  createdAt: string
}

const SOURCE_KIND_LABEL: Record<SourceSubmissionRow['sourceKind'], string> = {
  file: 'File',
  artifact: 'Workstream artifact',
  // KB Sandbox Builder MVP -- a builder's own promoted notebook.
  working_knowledge: 'Working Knowledge notebook',
}

// Visible only to the project's owner/curator/admin (canCurateProject on the
// Project page, matching can_curate_project -- see
// project_source_submissions_decide_curator RLS). Same startTransition/
// try-catch/router.refresh() shape as AccessRequestDecisionActions.tsx.
export function SourceSubmissionsReview({ projectId, submissions }: { projectId: string; submissions: SourceSubmissionRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Approval processes the source and embeds every chunk before returning --
  // it can take a while, so say so (and keep both buttons disabled) rather
  // than leave the curator wondering whether the click registered.
  const [approvingId, setApprovingId] = useState<string | null>(null)

  function approve(submissionId: string) {
    setError(null)
    setApprovingId(submissionId)
    startTransition(async () => {
      try {
        const result = await approveSourceSubmissionAction(projectId, submissionId)
        if (!result.ok) setError(result.error)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setApprovingId(null)
      }
    })
  }

  function reject(submissionId: string) {
    const reason = prompt('Reason for rejecting this source? (optional)')
    if (reason === null) return
    setError(null)
    startTransition(async () => {
      try {
        await rejectSourceSubmissionAction(projectId, submissionId, reason || undefined)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  if (submissions.length === 0) return null

  return (
    <div className="flex flex-col gap-2 rounded border border-amber-300 bg-amber-50 p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-900">Pending sources ({submissions.length})</h3>
      <ul className="flex flex-col gap-2">
        {submissions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-2 rounded border border-amber-200 bg-white p-2 text-sm">
            <div>
              <div className="font-medium">{s.title}</div>
              <div className="text-xs text-zinc-500">
                {SOURCE_KIND_LABEL[s.sourceKind]} · submitted by {s.submitterEmail}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => approve(s.id)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {approvingId === s.id ? 'Approving…' : 'Approve'}
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => reject(s.id)}
                className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      {approvingId && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-amber-200 bg-white px-3 py-2 text-sm text-amber-900">
          <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-800" />
          Approving -- processing the source and embedding its chunks. This can take a minute; please don&apos;t click again or leave the page.
        </p>
      )}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
