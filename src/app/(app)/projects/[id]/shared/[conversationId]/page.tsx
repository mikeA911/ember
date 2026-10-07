import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { collaborationApi } from '@/lib/collaboration/api'
import { collaborationEnabled } from '@/lib/collaboration/flag'
import type { SharedConversationShell } from '@/lib/collaboration/types'
import { SharedConversationActions } from '@/components/collaboration/SharedConversationActions'
import { ConversationViewers } from '@/components/collaboration/ConversationViewers'
import { SharedChat } from '@/components/collaboration/SharedChat'

// A shared conversation, as the pair and its viewers see it in their
// history (shared workspace sessions, Phase 1 shell). Read through
// collaboration_conversation, which admits only the pair (while both are
// active members of the Project) and the viewers they added (while they
// are too). Viewers can watch a live session but never control one. The
// shared Ember chat (Phase 3) is the conversation's record: the pair's
// questions and Ember's answers, and viewers' comments; nothing from
// anyone's private chats is here.

const END_REASONS: Record<string, string> = {
  ended_by_host: 'ended by the host',
  ended_by_admin: 'ended by an administrator',
  everyone_left: 'everyone left',
  inactive: 'ended after 30 minutes with nobody active',
  participant_inactive: 'ended after one of you was inactive for an hour',
  expired: 'ended at the 12-hour limit',
  access_revoked: 'ended when access changed',
}

function when(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC'
}

export default async function SharedConversationPage({ params }: { params: Promise<{ id: string; conversationId: string }> }) {
  if (!collaborationEnabled()) notFound()
  const { id, conversationId } = await params
  const supabase = await createClient()
  let shell: SharedConversationShell
  try {
    shell = await collaborationApi.conversation(supabase, conversationId)
  } catch {
    notFound()
  }
  if (shell.projectId !== id) notFound()
  const live = shell.sessions.find((s) => s.status === 'active') ?? null
  // Rollout: resuming needs live collaboration on for this Project.
  const collaborationOn = await collaborationApi.projectEnabled(supabase, shell.projectId).catch(() => false)
  const isViewer = shell.myRole === 'viewer'
  const pairNames = shell.participants.map((p) => p.name).join(' & ')

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Shared conversation</p>
        <h1 className="text-xl font-semibold">{isViewer ? pairNames : `With ${shell.otherName}`}</h1>
        {isViewer && <p className="text-sm text-zinc-500">You’re a viewer of this conversation.</p>}
        <p className="mt-1 text-sm text-zinc-500">
          <Link href={`/projects/${shell.projectId}`} className="underline">
            {shell.projectName}
          </Link>{' '}
          · started {when(shell.createdAt)}
        </p>
      </div>

      <p className="text-sm text-zinc-600">
        {isViewer
          ? `Only ${pairNames} and the viewers they added can see this conversation, while they're members of this Project. You can watch their live sessions; you can't control them.`
          : `Only you, ${shell.otherName} and any viewers you add can see this conversation, while they're members of this Project.`}{' '}
        Nothing from anyone’s private Ember chats is copied here, and Ember answers only from sources everyone in the conversation can open.
      </p>

      <SharedChat conversationId={shell.id} />

      {!isViewer && !collaborationOn && !live && (
        <p className="text-sm text-zinc-500">Live collaboration isn’t turned on for this Project at the moment, so a new live session can’t be started here.</p>
      )}

      {!isViewer && shell.otherUserId && shell.otherName && (collaborationOn || live) && (
        <SharedConversationActions
          projectId={shell.projectId}
          conversationId={shell.id}
          otherUserId={shell.otherUserId}
          otherName={shell.otherName}
          liveSessionId={live?.id ?? null}
          pendingInvitationId={shell.pendingInvitation?.id ?? null}
        />
      )}

      <ConversationViewers
        projectId={shell.projectId}
        conversationId={shell.id}
        isViewer={isViewer}
        participantIds={shell.participants.map((p) => p.userId)}
        initialViewers={shell.viewers}
        liveSessionId={live?.id ?? null}
      />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Live sessions</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {shell.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap gap-x-2">
              <span>{when(s.startedAt)}</span>
              <span className="text-zinc-500">hosted by {s.hostName}</span>
              <span className="text-zinc-500">
                {s.status === 'active' ? '· live now' : `· ${s.endReason ? END_REASONS[s.endReason] ?? 'ended' : 'ended'}${s.endedAt ? ` ${when(s.endedAt)}` : ''}`}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
