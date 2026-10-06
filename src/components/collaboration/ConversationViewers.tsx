'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { collaborationApi } from '@/lib/collaboration/api'
import { CollaborationError } from '@/lib/collaboration/errors'
import type { CollaborationCandidate, CollaborationViewer } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// Viewers of a shared conversation. For the pair: the list, Add viewer
// (another active member of the Project) and Remove. For a viewer: Watch
// while a session is live, and Stop viewing. Viewers never get controls.
export function ConversationViewers({
  projectId,
  conversationId,
  isViewer,
  participantIds,
  initialViewers,
  liveSessionId,
}: {
  projectId: string
  conversationId: string
  isViewer: boolean
  participantIds: string[]
  initialViewers: CollaborationViewer[]
  liveSessionId: string | null
}) {
  const collab = useCollaboration()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [viewers, setViewers] = useState(initialViewers)
  const [candidates, setCandidates] = useState<CollaborationCandidate[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function act<T>(action: () => Promise<T>): Promise<T | null> {
    setBusy(true)
    setError(null)
    try {
      return await action()
    } catch (err) {
      setError(err instanceof CollaborationError ? err.message : 'Couldn’t update viewers. Try again.')
      return null
    } finally {
      setBusy(false)
    }
  }

  if (isViewer) {
    const live = collab?.watchable.find((w) => w.conversationId === conversationId)
    const watchingThis = collab?.watch?.conversationId === conversationId
    const sessionId = live?.sessionId ?? liveSessionId
    return (
      <section id="viewers" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {watchingThis ? (
            <span className="text-sm text-zinc-600">You’re watching the live session — see the bar at the top of the page.</span>
          ) : (
            sessionId &&
            collab && (
              <button
                type="button"
                disabled={collab.busy}
                onClick={() => collab.watchSession(sessionId)}
                className="rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
              >
                Watch the live session
              </button>
            )
          )}
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (watchingThis) await collab?.stopWatching()
              const done = await act(() => collaborationApi.removeViewer(supabase, conversationId, collab?.userId ?? ''))
              if (done) router.push(`/projects/${projectId}`)
            }}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm"
          >
            Stop viewing this conversation
          </button>
        </div>
        {(error ?? collab?.error) && <p className="text-xs text-red-700">{error ?? collab?.error}</p>}
      </section>
    )
  }

  const shown = new Set([...participantIds, ...viewers.map((v) => v.userId)])
  return (
    <section id="viewers" className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Viewers</h2>
      <p className="text-xs text-zinc-500">
        Other members of this Project who can see this conversation in their history and watch your live sessions. They can’t take control.
      </p>
      {viewers.length === 0 && <p className="text-sm text-zinc-500">No viewers yet.</p>}
      <ul className="flex flex-col gap-1 text-sm">
        {viewers.map((v) => (
          <li key={v.userId} className="flex flex-wrap items-center gap-2">
            <span>{v.name}</span>
            {v.addedByName && <span className="text-xs text-zinc-400">added by {v.addedByName}</span>}
            <button
              type="button"
              disabled={busy}
              className="text-xs underline text-zinc-600"
              onClick={async () => {
                const next = await act(() => collaborationApi.removeViewer(supabase, conversationId, v.userId))
                if (next) setViewers(next)
              }}
            >
              Remove
            </button>
          </li>
        ))}
      </ul>
      {candidates === null ? (
        <button
          type="button"
          disabled={busy}
          className="self-start text-sm underline"
          onClick={async () => {
            const list = await act(() => collaborationApi.candidates(supabase, projectId))
            if (list) setCandidates(list)
          }}
        >
          Add a viewer
        </button>
      ) : (
        <div className="flex flex-col gap-1 rounded border border-zinc-200 p-2">
          {candidates.filter((c) => !shown.has(c.userId)).length === 0 && (
            <p className="text-xs text-zinc-500">Everyone else on this Project is already a viewer.</p>
          )}
          {candidates
            .filter((c) => !shown.has(c.userId))
            .map((c) => (
              <button
                key={c.userId}
                type="button"
                disabled={busy}
                className="rounded px-2 py-1 text-left text-sm hover:bg-zinc-100"
                onClick={async () => {
                  const next = await act(() => collaborationApi.addViewer(supabase, conversationId, c.userId))
                  if (next) {
                    setViewers(next)
                    setCandidates(null)
                  }
                }}
              >
                Add {c.name} <span className="text-xs capitalize text-zinc-400">{c.role}</span>
              </button>
            ))}
          <button type="button" className="self-start text-xs underline" onClick={() => setCandidates(null)}>
            Close
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </section>
  )
}
