'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveProjectCreationAction, rejectProjectCreationAction } from '@/app/actions/project-approval'

// Approve / Reject (with a required reason) for one pending project --
// shared by the dashboard's approval queue and the project page's banner.
export function ProjectApprovalDecision({ projectId, projectName }: { projectId: string; projectName: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {rejecting ? (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (reason.trim()) run(() => rejectProjectCreationAction(projectId, reason))
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={`Why isn't ${projectName} approved?`}
            className="min-w-0 flex-1 rounded border border-zinc-300 px-3 py-1.5 text-sm"
          />
          <button disabled={isPending || !reason.trim()} className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Reject
          </button>
          <button type="button" disabled={isPending} onClick={() => setRejecting(false)} className="text-sm underline disabled:opacity-50">
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex gap-2">
          <button
            disabled={isPending}
            onClick={() => run(() => approveProjectCreationAction(projectId))}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Approve
          </button>
          <button
            disabled={isPending}
            onClick={() => setRejecting(true)}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            Reject…
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
