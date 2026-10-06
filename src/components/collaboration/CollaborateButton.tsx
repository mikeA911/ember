'use client'

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { collaborationApi } from '@/lib/collaboration/api'
import { CollaborationError } from '@/lib/collaboration/errors'
import type { CollaborationCandidate } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// "Collaborate" on the Project page: pick another active member of this
// Project, review exactly who and what, then send. The same invitation
// Ember sends after confirmation (collaboration-tool.ts). Nothing when the
// feature is off.
export function CollaborateButton({ projectId, projectName }: { projectId: string; projectName: string }) {
  const collab = useCollaboration()
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [candidates, setCandidates] = useState<CollaborationCandidate[] | null>(null)
  const [chosen, setChosen] = useState<CollaborationCandidate | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  if (!collab) return null
  const inSession = !!collab.session && !collab.session.iLeft
  const pending = collab.outgoing.find((i) => i.projectId === projectId)

  async function openPicker() {
    setOpen(true)
    setChosen(null)
    setSentTo(null)
    setLoadError(null)
    try {
      setCandidates(await collaborationApi.candidates(supabase, projectId))
    } catch (err) {
      setLoadError(err instanceof CollaborationError ? err.message : 'Couldn’t load this Project’s members.')
    }
  }

  async function send() {
    if (!chosen) return
    const invitation = await collab!.invite(projectId, chosen.userId)
    if (invitation) {
      setSentTo(chosen.name)
      setChosen(null)
    }
  }

  if (inSession) {
    return <span className="text-sm text-zinc-500">In a live session</span>
  }

  return (
    <div className="relative">
      <button type="button" onClick={() => (open ? setOpen(false) : openPicker())} className="text-sm underline" aria-expanded={open}>
        Collaborate
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-72 rounded border border-zinc-200 bg-white p-3 text-sm shadow-lg">
          {sentTo ? (
            <div className="flex flex-col gap-2">
              <p>Invitation sent to {sentTo}. It lasts an hour; the bar at the top shows when they accept.</p>
              <button type="button" className="self-start text-xs underline" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
          ) : chosen ? (
            <div className="flex flex-col gap-2">
              <p>
                Invite <strong>{chosen.name}</strong> to a live session on <strong>{projectName}</strong>?
              </p>
              <p className="text-xs text-zinc-600">
                They’ll see the Project and Workstream pages you open here, and either of you can ask for control. Each of you only sees what
                your own access allows. Nothing from your private Ember chats is shared.
              </p>
              {pending && <p className="text-xs text-zinc-600">This replaces your pending invitation to {pending.inviteeName}.</p>}
              {collab.error && <p className="text-xs text-red-700">{collab.error}</p>}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={send}
                  disabled={collab.busy}
                  className="rounded bg-amber-700 px-2 py-1 text-xs font-medium text-white hover:bg-amber-800 disabled:opacity-50"
                >
                  Send invitation
                </button>
                <button type="button" onClick={() => setChosen(null)} className="rounded border border-zinc-300 px-2 py-1 text-xs">
                  Back
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <p className="text-xs text-zinc-500">Work together live with another member of this Project.</p>
              {loadError && <p className="text-xs text-red-700">{loadError}</p>}
              {!candidates && !loadError && <p className="text-xs text-zinc-400">Loading members…</p>}
              {candidates?.length === 0 && <p className="text-xs text-zinc-500">There’s nobody else active on this Project yet.</p>}
              <ul className="max-h-56 overflow-y-auto">
                {candidates?.map((c) => (
                  <li key={c.userId}>
                    <button type="button" onClick={() => setChosen(c)} className="block w-full rounded px-2 py-1 text-left hover:bg-zinc-100">
                      {c.name} <span className="text-xs capitalize text-zinc-400">{c.role}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
