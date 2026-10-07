'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { decideWorkstreamLimitRequestAction } from '@/app/actions/workstream-limits'
import type { WorkstreamLimitRequestRow } from '@/lib/workbench/workstream-limits'

// Platform admin only: builders asking to raise their workspace's
// workstream limit.
export function WorkstreamLimitRequestsReview({ requests }: { requests: WorkstreamLimitRequestRow[] }) {
  if (requests.length === 0) return null
  return (
    <section className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold">Workstream limit requests</h2>
      <ul className="flex flex-col gap-2">
        {requests.map((r) => (
          <RequestRow key={r.id} request={r} />
        ))}
      </ul>
    </section>
  )
}

function RequestRow({ request }: { request: WorkstreamLimitRequestRow }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  function decide(approve: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        await decideWorkstreamLimitRequestAction(request.id, approve, note || undefined)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to decide')
      }
    })
  }

  return (
    <li className="rounded border border-amber-100 bg-white p-3 text-sm">
      <p className="font-medium">
        {request.builderEmail ?? request.builderId}: {request.currentLimit} → {request.requestedLimit} workstreams
      </p>
      <p className="mt-1 whitespace-pre-wrap text-zinc-600">{request.reason}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note (optional)"
          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1 text-xs"
        />
        <button type="button" disabled={isPending} onClick={() => decide(true)} className="rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50">
          Approve
        </button>
        <button type="button" disabled={isPending} onClick={() => decide(false)} className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium disabled:opacity-50">
          Decline
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </li>
  )
}
