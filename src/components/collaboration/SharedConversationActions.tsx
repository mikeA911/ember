'use client'

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { useCollaboration } from './CollaborationProvider'

// Resume a shared conversation: invite the same person to a new live
// session on it. The bar handles a live session already going on.
export function SharedConversationActions({
  projectId,
  conversationId,
  otherUserId,
  otherName,
  liveSessionId,
  pendingInvitationId,
}: {
  projectId: string
  conversationId: string
  otherUserId: string
  otherName: string
  liveSessionId: string | null
  pendingInvitationId: string | null
}) {
  const collab = useCollaboration()
  const router = useRouter()
  const live = collab?.session?.conversationId === conversationId ? collab.session : null
  // The page's session list is server-rendered: refresh it when a live
  // session on this conversation starts or ends.
  const liveId = live?.id ?? null
  const seen = useRef(liveId)
  useEffect(() => {
    if (seen.current !== liveId) router.refresh()
    seen.current = liveId
  }, [liveId, router])
  if (!collab) return null
  const waiting = collab.outgoing.find((i) => i.conversationId === conversationId)
  const invited = collab.incoming.find((i) => i.conversationId === conversationId)

  if (live || liveSessionId) {
    return <p className="text-sm text-zinc-600">A live session on this conversation is going on now — see the bar at the top of the page.</p>
  }
  if (invited) {
    return <p className="text-sm text-zinc-600">{otherName} has invited you to resume — accept in the bar at the top of the page.</p>
  }
  if (waiting || pendingInvitationId) {
    return <p className="text-sm text-zinc-600">Waiting for {otherName} to accept your invitation to resume.</p>
  }
  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        disabled={collab.busy || (!!collab.session && !collab.session.iLeft)}
        onClick={() => collab.invite(projectId, otherUserId, conversationId)}
        className="self-start rounded bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-50"
      >
        Invite {otherName} to resume
      </button>
      {collab.error && <p className="text-xs text-red-700">{collab.error}</p>}
    </div>
  )
}
