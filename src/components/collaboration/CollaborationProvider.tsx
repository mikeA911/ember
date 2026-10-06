'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { collaborationApi } from '@/lib/collaboration/api'
import { getTabConnectionId } from '@/lib/collaboration/connection'
import { CollaborationError } from '@/lib/collaboration/errors'
import { decideFollow, followTarget } from '@/lib/collaboration/follow'
import { sharedPath } from '@/lib/collaboration/locations'
import { nextPollDelay } from '@/lib/collaboration/transport'
import type { CollaborationInvitation, CollaborationStatus, SessionSnapshot } from '@/lib/collaboration/types'

// Shared workspace sessions, Phase 1 (docs/dev-request-shared-workspace-
// sessions.md). Mounted by the signed-in layout only when the feature flag
// is on, so it persists across every route: it polls the session state,
// joins this tab, makes an observer's tab follow the controller between the
// Project and Workstream pages, and reports the controller's own moves.
// The database decides everything; this only renders and asks.

interface CollaborationContextValue {
  userId: string
  session: SessionSnapshot | null
  incoming: CollaborationInvitation[]
  outgoing: CollaborationInvitation[]
  endedSession: SessionSnapshot | null
  following: boolean
  busy: boolean
  error: string | null
  invite: (projectId: string, inviteeId: string, conversationId?: string | null) => Promise<CollaborationInvitation | null>
  cancelInvitation: (invitationId: string) => Promise<void>
  respondInvitation: (invitationId: string, accept: boolean) => Promise<void>
  requestControl: (withdraw?: boolean) => Promise<void>
  answerControlRequest: (grant: boolean) => Promise<void>
  reclaimControl: () => Promise<void>
  takeOverTab: () => Promise<void>
  rejoin: () => Promise<void>
  leave: () => Promise<void>
  end: () => Promise<void>
  followAgain: () => void
  dismissEnded: () => void
  dismissError: () => void
}

const CollaborationContext = createContext<CollaborationContextValue | null>(null)

// An observer's "stepped away" choice, per tab and session, so a reload
// elsewhere doesn't pull them back.
const AWAY_KEY = (sessionId: string) => `ember-collaboration-away:${sessionId}`
function readAway(sessionId: string): boolean {
  try {
    return sessionStorage.getItem(AWAY_KEY(sessionId)) === '1'
  } catch {
    return false
  }
}
function writeAway(sessionId: string, away: boolean) {
  try {
    if (away) sessionStorage.setItem(AWAY_KEY(sessionId), '1')
    else sessionStorage.removeItem(AWAY_KEY(sessionId))
  } catch {
    // Storage blocked: the choice lasts until the next reload.
  }
}

// null when the feature is off (no provider mounted).
export function useCollaboration(): CollaborationContextValue | null {
  return useContext(CollaborationContext)
}

export function CollaborationProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const pathname = usePathname()

  const [connection, setConnection] = useState<string | null>(null)
  const [status, setStatus] = useState<CollaborationStatus>({ session: null, incoming: [], outgoing: [] })
  const [endedSession, setEndedSession] = useState<SessionSnapshot | null>(null)
  const [following, setFollowing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The live session this tab last saw, so a poll after it ends can say why.
  const lastSessionRef = useRef<string | null>(null)
  const failuresRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<() => void>(() => {})
  const joiningRef = useRef<string | null>(null)
  const reportingRef = useRef<string | null>(null)
  const sessionRef = useRef<SessionSnapshot | null>(null)
  useEffect(() => {
    sessionRef.current = status.session
  }, [status.session])

  useEffect(() => {
    getTabConnectionId().then(setConnection)
  }, [])

  // A late poll response never rolls back a newer snapshot from a command.
  const applySession = useCallback((next: SessionSnapshot | null) => {
    if (next?.status === 'ended') {
      lastSessionRef.current = null
      setEndedSession(next)
      setStatus((prev) => ({ ...prev, session: null }))
      return
    }
    if (next) {
      if (lastSessionRef.current !== next.id) setFollowing(!readAway(next.id))
      lastSessionRef.current = next.id
    }
    setStatus((prev) => {
      if (next && prev.session && prev.session.id === next.id && next.stateRevision < prev.session.stateRevision) return prev
      return { ...prev, session: next }
    })
  }, [])

  const poll = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // From this response, not sessionRef: the ref only catches up after
    // the next render, and the poll that first finds a session must
    // already switch to the fast in-session interval.
    let inSession = !!sessionRef.current
    let waiting = false
    try {
      const result = await collaborationApi.status(supabase, connection, lastSessionRef.current)
      failuresRef.current = 0
      setStatus((prev) => ({ ...prev, incoming: result.incoming, outgoing: result.outgoing }))
      applySession(result.session)
      inSession = result.session?.status === 'active'
      waiting = result.outgoing.length > 0
    } catch {
      failuresRef.current += 1
    }
    const delay = nextPollDelay({
      inSession,
      waiting,
      hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      consecutiveFailures: failuresRef.current,
    })
    timerRef.current = setTimeout(() => pollRef.current(), delay)
  }, [supabase, connection, applySession])
  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  useEffect(() => {
    if (!connection) return
    poll()
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [connection, poll])

  const run = useCallback(
    async <T,>(action: () => Promise<T>): Promise<T | null> => {
      setBusy(true)
      setError(null)
      try {
        return await action()
      } catch (err) {
        setError(err instanceof CollaborationError ? err.message : 'Collaboration is unavailable right now. Try again in a moment.')
        return null
      } finally {
        setBusy(false)
        pollRef.current()
      }
    },
    []
  )

  const session = status.session

  // Join this tab automatically unless another of this person's tabs has
  // the session, or they chose to leave it.
  useEffect(() => {
    if (!connection || !session || session.thisTabJoined || session.otherTabActive || session.iLeft) return
    if (joiningRef.current === session.id) return
    joiningRef.current = session.id
    collaborationApi
      .join(supabase, session.id, connection, false)
      .then(applySession)
      .catch(() => {})
      .finally(() => {
        joiningRef.current = null
      })
  }, [connection, session, supabase, applySession])

  // The controller's tab reports its own moves between shared pages.
  const decision = decideFollow({ session, userId, pathname, following })
  const reportWorkstream = decision.kind === 'report' ? (decision.workstreamId ?? 'project') : null
  useEffect(() => {
    const s = sessionRef.current
    if (!reportWorkstream || !s || !connection) return
    const workstreamId = reportWorkstream === 'project' ? null : reportWorkstream
    const key = `${s.id}:${s.controlGeneration}:${reportWorkstream}`
    if (reportingRef.current === key) return
    reportingRef.current = key
    collaborationApi
      .navigate(supabase, s.id, connection, s.controlGeneration, workstreamId)
      .then(applySession)
      .catch((err) => {
        if (err instanceof CollaborationError && err.kind !== 'stale') setError(err.message)
        pollRef.current()
      })
      .finally(() => {
        reportingRef.current = null
      })
  }, [reportWorkstream, connection, supabase, applySession])

  // A following observer's tab goes wherever the shared location is. Keyed
  // on the target, not the current path, so the person's own navigation
  // never gets undone here (it stops them following instead, below).
  const target = followTarget(session, userId, following)
  useEffect(() => {
    if (target && window.location.pathname.replace(/\/+$/, '').toLowerCase() !== target.toLowerCase()) router.push(target)
  }, [target, router])

  // An observer who navigates somewhere else on their own stops following
  // until they choose to follow again (or come back to the shared page).
  useEffect(() => {
    const current = sessionRef.current
    if (!current || !current.thisTabJoined || current.controllerId === userId) return
    const target = sharedPath(current.projectId, current.location.workstreamId)
    const away = pathname.replace(/\/+$/, '').toLowerCase() !== target.toLowerCase()
    writeAway(current.id, away)
    setFollowing(!away)
    // Only the person's own navigation (a pathname change) counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const withSession = useCallback(
    (action: (s: SessionSnapshot, tab: string) => Promise<SessionSnapshot>) =>
      run(async () => {
        const s = sessionRef.current
        if (!s || !connection) return null
        const next = await action(s, connection)
        applySession(next)
        return next
      }).then(() => undefined),
    [run, connection, applySession]
  )

  const value: CollaborationContextValue = {
    userId,
    session,
    incoming: status.incoming,
    outgoing: status.outgoing,
    endedSession,
    following,
    busy,
    error,
    invite: (projectId, inviteeId, conversationId) =>
      run(() => collaborationApi.invite(supabase, { projectId, inviteeId, conversationId: conversationId ?? null })),
    cancelInvitation: (invitationId) => run(() => collaborationApi.cancelInvitation(supabase, invitationId)).then(() => undefined),
    respondInvitation: (invitationId, accept) =>
      run(async () => {
        const result = await collaborationApi.respondInvitation(supabase, invitationId, accept, connection)
        if (result.sessionId) {
          setEndedSession(null)
          lastSessionRef.current = result.sessionId
        }
        return result
      }).then(() => undefined),
    requestControl: (withdraw = false) => withSession((s, tab) => collaborationApi.requestControl(supabase, s.id, tab, withdraw)),
    answerControlRequest: (grant) =>
      withSession((s, tab) => collaborationApi.answerControlRequest(supabase, s.id, tab, s.controlGeneration, grant)),
    reclaimControl: () => withSession((s, tab) => collaborationApi.reclaimControl(supabase, s.id, tab)),
    takeOverTab: () => withSession((s, tab) => collaborationApi.join(supabase, s.id, tab, true)),
    rejoin: () => withSession((s, tab) => collaborationApi.join(supabase, s.id, tab, false)),
    leave: () => withSession((s) => collaborationApi.leave(supabase, s.id)),
    end: () => withSession((s) => collaborationApi.end(supabase, s.id)),
    followAgain: () => {
      if (sessionRef.current) writeAway(sessionRef.current.id, false)
      setFollowing(true)
    },
    dismissEnded: () => setEndedSession(null),
    dismissError: () => setError(null),
  }

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>
}
