'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { requestMoreWorkstreamsAction } from '@/app/actions/workstream-limits'
import type { WorkstreamAllowance } from '@/lib/workbench/workstream-limits'

// A builder's workspace holds a limited number of workstreams. Shows how
// many are used and, once the limit is reached, lets the builder ask the
// platform admin for more with a reason.
export function WorkstreamAllowanceNotice({ projectId, allowance }: { projectId: string; allowance: WorkstreamAllowance }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [requested, setRequested] = useState(String(allowance.limit + 10))
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const atLimit = allowance.used >= allowance.limit

  function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await requestMoreWorkstreamsAction(projectId, Number(requested), reason)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Request failed')
      }
    })
  }

  return (
    <div className={`flex flex-col gap-3 rounded border p-4 text-sm ${atLimit ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 bg-white'}`}>
      <p className="text-zinc-700">
        Your workspace uses <span className="font-semibold">{allowance.used}</span> of {allowance.limit} workstreams.
        {atLimit && ' You have reached your limit.'}
      </p>
      {allowance.pendingRequest ? (
        <p className="text-zinc-600">
          You asked for {allowance.pendingRequest.requestedLimit} workstreams. Ember will review your request.
        </p>
      ) : (
        atLimit && (
          <form onSubmit={submit} className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-zinc-700">
              Workstreams you need in total
              <input
                inputMode="numeric"
                required
                value={requested}
                onChange={(e) => setRequested(e.target.value)}
                className="w-20 rounded border border-zinc-300 px-2 py-1 text-right"
              />
            </label>
            <label className="flex flex-col gap-1 text-zinc-700">
              Reason
              <textarea
                required
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="The client proposals you're working on and why you need more room."
                className="rounded border border-zinc-300 px-3 py-2"
              />
            </label>
            <button type="submit" disabled={isPending} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
              {isPending ? 'Sending…' : 'Request more workstreams'}
            </button>
            {error && <p className="text-red-600">{error}</p>}
          </form>
        )
      )}
    </div>
  )
}
