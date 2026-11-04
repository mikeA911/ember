'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setTriggerContributorAction } from '@/app/actions/sli'
import type { TriggerContributor } from '@/lib/sli/types'

// People invited to one Trigger's research. The sponsor and the Discovery
// team can invite colleagues from other departments, who then see this
// Trigger only.
export function TriggerContributors({
  triggerId,
  contributors,
  candidates,
  canManage,
}: {
  triggerId: string
  contributors: TriggerContributor[]
  candidates: TriggerContributor[]
  canManage: boolean
}) {
  const router = useRouter()
  const [selected, setSelected] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function change(userId: string, add: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await setTriggerContributorAction({ triggerId, userId, add })
      if (!result.ok) {
        setError(result.error)
        return
      }
      setSelected('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3 text-sm">
      {contributors.length === 0 ? (
        <p className="text-zinc-500">No one from outside the Discovery team is invited yet.</p>
      ) : (
        <ul className="space-y-1">
          {contributors.map((c) => (
            <li key={c.userId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-2">
              <span>
                {c.isMe ? 'You' : c.name}
                {c.departments && <span className="text-zinc-500"> · {c.departments}</span>}
              </span>
              {canManage && (
                <button type="button" disabled={pending} onClick={() => change(c.userId, false)} className="text-zinc-600 underline disabled:opacity-50">
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && candidates.length > 0 && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (selected) change(selected, true)
          }}
          className="flex flex-wrap items-center gap-2"
        >
          <label htmlFor="contributor" className="sr-only">Colleague to invite</label>
          <select
            id="contributor"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            className="min-w-0 max-w-full rounded border border-zinc-300 bg-white px-3 py-1.5"
          >
            <option value="">Invite a colleague…</option>
            {candidates.map((c) => (
              <option key={c.userId} value={c.userId}>
                {c.name}
                {c.departments ? ` (${c.departments})` : ''}
              </option>
            ))}
          </select>
          <button type="submit" disabled={!selected || pending} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {pending ? 'Saving…' : 'Invite'}
          </button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
