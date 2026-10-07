'use client'

import { useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/browser'
import { collaborationAdminApi, type CollaborationRollout as Rollout } from '@/lib/collaboration/admin'
import { CollaborationError } from '@/lib/collaboration/errors'
import type { Database } from '@/types/database'

// Shared workspace sessions, Phase 4: where live collaboration is on --
// every Project, or only the Projects turned on here. The build flag stays
// the master switch. Turning it off for a Project stops new invitations
// and accepts there (the database refuses them); live sessions carry on
// and can be ended above. Every change is recorded.

const button = 'rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50'
const CHANGES: Record<string, string> = { 'mode:all': 'set to all Projects', 'mode:selected': 'set to selected Projects only', project_on: 'turned on', project_off: 'turned off' }

export function CollaborationRollout() {
  const supabase = useMemo(() => createClient(), [])
  const [rollout, setRollout] = useState<Rollout | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    let cancelled = false
    collaborationAdminApi.rollout(supabase).then(
      (r) => !cancelled && setRollout(r),
      (err) => !cancelled && setError(err instanceof CollaborationError ? err.message : 'Couldn’t load the rollout.')
    )
    return () => {
      cancelled = true
    }
  }, [supabase])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      void (supabase as SupabaseClient<Database>)
        .from('projects')
        .select('id, name')
        .ilike('name', `%${q.replace(/[%_]/g, '')}%`)
        .order('name')
        .limit(8)
        .then(({ data }) => {
          if (!cancelled) setMatches(data ?? [])
        })
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query, supabase])

  async function change(action: () => Promise<Rollout>) {
    setBusy(true)
    setError(null)
    try {
      setRollout(await action())
    } catch (err) {
      setError(err instanceof CollaborationError ? err.message : 'That didn’t work.')
    } finally {
      setBusy(false)
    }
  }

  if (!rollout) return <p className="text-sm text-zinc-500">{error ?? 'Loading the rollout…'}</p>
  const on = rollout.projects.filter((p) => p.enabled)
  const shownMatches = query.trim().length >= 2 ? matches.filter((m) => !on.some((p) => p.projectId === m.id)) : []

  return (
    <section className="flex flex-col gap-2 text-sm" data-collaboration-rollout>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Where it’s on</h2>
      <fieldset className="flex flex-col gap-1" disabled={busy}>
        <label className="flex items-center gap-2">
          <input type="radio" name="collab-mode" checked={rollout.mode === 'all'} onChange={() => void change(() => collaborationAdminApi.setRolloutMode(supabase, 'all'))} />
          Every Project
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="collab-mode" checked={rollout.mode === 'selected'} onChange={() => void change(() => collaborationAdminApi.setRolloutMode(supabase, 'selected'))} />
          Only the Projects below
        </label>
      </fieldset>
      <p className="text-xs text-zinc-500">
        Where it’s off, nobody can start a live session (Collaborate, Ember or resume); sessions already live carry on until they end. Shared
        conversations stay readable.
        {rollout.updatedByName && ` Last changed by ${rollout.updatedByName}.`}
      </p>

      <div className={`flex flex-col gap-1 ${rollout.mode === 'all' ? 'opacity-60' : ''}`}>
        <p className="text-xs font-medium text-zinc-600">
          Turned on for {on.length} Project{on.length === 1 ? '' : 's'}
          {rollout.mode === 'all' ? ' (used once you choose “Only the Projects below”)' : ''}
        </p>
        <ul className="flex flex-col gap-1">
          {on.map((p) => (
            <li key={p.projectId} className="flex items-center justify-between gap-2 rounded border border-zinc-200 px-2 py-1">
              <span>{p.projectName}</span>
              <button type="button" className={button} disabled={busy} onClick={() => void change(() => collaborationAdminApi.setProjectEnabled(supabase, p.projectId, false))}>
                Turn off
              </button>
            </li>
          ))}
        </ul>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Find a Project to turn on…"
          className="mt-1 rounded border border-zinc-300 px-2 py-1"
          aria-label="Find a Project"
        />
        {shownMatches.length > 0 && (
          <ul className="flex flex-col gap-1">
            {shownMatches.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-2 px-2 py-1">
                <span>{m.name}</span>
                <button
                  type="button"
                  className={button}
                  disabled={busy}
                  onClick={() =>
                    void change(async () => {
                      const next = await collaborationAdminApi.setProjectEnabled(supabase, m.id, true)
                      setQuery('')
                      return next
                    })
                  }
                >
                  Turn on
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {rollout.recent.length > 0 && (
        <details>
          <summary className="cursor-pointer text-xs text-zinc-600">Recent changes</summary>
          <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-600">
            {rollout.recent.map((r, i) => (
              <li key={i}>
                {new Date(r.at).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })} · {r.byName ?? 'someone'}: {r.projectName ? `${r.projectName} ` : ''}
                {CHANGES[r.change] ?? r.change}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && (
        <p className="text-xs text-red-700" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
