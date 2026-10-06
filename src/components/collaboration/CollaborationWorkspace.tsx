'use client'

import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { collaborationAction } from '@/app/actions/collaboration'
import type { CollaborationCommand, SharedHistoryItem, SharedSnapshot } from '@/lib/collaboration/contracts'

export function CollaborationWorkspace({ userId, projects, members, initialHistory }: {
  userId: string
  projects: { id: string; name: string }[]
  members: { project: string; id: string; name: string }[]
  initialHistory: SharedHistoryItem[]
}) {
  const [history, setHistory] = useState<SharedHistoryItem[]>(initialHistory)
  const [snapshot, setSnapshot] = useState<SharedSnapshot | null>(null)
  const [project, setProject] = useState(projects[0]?.id ?? '')
  const [guest, setGuest] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const connection = useRef<string | null>(null)
  const current = useRef<SharedSnapshot | null>(null)
  const busy = useRef(false)
  const invitation = useRef<{ key: string; id: string } | null>(null)
  const [unavailable, setUnavailable] = useState(false)
  const update = useCallback((value: SharedSnapshot) => {
    current.current = value
    setSnapshot(value)
    setUnavailable(false)
  }, [])
  const refreshHistory = useCallback(async () => {
    const result = await collaborationAction({ command: 'history' })
    if (result.error) throw new Error(result.error)
    setHistory(result.data as SharedHistoryItem[])
  }, [])
  useEffect(() => {
    connection.current = crypto.randomUUID()
    // Serialized polling is a temporary development transport. No overlapping
    // requests, stale response overwrite, or content sent through Realtime.
    const timer = setInterval(async () => {
      if (busy.current) return
      busy.current = true
      try {
        const active = current.current
        if (active) {
          const result = await collaborationAction({ command: active.session?.joined ? 'heartbeat' : 'snapshot', id: active.id, connection: connection.current!, session: active.session?.id })
          if (result.error) {
            setUnavailable(true); setError(result.error)
            // An ended/replaced session or expired connection needs a fresh
            // snapshot before Join can be retried with the current session ID.
            const fresh = await collaborationAction({ command: 'snapshot', id: active.id, connection: connection.current! })
            if (!fresh.error) update(fresh.data as SharedSnapshot)
            else if (fresh.error === 'Collaboration access denied') {
              current.current = null; setSnapshot(null); setHistory([])
            }
          } else update(result.data as SharedSnapshot)
        } else await refreshHistory()
      } catch { setUnavailable(true); setError('Connection interrupted. Rejoin when available.') }
      finally { busy.current = false }
    }, 3000)
    return () => clearInterval(timer)
  }, [refreshHistory, update])

  function run(command: CollaborationCommand) {
    if (busy.current) { setError('Refreshing the workspace. Please try again.'); return }
    busy.current = true
    startTransition(async () => {
      try {
        setError('')
        const s = current.current?.session
        const result = await collaborationAction({ id: current.current?.id, connection: connection.current!, session: s?.id, revision: s?.revision, generation: s?.generation, ...command })
        if (result.error) { setError(result.error); setUnavailable(true) }
        else { update(result.data as SharedSnapshot); await refreshHistory() }
      } catch { setUnavailable(true); setError('Request failed. Refresh before retrying.') }
      finally { busy.current = false }
    })
  }
  const session = snapshot?.session
  const host = snapshot?.host_id === userId
  const controller = session?.controller_id === userId
  const ready = !!session?.joined && session.host_online && session.guest_online && !unavailable
  const button = 'rounded border px-3 py-2 text-sm disabled:opacity-40'
  function invite() {
    const key = `${project}:${guest}`
    if (invitation.current?.key !== key) invitation.current = { key, id: crypto.randomUUID() }
    run({ command: 'invite', id: invitation.current.id, project, guest })
  }
  return <section className="space-y-5">
    <h1 className="text-2xl font-semibold">Shared Ember workspace</h1>
    <p className="text-sm text-zinc-600">Development preview: invitations, control and shared location. Shared editing and AI messages are not enabled yet.</p>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!snapshot ? <>
      <form className="flex flex-wrap gap-3" onSubmit={e => { e.preventDefault(); invite() }}>
        <label>Project <select className={button} value={project} onChange={e => { setProject(e.target.value); setGuest('') }}>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select></label>
        <label>Collaborate with <select className={button} value={guest} onChange={e => setGuest(e.target.value)}>
          <option value="">Choose a Project member</option>
          {members.filter(m => m.project === project).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select></label>
        <button className={button} disabled={pending || !guest}>Send invitation</button>
      </form>
      <h2 className="font-semibold">Your shared conversations and invitations</h2>
      {!history.length && <p>No shared conversations yet.</p>}
      <ul className="space-y-2">{history.map(item => <li key={item.id}>
        <button className={button} disabled={pending} onClick={() => run({ command: 'snapshot', id: item.id })}>
          {item.project_name} · {item.other_name} · {item.accepted_at ? 'Shared' : 'Invitation'}
        </button>
      </li>)}</ul>
    </> : <>
      <p>{snapshot.project_name} · {snapshot.host_name} and {snapshot.guest_name}</p>
      {!snapshot.accepted_at ? <div>
        <p>Invitation expires {new Date(snapshot.invitation_expires_at).toLocaleString()}.</p>
        {host ? <p>Waiting for your colleague to accept from their Shared conversations list.</p> : <button className={button} disabled={pending} onClick={() => run({ command: 'accept' })}>Accept invitation</button>}
      </div> : !session ? <button className={button} disabled={pending} onClick={() => run({ command: 'resume' })}>Start a new live session</button> : <>
        <p role="status">{unavailable ? 'Connection unavailable; shared actions paused.' : ready ? 'Both connected' : 'Waiting for both participants to join'} · Controller: {session.controller_id === snapshot.host_id ? snapshot.host_name : snapshot.guest_name}</p>
        <div className="flex flex-wrap gap-2">
          {(!session.joined || unavailable) && <button className={button} disabled={pending} onClick={() => run({ command: 'join' })}>Join / reconnect</button>}
          {!controller && <button className={button} disabled={pending || !ready} onClick={() => run({ command: 'request' })}>Request control</button>}
          {controller && session.requested_by && <button className={button} disabled={pending || !ready} onClick={() => run({ command: 'grant' })}>Grant control</button>}
          {controller && session.requested_by && <button className={button} disabled={pending || !ready} onClick={() => run({ command: 'decline' })}>Decline request</button>}
          {host && !controller && <button className={button} disabled={pending || !ready} onClick={() => run({ command: 'reclaim' })}>Reclaim control</button>}
          {session.joined && <button className={button} disabled={pending} onClick={() => run({ command: 'leave' })}>Leave session</button>}
          {host && session.joined && <button className={button} disabled={pending} onClick={() => run({ command: 'end' })}>End session</button>}
        </div>
        {!unavailable && <div className="rounded border p-4 space-y-3">
          <label>Shared location <select className={button} disabled={pending || !ready || !controller} value={session.workstream_id ?? ''} onChange={e => run({ command: 'navigate', workstream: e.target.value || null })}>
            <option value="">Project overview</option>
            {snapshot.workstreams.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
          <h2 className="font-semibold">{snapshot.workstreams.find(w => w.id === session.workstream_id)?.name ?? snapshot.project_name}</h2>
          <p>Both participants follow this location. Project and Workstream editing will be added in the next increment.</p>
        </div>}
      </>}
      <button className={button} disabled={pending || !!session?.joined} onClick={() => { current.current = null; setSnapshot(null); setUnavailable(false) }}>Back to shared history</button>
      {session?.joined && <p className="text-sm">Leave the session before returning to shared history.</p>}
    </>}
    <Link className="text-sm underline" href="/dashboard">Return to your personal workspace</Link>
  </section>
}
