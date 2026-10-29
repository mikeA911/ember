'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setTriggerArchivedAction, transitionTriggerAction } from '@/app/actions/sli'
import { actionLabel, type TriggerAction } from '@/lib/sli/types'

// The buttons the database says this person may use now. An action that
// needs a reason opens a short form first.
export function TriggerActions({ triggerId, actions }: { triggerId: string; actions: TriggerAction[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<TriggerAction | null>(null)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (actions.length === 0) return null

  function run(action: TriggerAction, withReason: string | null) {
    setError(null)
    startTransition(async () => {
      const result =
        action.action === 'archive' || action.action === 'unarchive'
          ? await setTriggerArchivedAction({ triggerId, archived: action.action === 'archive', reason: withReason ?? undefined })
          : await transitionTriggerAction({ triggerId, toStage: action.toStage!, reason: withReason ?? undefined })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected(null)
      setReason('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => {
          const quiet = a.action === 'archive' || a.action === 'unarchive' || a.action === 'decline' || a.action === 'step_back' || a.action === 'withdraw'
          return (
            <button
              key={a.action + (a.toStage ?? '')}
              type="button"
              disabled={pending}
              onClick={() => (a.reasonRequired ? (setSelected(a), setError(null)) : run(a, null))}
              className={
                quiet
                  ? 'rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50'
                  : 'rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'
              }
            >
              {actionLabel(a)}
            </button>
          )
        })}
      </div>
      {selected && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(selected, reason)
          }}
          className="max-w-xl space-y-2 rounded border border-zinc-200 bg-white p-3"
        >
          <label htmlFor="reason" className="block text-sm font-medium">
            {actionLabel(selected)}: reason
          </label>
          <textarea
            id="reason"
            required
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
              {pending ? 'Saving…' : 'Confirm'}
            </button>
            <button type="button" onClick={() => setSelected(null)} className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
              Cancel
            </button>
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
