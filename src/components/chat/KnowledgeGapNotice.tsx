'use client'

import { useState, useTransition } from 'react'
import { addKnowledgeGapDetailsAction, withdrawKnowledgeGapAction } from '@/app/actions/knowledge-gaps'

// Ember Readiness, Stage 4: shown under an answer Ember filed as a gap in
// the Project's knowledge. The person who asked can add details (what they
// were looking for, a source that covers it) or withdraw it within a day.
export function KnowledgeGapNotice({
  occurrenceId,
  createdAt,
  hasDetails,
}: {
  occurrenceId: string
  // Absent for a just-filed gap (withdrawable now).
  createdAt?: string
  hasDetails?: boolean
}) {
  const [state, setState] = useState<'shown' | 'details' | 'withdrawn'>('shown')
  const [detailsAdded, setDetailsAdded] = useState(!!hasDetails)
  const [note, setNote] = useState('')
  const [suggestedSource, setSuggestedSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  // Captured once at mount (the lazy initializer) so render stays pure; a
  // stale page just gets the server's "can no longer be withdrawn" message.
  const [canWithdraw] = useState(() => !createdAt || Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000)

  if (state === 'withdrawn') {
    return <p className="mt-1 text-xs text-zinc-500">Not sent to the curators.</p>
  }

  return (
    <div className="mt-1 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-left text-xs text-amber-900">
      <p>
        This looks like a gap in the Project&rsquo;s knowledge. It has been sent to the Project curators.
        {detailsAdded && ' Your details were added.'}
      </p>
      {state === 'shown' && (
        <div className="mt-1 flex gap-3">
          <button type="button" onClick={() => setState('details')} className="underline">
            Add details
          </button>
          {canWithdraw && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                setError(null)
                startTransition(async () => {
                  const result = await withdrawKnowledgeGapAction(occurrenceId)
                  if (result.error) setError(result.error)
                  else setState('withdrawn')
                })
              }}
              className="underline disabled:opacity-50"
            >
              Don&rsquo;t send
            </button>
          )}
        </div>
      )}
      {state === 'details' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            startTransition(async () => {
              const result = await addKnowledgeGapDetailsAction(occurrenceId, { note, suggestedSource })
              if (result.error) {
                setError(result.error)
                return
              }
              setDetailsAdded(true)
              setState('shown')
            })
          }}
          className="mt-1 flex flex-col gap-1"
        >
          <textarea
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What were you looking for? (optional)"
            className="w-full rounded border border-amber-300 bg-white px-2 py-1"
          />
          <input
            maxLength={4000}
            value={suggestedSource}
            onChange={(e) => setSuggestedSource(e.target.value)}
            placeholder="A source that covers it, if you know one (optional)"
            className="w-full rounded border border-amber-300 bg-white px-2 py-1"
          />
          <div className="flex gap-2">
            <button disabled={isPending} className="rounded bg-amber-800 px-2 py-0.5 font-medium text-white disabled:opacity-50">
              {isPending ? 'Saving…' : 'Add'}
            </button>
            <button type="button" onClick={() => setState('shown')} className="underline">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  )
}
