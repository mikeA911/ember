'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { collaborationApi, sendDisconnectBeacon, startSharedTurnRunner } from '@/lib/collaboration/api'
import { getTabConnectionId } from '@/lib/collaboration/connection'
import { CollaborationError } from '@/lib/collaboration/errors'
import { decideFollow, followTarget } from '@/lib/collaboration/follow'
import { sharedPath } from '@/lib/collaboration/locations'
import { nextPollDelay, POLL } from '@/lib/collaboration/transport'
import type {
  CollaborationInvitation,
  CollaborationStatus,
  SessionSnapshot,
  SharedChat,
  SharedEvidence,
  SharedTextFieldName,
  WatchableSession,
  WatchSnapshot,
} from '@/lib/collaboration/types'

// Shared workspace sessions, Phase 1 (docs/dev-request-shared-workspace-
// sessions.md). Mounted by the signed-in layout only when the feature flag
// is on, so it persists across every route: it polls the session state,
// joins this tab, makes an observer's tab follow the controller between the
// Project and Workstream pages, and reports the controller's own moves.
// It also reports whether the person is using the tab (any input), which
// drives "away", the inactivity end and the faster invitation poll.
// A viewer who chooses Watch gets the same following in that one tab,
// polling the session only while watching.
// The database decides everything; this only renders and asks.

// Input this long after the previous input counts as coming back: poll at
// once so the other person (and any waiting invitation) catches up.
const RETURN_AFTER_MS = 60_000
// Warn this long before the session ends on its own.
export const END_WARNING_SECONDS = 5 * 60

interface CollaborationContextValue {
  userId: string
  session: SessionSnapshot | null
  incoming: CollaborationInvitation[]
  outgoing: CollaborationInvitation[]
  endedSession: SessionSnapshot | null
  // A viewer's watching: the session this tab watches, live sessions they
  // could watch, and the last watched one if it ended.
  watch: WatchSnapshot | null
  watchable: WatchableSession[]
  endedWatch: WatchSnapshot | null
  following: boolean
  busy: boolean
  error: string | null
  invite: (projectId: string, inviteeId: string, conversationId?: string | null) => Promise<CollaborationInvitation | null>
  cancelInvitation: (invitationId: string) => Promise<void>
  respondInvitation: (invitationId: string, accept: boolean) => Promise<void>
  requestControl: (withdraw?: boolean) => Promise<void>
  answerControlRequest: (grant: boolean) => Promise<void>
  reclaimControl: () => Promise<void>
  takeControl: () => Promise<void>
  stillHere: () => void
  takeOverTab: () => Promise<void>
  rejoin: () => Promise<void>
  leave: () => Promise<void>
  end: () => Promise<void>
  watchSession: (sessionId: string) => Promise<void>
  stopWatching: () => Promise<void>
  dismissEndedWatch: () => void
  followAgain: () => void
  // Phase 2: shared editing by the person in control. These throw a
  // CollaborationError for the field to show (not the bar).
  setDraft: (field: SharedTextFieldName, targetId: string, value: string, rebase?: boolean) => Promise<void>
  discardDraft: (field: SharedTextFieldName, targetId: string) => Promise<void>
  saveField: (field: SharedTextFieldName, targetId: string) => Promise<void>
  setDeliverable: (workstreamId: string, index: number, label: string, completed: boolean) => Promise<void>
  // A field with typing not yet sent registers how to send it, so it goes
  // out before control is handed over or the person leaves.
  registerPendingDraft: (key: string, flush: () => Promise<void>) => () => void
  // Phase 3: the shared Ember chat. These throw a CollaborationError for
  // the chat to show (not the bar).
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  loadChat: (conversationId: string) => Promise<SharedChat>
  askEmber: (content: string, request: string) => Promise<void>
  postComment: (conversationId: string, content: string, request: string) => Promise<void>
  queueTurn: (messageId: string) => Promise<void>
  updateProposal: (messageId: string, index: number, status: 'applied' | 'dismissed') => Promise<void>
  projectAudienceOk: (conversationId: string, evidence: SharedEvidence[], requirePrivate: boolean) => Promise<boolean>
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
  const [status, setStatus] = useState<CollaborationStatus>({ session: null, incoming: [], outgoing: [], watchable: [] })
  const [endedSession, setEndedSession] = useState<SessionSnapshot | null>(null)
  const [watch, setWatch] = useState<WatchSnapshot | null>(null)
  const [endedWatch, setEndedWatch] = useState<WatchSnapshot | null>(null)
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
  const watchRef = useRef<WatchSnapshot | null>(null)
  // While watching, the general status poll (invitations, watchable
  // sessions) runs at its usual idle pace, not every watch poll.
  const lastStatusAtRef = useRef(0)
  // Last input in this tab, and the last input already reported.
  const lastInputRef = useRef(0)
  const lastReportedRef = useRef(0)
  const lastPollStartRef = useRef(0)
  // For the closing-tab beacon, which can't wait for the Supabase client.
  const accessTokenRef = useRef<string | null>(null)
  useEffect(() => {
    lastInputRef.current = Date.now()
  }, [])
  useEffect(() => {
    sessionRef.current = status.session
  }, [status.session])
  useEffect(() => {
    watchRef.current = watch
  }, [watch])

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

  // The watched session's latest state; ends watching when the session
  // ended or another of this person's tabs took over.
  const applyWatch = useCallback((next: WatchSnapshot | null) => {
    if (!next || next.status === 'ended' || !next.thisTabWatching) {
      if (next?.status === 'ended') setEndedWatch(next)
      watchRef.current = null
      setWatch(null)
      return
    }
    if (watchRef.current?.id !== next.id) setFollowing(!readAway(next.id))
    watchRef.current = next
    setWatch((prev) => (prev && prev.id === next.id && next.stateRevision < prev.stateRevision ? prev : next))
  }, [])

  const poll = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current)
    // From this response, not sessionRef: the ref only catches up after
    // the next render, and the poll that first finds a session must
    // already switch to the fast in-session interval.
    let inSession = !!sessionRef.current
    let waiting = false
    const startedAt = Date.now()
    lastPollStartRef.current = startedAt
    const active = lastInputRef.current > lastReportedRef.current
    const recentlyActive = Date.now() - lastInputRef.current < POLL.recentlyActiveMs
    let watching = false
    const watched = watchRef.current
    if (watched && connection) {
      try {
        const next = await collaborationApi.watchStatus(supabase, watched.id, connection)
        applyWatch(next)
        watching = next.status === 'active' && next.thisTabWatching
        failuresRef.current = 0
      } catch (err) {
        if (err instanceof CollaborationError && err.kind === 'denied') applyWatch(null)
        else {
          failuresRef.current += 1
          watching = true
        }
      }
    }
    const statusDue = !watching || startedAt - lastStatusAtRef.current >= (recentlyActive ? POLL.idleActiveVisibleMs : POLL.idleVisibleMs)
    if (statusDue) {
      try {
        const result = await collaborationApi.status(supabase, connection, lastSessionRef.current, active)
        lastStatusAtRef.current = startedAt
        if (active) lastReportedRef.current = startedAt
        if (!watching) failuresRef.current = 0
        setStatus((prev) => ({ ...prev, incoming: result.incoming, outgoing: result.outgoing, watchable: result.watchable ?? [] }))
        applySession(result.session)
        inSession = result.session?.status === 'active'
        waiting = result.outgoing.length > 0
      } catch {
        if (!watching) failuresRef.current += 1
      }
    }
    if (inSession || watching) accessTokenRef.current = (await supabase.auth.getSession()).data.session?.access_token ?? null
    const delay = nextPollDelay({
      inSession: inSession || watching,
      waiting,
      recentlyActive,
      hidden: typeof document !== 'undefined' && document.visibilityState === 'hidden',
      consecutiveFailures: failuresRef.current,
    })
    timerRef.current = setTimeout(() => pollRef.current(), delay)
  }, [supabase, connection, applySession, applyWatch])
  useEffect(() => {
    pollRef.current = poll
  }, [poll])

  useEffect(() => {
    if (!connection) return
    poll()
    const onVisible = () => {
      if (document.visibilityState === 'visible') poll()
    }
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) poll()
    }
    // Closing the tab (or leaving Ember) tells the database at once, so the
    // other person sees "not connected" without waiting out the window.
    // A reload sends it too and then rejoins as the same tab.
    const onHide = () => {
      if (!accessTokenRef.current) return
      const s = sessionRef.current
      const w = watchRef.current
      const target = s?.thisTabJoined
        ? { sessionId: s.id, fn: 'collaboration_disconnect' as const }
        : w?.thisTabWatching
          ? { sessionId: w.id, fn: 'collaboration_stop_watching' as const }
          : null
      if (!target) return
      sendDisconnectBeacon({
        supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL!,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        accessToken: accessTokenRef.current,
        connection,
        ...target,
      })
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', poll)
    window.addEventListener('pageshow', onShow)
    window.addEventListener('pagehide', onHide)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', poll)
      window.removeEventListener('pageshow', onShow)
      window.removeEventListener('pagehide', onHide)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [connection, poll])

  // Activity: any input in this tab. Coming back after a quiet minute, or
  // while shown as away or warned about the end, polls straight away.
  useEffect(() => {
    const onInput = (event: Event) => {
      const now = Date.now()
      const previous = lastInputRef.current
      const s = sessionRef.current
      const me = s ? (s.myRole === 'host' ? s.host : s.guest) : null
      // Shown as away, or warned the session is about to end: report this
      // input now, whatever kind it is.
      const urgent = !!me?.away || (s?.endsInSeconds != null && s.endsInSeconds <= END_WARNING_SECONDS)
      // Pointer movement is frequent: once there's unreported input, more
      // movement adds nothing. Any movement since the last poll counts.
      if (event.type === 'pointermove' && !urgent && lastInputRef.current > lastReportedRef.current) return
      lastInputRef.current = now
      if ((now - previous > RETURN_AFTER_MS || urgent) && now - lastPollStartRef.current > 2_000) pollRef.current()
    }
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll'] as const
    for (const e of events) window.addEventListener(e, onInput, { passive: true, capture: true })
    return () => {
      for (const e of events) window.removeEventListener(e, onInput, { capture: true })
    }
  }, [])

  // A hidden tab can't show the bar, so an invitation shows in its title.
  const invitationCount = status.incoming.length
  useEffect(() => {
    let original: string | null = null
    let ours: string | null = null
    const update = () => {
      const want = document.visibilityState === 'hidden' && invitationCount > 0
      if (want && ours === null) {
        original = document.title
        ours = `(${invitationCount}) Invitation · ${original}`
        document.title = ours
      } else if (!want && ours !== null) {
        if (document.title === ours && original !== null) document.title = original
        original = null
        ours = null
      }
    }
    update()
    document.addEventListener('visibilitychange', update)
    return () => {
      document.removeEventListener('visibilitychange', update)
      if (ours !== null && document.title === ours && original !== null) document.title = original
    }
  }, [invitationCount])

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
  // A watcher's tab follows the same way (watchers never have control).
  const target =
    followTarget(session, userId, following) ??
    (watch && following && !session?.thisTabJoined ? sharedPath(watch.projectId, watch.location.workstreamId) : null)
  useEffect(() => {
    if (target && window.location.pathname.replace(/\/+$/, '').toLowerCase() !== target.toLowerCase()) router.push(target)
  }, [target, router])

  // An observer who navigates somewhere else on their own stops following
  // until they choose to follow again (or come back to the shared page).
  useEffect(() => {
    const s = sessionRef.current
    const w = watchRef.current
    const current =
      s?.thisTabJoined && s.controllerId !== userId
        ? { id: s.id, projectId: s.projectId, workstreamId: s.location.workstreamId }
        : w && !s?.thisTabJoined
          ? { id: w.id, projectId: w.projectId, workstreamId: w.location.workstreamId }
          : null
    if (!current) return
    const target = sharedPath(current.projectId, current.workstreamId)
    const away = pathname.replace(/\/+$/, '').toLowerCase() !== target.toLowerCase()
    writeAway(current.id, away)
    setFollowing(!away)
    // Only the person's own navigation (a pathname change) counts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  // Phase 3: shared chat. Work waiting with nobody running it (after a
  // reload, a closed tab, or a run that stopped): start the runner from
  // this joined tab, at most every 15 seconds. Both of the pair may do so;
  // the database runs one turn at a time.
  const [chatOpen, setChatOpen] = useState(false)
  const loadChat = useCallback((conversationId: string) => collaborationApi.chat(supabase, conversationId), [supabase])
  const runnerKickedRef = useRef(0)
  const needsRunner = !!session && session.status === 'active' && session.thisTabJoined && session.chat?.needsRunner
  useEffect(() => {
    if (!needsRunner || !session) return
    if (Date.now() - runnerKickedRef.current < 15_000) return
    runnerKickedRef.current = Date.now()
    void startSharedTurnRunner(session.conversationId)
  }, [needsRunner, session])

  const pendingDraftsRef = useRef(new Map<string, () => Promise<void>>())
  const flushPendingDrafts = useCallback(async () => {
    await Promise.allSettled([...pendingDraftsRef.current.values()].map((flush) => flush()))
  }, [])

  // An edit by the person in control, on the generation this tab last saw.
  // Applies the returned snapshot; errors go to the caller.
  const edit = useCallback(
    async (action: (s: { sessionId: string; connection: string; generation: number }) => Promise<SessionSnapshot>) => {
      const s = sessionRef.current
      if (!s || !connection || !s.thisTabJoined) throw new CollaborationError('This tab isn’t in the live session.', 'stale')
      try {
        applySession(await action({ sessionId: s.id, connection, generation: s.controlGeneration }))
      } catch (err) {
        if (err instanceof CollaborationError && err.kind === 'stale') pollRef.current()
        throw err
      }
    },
    [connection, applySession]
  )

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
    watch,
    watchable: status.watchable,
    endedWatch,
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
          // Joining a session of your own ends watching (the database too).
          applyWatch(null)
        }
        return result
      }).then(() => undefined),
    requestControl: (withdraw = false) => withSession((s, tab) => collaborationApi.requestControl(supabase, s.id, tab, withdraw)),
    answerControlRequest: async (grant) => {
      // Typing not yet sent goes out before control moves.
      if (grant) await flushPendingDrafts()
      return withSession((s, tab) => collaborationApi.answerControlRequest(supabase, s.id, tab, s.controlGeneration, grant))
    },
    reclaimControl: () => withSession((s, tab) => collaborationApi.reclaimControl(supabase, s.id, tab)),
    takeControl: () => withSession((s, tab) => collaborationApi.takeControl(supabase, s.id, tab)),
    stillHere: () => {
      lastInputRef.current = Date.now()
      pollRef.current()
    },
    takeOverTab: () => withSession((s, tab) => collaborationApi.join(supabase, s.id, tab, true)),
    rejoin: () => withSession((s, tab) => collaborationApi.join(supabase, s.id, tab, false)),
    leave: async () => {
      await flushPendingDrafts()
      return withSession((s) => collaborationApi.leave(supabase, s.id))
    },
    end: () => withSession((s) => collaborationApi.end(supabase, s.id)),
    watchSession: (sessionId) =>
      run(async () => {
        if (!connection) return null
        const next = await collaborationApi.watch(supabase, sessionId, connection)
        setEndedWatch(null)
        applyWatch(next)
        return next
      }).then(() => undefined),
    stopWatching: () =>
      run(async () => {
        const w = watchRef.current
        if (w && connection) await collaborationApi.stopWatching(supabase, w.id, connection)
        applyWatch(null)
        return null
      }).then(() => undefined),
    dismissEndedWatch: () => setEndedWatch(null),
    setDraft: (field, targetId, value, rebase = false) => edit((s) => collaborationApi.setDraft(supabase, s, field, targetId, value, rebase)),
    discardDraft: (field, targetId) => edit((s) => collaborationApi.discardDraft(supabase, s, field, targetId)),
    saveField: (field, targetId) => edit((s) => collaborationApi.saveField(supabase, s, field, targetId, crypto.randomUUID())),
    setDeliverable: (workstreamId, index, label, completed) =>
      edit((s) => collaborationApi.setDeliverable(supabase, s, workstreamId, index, label, completed, crypto.randomUUID())),
    registerPendingDraft: (key, flush) => {
      pendingDraftsRef.current.set(key, flush)
      return () => {
        if (pendingDraftsRef.current.get(key) === flush) pendingDraftsRef.current.delete(key)
      }
    },
    followAgain: () => {
      const id = sessionRef.current?.thisTabJoined ? sessionRef.current.id : watchRef.current?.id
      if (id) writeAway(id, false)
      setFollowing(true)
    },
    chatOpen,
    setChatOpen,
    loadChat,
    askEmber: async (content, request) => {
      const s = sessionRef.current
      if (!s || !connection || !s.thisTabJoined) throw new CollaborationError('This tab isn’t in the live session.', 'stale')
      await collaborationApi.askEmber(supabase, s.id, connection, content, request)
      void startSharedTurnRunner(s.conversationId)
      pollRef.current()
    },
    postComment: async (conversationId, content, request) => {
      await collaborationApi.postComment(supabase, conversationId, content, request)
      pollRef.current()
    },
    queueTurn: async (messageId) => {
      const s = sessionRef.current
      if (!s || !connection || !s.thisTabJoined) throw new CollaborationError('This tab isn’t in the live session.', 'stale')
      await collaborationApi.queueTurn(supabase, s.id, connection, messageId)
      void startSharedTurnRunner(s.conversationId)
      pollRef.current()
    },
    updateProposal: async (messageId, index, status) => {
      await collaborationApi.updateProposal(supabase, messageId, index, status)
    },
    projectAudienceOk: (conversationId, evidence, requirePrivate) => collaborationApi.projectAudienceOk(supabase, conversationId, evidence, requirePrivate),
    dismissEnded: () => setEndedSession(null),
    dismissError: () => setError(null),
  }

  return <CollaborationContext.Provider value={value}>{children}</CollaborationContext.Provider>
}
