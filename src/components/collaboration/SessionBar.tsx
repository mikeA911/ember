'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { isAtSharedLocation } from '@/lib/collaboration/follow'
import { sharedPath } from '@/lib/collaboration/locations'
import type { CollaborationPerson, SessionSnapshot } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// The persistent session bar under the header: who is in the live session,
// who has control, connection state, and every control the person may use.
// Also carries invitations (incoming and outgoing) and the "session ended"
// notice. Renders nothing when the feature is off or nothing is going on.

const END_REASONS: Record<NonNullable<SessionSnapshot['endReason']>, string> = {
  ended_by_host: 'The host ended the live session.',
  everyone_left: 'Everyone left, so the live session ended.',
  expired: 'The live session ended after a period with nobody connected.',
  access_revoked: 'The live session ended because one of you no longer has access to this Project.',
}

const button = 'rounded border px-2 py-0.5 text-xs font-medium disabled:opacity-50'
const primary = `${button} border-amber-700 bg-amber-700 text-white hover:bg-amber-800`
const secondary = `${button} border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50`

function Presence({ person, inControl, you }: { person: CollaborationPerson; inControl: boolean; you: boolean }) {
  const state = person.left ? 'left' : person.present ? 'connected' : 'not connected'
  return (
    <span className="inline-flex items-center gap-1">
      <span
        aria-hidden
        className={`inline-block h-2 w-2 rounded-full ${person.left ? 'bg-zinc-300' : person.present ? 'bg-emerald-500' : 'bg-amber-400'}`}
      />
      <span className={inControl ? 'font-semibold' : ''}>
        {person.name}
        {you ? ' (you)' : ''}
      </span>
      <span className="sr-only">, {state}</span>
      {inControl && <span className="rounded bg-amber-100 px-1 text-[10px] font-medium uppercase tracking-wide text-amber-800">In control</span>}
    </span>
  )
}

export function SessionBar() {
  const collab = useCollaboration()
  const pathname = usePathname()
  const [confirmEnd, setConfirmEnd] = useState(false)
  if (!collab) return null
  const { session, incoming, outgoing, endedSession, busy, error } = collab

  const notices: React.ReactNode[] = []

  for (const invitation of incoming) {
    notices.push(
      <div key={invitation.id} className="flex flex-wrap items-center gap-2" role="status">
        <span>
          <strong>{invitation.inviterName}</strong> invited you to a live session on <strong>{invitation.projectName}</strong>
          {invitation.conversationId ? ' (resuming your shared conversation)' : ''}. You’ll see the Project and Workstream pages they open, and can ask for control.
        </span>
        <button type="button" className={primary} disabled={busy || !!session} onClick={() => collab.respondInvitation(invitation.id, true)}>
          Accept
        </button>
        <button type="button" className={secondary} disabled={busy} onClick={() => collab.respondInvitation(invitation.id, false)}>
          Decline
        </button>
        {session && <span className="text-xs text-zinc-500">Leave your current live session to accept.</span>}
      </div>
    )
  }

  if (!session) {
    for (const invitation of outgoing) {
      notices.push(
        <div key={invitation.id} className="flex flex-wrap items-center gap-2" role="status">
          <span>
            Waiting for <strong>{invitation.inviteeName}</strong> to accept your invitation to <strong>{invitation.projectName}</strong>.
          </span>
          <button type="button" className={secondary} disabled={busy} onClick={() => collab.cancelInvitation(invitation.id)}>
            Cancel invitation
          </button>
        </div>
      )
    }
    if (endedSession) {
      notices.push(
        <div key="ended" className="flex flex-wrap items-center gap-2" role="status">
          <span>{endedSession.endReason ? END_REASONS[endedSession.endReason] : 'The live session ended.'}</span>
          {endedSession.endReason !== 'access_revoked' && (
            <Link href={`/projects/${endedSession.projectId}/shared/${endedSession.conversationId}`} className="text-xs underline">
              Open shared conversation
            </Link>
          )}
          <button type="button" className={secondary} onClick={collab.dismissEnded}>
            Dismiss
          </button>
        </div>
      )
    }
  }

  if (session) notices.unshift(<LiveSession key="live" session={session} pathname={pathname} confirmEnd={confirmEnd} setConfirmEnd={setConfirmEnd} />)

  if (notices.length === 0 && !error) return null
  return (
    <div className="sticky top-0 z-30 border-b border-amber-200 bg-amber-50 text-sm text-zinc-800" aria-label="Live collaboration">
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-2">
        {notices}
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-700" role="alert">
            <span>{error}</span>
            <button type="button" className="underline" onClick={collab.dismissError}>
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function LiveSession({
  session,
  pathname,
  confirmEnd,
  setConfirmEnd,
}: {
  session: SessionSnapshot
  pathname: string
  confirmEnd: boolean
  setConfirmEnd: (v: boolean) => void
}) {
  const collab = useCollaboration()!
  const { userId, busy, following } = collab
  const isHost = session.myRole === 'host'
  const inControl = session.controllerId === userId
  const other = isHost ? session.guest : session.host
  const requestedByOther = session.controlRequestedBy === other.id
  const requestedByMe = session.controlRequestedBy === userId
  const here = isAtSharedLocation(session, pathname)
  const sharedHref = sharedPath(session.projectId, session.location.workstreamId)
  const sharedLabel = session.location.workstreamName ? `${session.location.workstreamName} (workstream)` : `${session.projectName} (Project page)`

  const header = (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-1 font-medium text-amber-900">
        <span aria-hidden className="inline-block h-2 w-2 animate-pulse rounded-full bg-red-500" />
        Live · {session.projectName}
      </span>
      <Presence person={session.host} inControl={session.controllerId === session.host.id} you={isHost} />
      <Presence person={session.guest} inControl={session.controllerId === session.guest.id} you={!isHost} />
      <span className="text-xs text-zinc-500">Showing: {sharedLabel}</span>
    </div>
  )

  if (session.otherTabActive && !session.thisTabJoined) {
    return (
      <div className="flex flex-col gap-1">
        {header}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>This live session is open in another of your tabs.</span>
          <button type="button" className={secondary} disabled={busy} onClick={collab.takeOverTab}>
            Use this tab instead
          </button>
        </div>
      </div>
    )
  }

  if (session.iLeft) {
    return (
      <div className="flex flex-col gap-1">
        {header}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span>You left this live session. {other.name} is still in it.</span>
          <button type="button" className={secondary} disabled={busy} onClick={collab.rejoin}>
            Rejoin
          </button>
        </div>
      </div>
    )
  }

  if (!session.thisTabJoined) {
    return (
      <div className="flex flex-col gap-1">
        {header}
        <span className="text-xs text-zinc-500">Connecting…</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      {header}
      <div className="flex flex-wrap items-center gap-2 text-xs">
        {!other.present && !other.left && <span className="text-amber-800">{other.name} isn’t connected right now; they’ll catch up when they return.</span>}
        {other.left && <span className="text-zinc-600">{other.name} left the session.</span>}

        {inControl && requestedByOther && (
          <>
            <span className="font-medium">{other.name} is asking for control.</span>
            <button type="button" className={primary} disabled={busy} onClick={() => collab.answerControlRequest(true)}>
              Give control
            </button>
            <button type="button" className={secondary} disabled={busy} onClick={() => collab.answerControlRequest(false)}>
              Decline
            </button>
          </>
        )}
        {inControl && !here && (
          <span>
            This page isn’t shared — {other.name} still sees{' '}
            <Link href={sharedHref} className="underline">
              {sharedLabel}
            </Link>
            .
          </span>
        )}
        {inControl && here && !requestedByOther && <span className="text-zinc-600">You’re in control: {other.name} follows the Project and Workstream pages you open.</span>}

        {!inControl && !requestedByMe && (
          <button type="button" className={secondary} disabled={busy} onClick={() => collab.requestControl()}>
            Ask for control
          </button>
        )}
        {!inControl && requestedByMe && (
          <>
            <span>Waiting for {other.name} to answer your request…</span>
            <button type="button" className={secondary} disabled={busy} onClick={() => collab.requestControl(true)}>
              Withdraw
            </button>
          </>
        )}
        {!inControl && isHost && (
          <button type="button" className={secondary} disabled={busy} onClick={collab.reclaimControl}>
            Take control back
          </button>
        )}
        {!inControl && !following && (
          <>
            <span>You’ve stepped away from the shared view.</span>
            <button type="button" className={secondary} onClick={collab.followAgain}>
              Follow {other.name} again
            </button>
          </>
        )}

        <span className="ml-auto flex items-center gap-2">
          <Link href={`/projects/${session.projectId}/shared/${session.conversationId}`} className="underline text-zinc-600">
            Shared conversation
          </Link>
          <button type="button" className={secondary} disabled={busy} onClick={collab.leave}>
            Leave
          </button>
          {isHost &&
            (confirmEnd ? (
              <>
                <span>End for both of you?</span>
                <button
                  type="button"
                  className={primary}
                  disabled={busy}
                  onClick={() => {
                    setConfirmEnd(false)
                    collab.end()
                  }}
                >
                  End session
                </button>
                <button type="button" className={secondary} onClick={() => setConfirmEnd(false)}>
                  Keep going
                </button>
              </>
            ) : (
              <button type="button" className={secondary} disabled={busy} onClick={() => setConfirmEnd(true)}>
                End session
              </button>
            ))}
        </span>
      </div>
    </div>
  )
}
