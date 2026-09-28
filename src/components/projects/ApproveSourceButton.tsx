'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveRemainingChunksAction } from '@/app/actions/curator'

// One-click approval of a whole source from the project page's Knowledge
// list, for sources a curator trusts wholesale (e.g. an export from an
// ontology tool) without reading every chunk. Same action as the review
// page's "Approve all remaining": approves and embeds every chunk not
// already approved or rejected. Rendered only for platform curators/admins,
// which the action itself also enforces.
export function ApproveSourceButton({ documentId, title, remaining }: { documentId: string; title: string; remaining: number }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function approveAll() {
    const confirmed = window.confirm(
      `Approve all ${remaining} remaining chunk${remaining === 1 ? '' : 's'} of "${title}" without reviewing them one by one? They'll be embedded and become searchable by the Assistant. You can still reject individual chunks later from its Review page.`
    )
    if (!confirmed) return
    setError(null)
    startTransition(async () => {
      const result = await approveRemainingChunksAction(documentId)
      if (!result.ok) setError(result.error)
      router.refresh()
    })
  }

  return (
    <>
      <button
        type="button"
        onClick={approveAll}
        disabled={isPending}
        className="ml-2 rounded bg-green-700 px-2 py-0.5 text-[11px] font-medium text-white disabled:opacity-50"
      >
        {isPending ? `Approving ${remaining}…` : 'Approve all'}
      </button>
      {isPending && (
        // Block-level so it drops onto its own line under the source, where
        // it can't be missed -- embedding runs one chunk at a time, so a big
        // source takes a minute or more with nothing else moving on screen.
        <span
          role="status"
          aria-live="polite"
          className="mt-1.5 flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
        >
          <span aria-hidden="true" className="inline-block h-3 w-3 shrink-0 animate-spin rounded-full border-2 border-amber-300 border-t-amber-800" />
          Approving {remaining} chunk{remaining === 1 ? '' : 's'} of &ldquo;{title}&rdquo; -- embedding each one. This can take a
          minute or two; please keep this page open until it finishes.
        </span>
      )}
      {error && (
        <span role="alert" className="ml-2 text-[11px] text-red-600">
          {error}
        </span>
      )}
    </>
  )
}
