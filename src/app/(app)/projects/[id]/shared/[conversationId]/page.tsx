import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { collaborationApi } from '@/lib/collaboration/api'
import { collaborationEnabled } from '@/lib/collaboration/flag'
import type { SharedConversationShell } from '@/lib/collaboration/types'
import { SharedConversationActions } from '@/components/collaboration/SharedConversationActions'

// A shared conversation, as both participants see it in their history
// (shared workspace sessions, Phase 1 shell). Read through
// collaboration_conversation, which admits only the two participants while
// both are still active members of the Project. Shared Ember messages
// arrive in Phase 3; nothing from either person's private chats is here.

const END_REASONS: Record<string, string> = {
  ended_by_host: 'ended by the host',
  everyone_left: 'everyone left',
  expired: 'ended after nobody was connected',
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

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <p className="text-xs uppercase tracking-wide text-zinc-500">Shared conversation</p>
        <h1 className="text-xl font-semibold">With {shell.otherName}</h1>
        <p className="mt-1 text-sm text-zinc-500">
          <Link href={`/projects/${shell.projectId}`} className="underline">
            {shell.projectName}
          </Link>{' '}
          · started {when(shell.createdAt)}
        </p>
      </div>

      <p className="text-sm text-zinc-600">
        Only you and {shell.otherName} can see this conversation, and only while you’re both members of this Project. Shared Ember chat for
        live sessions is coming in a later release; nothing from either of your private Ember chats is copied here.
      </p>

      <SharedConversationActions
        projectId={shell.projectId}
        conversationId={shell.id}
        otherUserId={shell.otherUserId}
        otherName={shell.otherName}
        liveSessionId={live?.id ?? null}
        pendingInvitationId={shell.pendingInvitation?.id ?? null}
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
