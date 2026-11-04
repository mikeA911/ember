'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDecisionDelegateAction } from '@/app/actions/sli'
import type { DecisionSettings } from '@/lib/sli/types'

// SLI Home for the Discovery team: who decides, the dated delegate, what
// waits for the caller's decision, and (for the decider) the delegation
// form.
export function DecisionPanel({ settings }: { settings: DecisionSettings }) {
  const router = useRouter()
  const [userId, setUserId] = useState(settings.delegate?.userId ?? '')
  const [from, setFrom] = useState(settings.delegate?.from ?? '')
  const [until, setUntil] = useState(settings.delegate?.until ?? '')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(clear: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await setDecisionDelegateAction(
        clear ? { userId: null, from: null, until: null } : { userId: userId || null, from: from || null, until: until || null }
      )
      if (!result.ok) return setError(result.error)
      if (clear) {
        setUserId('')
        setFrom('')
        setUntil('')
      }
      router.refresh()
    })
  }

  const d = settings.delegate
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Decisions</h2>
      {settings.waitingForMe.length > 0 && (
        <div className="space-y-1">
          <p className="text-sm font-medium">Waiting for your decision</p>
          <ul className="flex flex-wrap gap-2 text-sm">
            {settings.waitingForMe.map((t) => (
              <li key={t.code}>
                <Link href={`/sli/discovery/${t.code}`} className="block rounded border border-amber-200 bg-amber-50 px-3 py-1.5 hover:border-amber-400">
                  <span className="font-mono text-xs">{t.code}</span> {t.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-zinc-600">
        {settings.decider ? `${settings.decider.isMe ? 'You decide' : `${settings.decider.name} decides`} on Triggers.` : 'No decision authority is set yet.'}
        {d &&
          ` ${d.isMe ? 'You are' : `${d.name} is`} the delegate from ${d.from} to ${d.until}${d.activeToday ? ' (in effect today)' : ''}.`}
      </p>
      {settings.canSetDelegate && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            save(false)
          }}
          className="flex flex-wrap items-end gap-2 text-sm"
        >
          <div>
            <label htmlFor="delegate" className="mb-1 block text-xs text-zinc-500">Delegate while you are away</label>
            <select id="delegate" value={userId} onChange={(e) => setUserId(e.target.value)} className="rounded border border-zinc-300 bg-white px-2 py-1.5">
              <option value="">Choose…</option>
              {settings.candidates.map((c) => (
                <option key={c.userId} value={c.userId}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="delegate-from" className="mb-1 block text-xs text-zinc-500">From</label>
            <input id="delegate-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border border-zinc-300 bg-white px-2 py-1" />
          </div>
          <div>
            <label htmlFor="delegate-until" className="mb-1 block text-xs text-zinc-500">Until</label>
            <input id="delegate-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} className="rounded border border-zinc-300 bg-white px-2 py-1" />
          </div>
          <button type="submit" disabled={pending || !userId || !from || !until} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {pending ? 'Saving…' : 'Save'}
          </button>
          {d && (
            <button type="button" disabled={pending} onClick={() => save(true)} className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50">
              End delegation
            </button>
          )}
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
