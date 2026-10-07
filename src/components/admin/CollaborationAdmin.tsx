'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/browser'
import { collaborationAdminApi, type CollaborationOverview } from '@/lib/collaboration/admin'
import { CollaborationError } from '@/lib/collaboration/errors'
import { minutesLabel } from '@/lib/collaboration/format'

// Shared workspace sessions, Phase 4: the administrators' view -- live
// sessions, counts for a period and recent problems -- with the recovery
// actions (each a recorded status change; nothing is deleted). Reads and
// acts through the admin-only collaboration_admin_* functions, from the
// browser like the rest of the feature. Names and statuses only, never
// message or draft text. Loads on opening and on Refresh; no polling.

const PERIODS = [
  { hours: 24, label: 'Last 24 hours' },
  { hours: 24 * 7, label: 'Last 7 days' },
  { hours: 24 * 30, label: 'Last 30 days' },
]
const button = 'rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50'
const danger = 'rounded border border-red-300 bg-white px-2 py-1 text-xs text-red-700 hover:bg-red-50 disabled:opacity-50'

function when(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }) : '—'
}
const since = (iso: string) => minutesLabel(Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000))
const tally = (counts: Record<string, number>) =>
  Object.keys(counts).length === 0
    ? 'none'
    : Object.entries(counts)
        .map(([k, n]) => `${k.replace(/_/g, ' ')} ${n}`)
        .join(' · ')

export function CollaborationAdmin() {
  const supabase = useMemo(() => createClient(), [])
  const [hours, setHours] = useState(24)
  const [overview, setOverview] = useState<CollaborationOverview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(
    async (h: number) => {
      try {
        setOverview(await collaborationAdminApi.overview(supabase, h))
        setError(null)
      } catch (err) {
        setError(err instanceof CollaborationError ? err.message : 'Couldn’t load the overview.')
      }
    },
    [supabase]
  )

  useEffect(() => {
    let cancelled = false
    collaborationAdminApi.overview(supabase, hours).then(
      (next) => {
        if (!cancelled) {
          setOverview(next)
          setError(null)
        }
      },
      (err) => {
        if (!cancelled) setError(err instanceof CollaborationError ? err.message : 'Couldn’t load the overview.')
      }
    )
    return () => {
      cancelled = true
    }
  }, [supabase, hours])

  async function act(key: string, label: string, action: () => Promise<unknown>) {
    setBusy(key)
    setMessage(null)
    try {
      await action()
      setMessage(label)
      setConfirm(null)
      await load(hours)
    } catch (err) {
      setError(err instanceof CollaborationError ? err.message : 'That didn’t work.')
    } finally {
      setBusy(null)
    }
  }

  if (!overview) return <p className="text-sm text-zinc-500">{error ?? 'Loading…'}</p>
  const { live, counts, problems } = overview

  return (
    <div className="flex flex-col gap-6 text-sm" data-collaboration-admin>
      <div className="flex flex-wrap items-center gap-2">
        <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className="rounded border border-zinc-300 px-2 py-1 text-sm" aria-label="Period">
          {PERIODS.map((p) => (
            <option key={p.hours} value={p.hours}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="button" className={button} onClick={() => void load(hours)}>
          Refresh
        </button>
        {message && (
          <span className="text-xs text-green-700" role="status">
            {message}
          </span>
        )}
        {error && (
          <span className="text-xs text-red-700" role="alert">
            {error}
          </span>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Live sessions ({live.length})</h2>
        {live.length === 0 && <p className="text-zinc-500">No live sessions.</p>}
        {live.map((s) => (
          <div key={s.id} className={`flex flex-col gap-1 rounded border p-3 ${s.overdue ? 'border-amber-300 bg-amber-50' : 'border-zinc-200'}`} data-admin-session={s.id}>
            <div className="flex flex-wrap items-center gap-x-3">
              <Link href={`/projects/${s.projectId}/shared/${s.conversationId}`} className="font-medium underline">
                {s.projectName}
              </Link>
              <span>
                {s.hostName} {s.hostPresent ? (s.hostAway ? '(away)' : '(connected)') : '(not connected)'} · {s.guestName}{' '}
                {s.guestPresent ? (s.guestAway ? '(away)' : '(connected)') : '(not connected)'}
              </span>
              <span className="text-zinc-500">In control: {s.controllerName}</span>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 text-xs text-zinc-600">
              <span>Started {since(s.startedAt)} ago</span>
              <span>{s.overdue ? `Past its deadline (${s.endingReason.replace(/_/g, ' ')}) — ends on the next poll` : `Ends by ${when(s.endsAt)} (${s.endingReason.replace(/_/g, ' ')})`}</span>
              <span>{s.watching} watching</span>
              <span>
                Ember: {s.turnRunning ? 'answering' : 'idle'}
                {s.turnsWaiting ? `, ${s.turnsWaiting} waiting` : ''}
              </span>
              {s.openDrafts > 0 && <span>{s.openDrafts} unsaved draft{s.openDrafts === 1 ? '' : 's'}</span>}
              <span className="ml-auto">
                {confirm === s.id ? (
                  <>
                    <span className="mr-2 text-red-700">End it for both? Unsaved drafts won’t be saved.</span>
                    <button type="button" className={danger} disabled={busy === s.id} onClick={() => void act(s.id, 'Session ended.', () => collaborationAdminApi.endSession(supabase, s.id))}>
                      End session
                    </button>{' '}
                    <button type="button" className={button} onClick={() => setConfirm(null)}>
                      Keep
                    </button>
                  </>
                ) : (
                  <button type="button" className={danger} onClick={() => setConfirm(s.id)}>
                    End session…
                  </button>
                )}
              </span>
            </div>
          </div>
        ))}
        {problems.overdueSessions > 0 && (
          <div>
            <button type="button" className={button} disabled={busy === 'settle'} onClick={() => void act('settle', 'Overdue sessions settled.', () => collaborationAdminApi.settleAll(supabase))}>
              Settle {problems.overdueSessions} overdue session{problems.overdueSessions === 1 ? '' : 's'} now
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Needs attention</h2>
        {problems.stalledTurns.length + problems.failedTurns.length + problems.stuckNotes.length === 0 && <p className="text-zinc-500">Nothing stuck or failed in this period.</p>}
        {problems.stalledTurns.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center gap-x-3 rounded border border-amber-300 bg-amber-50 p-2" data-admin-turn={t.id}>
            <span className="font-medium">Stalled Ember answer</span>
            <span>
              {t.projectName} · asked by {t.requestedByName} {since(t.createdAt)} ago · {t.status === 'running' ? `running past its lease (attempt ${t.attempts})` : 'waiting with nothing running'}
            </span>
            <button type="button" className={`${danger} ml-auto`} disabled={busy === t.id} onClick={() => void act(t.id, 'Answer cancelled.', () => collaborationAdminApi.cancelTurn(supabase, t.id))}>
              Cancel it
            </button>
          </div>
        ))}
        {problems.stuckNotes.map((n) => (
          <div key={`${n.messageId}:${n.index}`} className="flex flex-wrap items-center gap-x-3 rounded border border-amber-300 bg-amber-50 p-2">
            <span className="font-medium">Note stuck sending</span>
            <span>
              by {n.byName}, since {since(n.since)} ago. Check the Project’s notes: it may have been sent.
            </span>
            <button
              type="button"
              className={`${button} ml-auto`}
              disabled={busy === n.messageId}
              onClick={() => void act(n.messageId, 'Note reset to failed; the pair can send it again.', () => collaborationAdminApi.releaseNote(supabase, n.messageId, n.index))}
            >
              Reset to failed
            </button>
          </div>
        ))}
        {problems.failedTurns.length > 0 && (
          <details>
            <summary className="cursor-pointer text-zinc-700">{problems.failedTurns.length} failed Ember answers in this period</summary>
            <ul className="mt-1 flex flex-col gap-1 text-xs">
              {problems.failedTurns.map((t) => (
                <li key={t.id}>
                  {when(t.finishedAt)} · {t.projectName} · {t.requestedByName} · {t.error ?? 'no reason'} (attempt {t.attempts})
                </li>
              ))}
            </ul>
          </details>
        )}
      </section>

      <section className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">In this period</h2>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
          <Row label="Invitations" value={tally(counts.invitations)} />
          <Row label="Sessions started" value={String(counts.sessionsStarted)} />
          <Row label="Sessions ended" value={tally(counts.sessionsEnded)} />
          <Row label="Control changes" value={String(counts.controlChanges)} />
          <Row label="Field saves" value={String(counts.saves)} />
          <Row label="Drafts abandoned" value={String(counts.draftsAbandoned)} />
          <Row label="Ember answers" value={tally(counts.turns)} />
          <Row label="Answers retried" value={String(counts.turnsRetried)} />
          <Row
            label="Answer time"
            value={counts.answerSecondsMedian === null ? '—' : `median ${Math.round(counts.answerSecondsMedian)} s · 90th percentile ${Math.round(counts.answerSecondsP90 ?? 0)} s`}
          />
          <Row label="Viewer comments" value={String(counts.comments)} />
          <Row label="Summaries written" value={String(counts.summaries)} />
          <Row label="Proposed notes sent" value={String(counts.notesSent)} />
        </dl>
      </section>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-zinc-100 py-1">
      <dt className="text-zinc-500">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  )
}
