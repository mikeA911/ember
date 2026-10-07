'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Markdown } from '@/components/shared/Markdown'
import { publishSummaryAction, sendProposedNoteAction } from '@/app/actions/collaboration'
import { CollaborationError } from '@/lib/collaboration/errors'
import { FIELD_LABELS } from '@/lib/collaboration/format'
import type { SharedChat, SharedChatMessage, SharedProposal, SharedProposalUse } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// Shared workspace sessions, Phase 3: what Ember proposes under an answer
// (a Project note, or text for a field), and the conversation's summary.
// Ember never acts; a person does, with their own rights -- and only when
// every Project member can open what the answer or summary drew on (the
// database checks; a note or a field reaches more people than the chat).

const errorText = (err: unknown) => (err instanceof CollaborationError ? err.message : 'That didn’t work. Try again.')
const button = 'rounded border border-zinc-300 bg-white px-2 py-1 text-xs text-zinc-700 hover:bg-zinc-50 disabled:opacity-50'

export function Proposals({
  message,
  chat,
  onChanged,
}: {
  message: SharedChatMessage
  chat: SharedChat
  onChanged: () => void
}) {
  if (!message.proposals?.length) return null
  return (
    <div className="mt-2 flex flex-col gap-2">
      {message.proposals.map((p, i) => (
        <ProposalCard
          key={i}
          proposal={p}
          index={i}
          message={message}
          chat={chat}
          use={chat.proposalUses.find((u) => u.messageId === message.id && u.index === i)}
          onChanged={onChanged}
        />
      ))}
    </div>
  )
}

function ProposalCard({
  proposal,
  index,
  message,
  chat,
  use,
  onChanged,
}: {
  proposal: SharedProposal
  index: number
  message: SharedChatMessage
  chat: SharedChat
  use: SharedProposalUse | undefined
  onChanged: () => void
}) {
  const collab = useCollaboration()!
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reviewing, setReviewing] = useState(false)
  const [subject, setSubject] = useState(proposal.kind === 'note' ? proposal.subject : '')
  const [body, setBody] = useState(proposal.kind === 'note' ? proposal.body : '')
  const isParticipant = chat.myRole === 'participant'
  const done = use && use.status !== 'failed'

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      onChanged()
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }
  const dismiss = () => attempt(() => collab.updateProposal(message.id, index, 'dismissed'))

  const status = use && (
    <p className="text-xs text-zinc-500">
      {use.status === 'sent' && (
        <>
          Sent by {use.byName}
          {use.result.noteId && (
            <>
              {' · '}
              <Link href={`/projects/${chat.projectId}/notes/${use.result.noteId}`} className="underline">
                open note
              </Link>
            </>
          )}
        </>
      )}
      {use.status === 'sending' && `${use.byName} is sending it…`}
      {use.status === 'failed' && <span className="text-red-700">Not sent: {use.result.error ?? 'it failed'}.</span>}
      {use.status === 'applied' && `${use.byName} put it into the shared draft.`}
      {use.status === 'dismissed' && `Dismissed by ${use.byName}.`}
    </p>
  )

  if (proposal.kind === 'note') {
    return (
      <div className="rounded border border-sky-200 bg-sky-50/50 p-2 text-sm" data-proposal="note">
        <p className="text-xs font-medium text-sky-900">
          Proposed Project note to {proposal.recipientName}: “{proposal.subject}”
        </p>
        {!reviewing && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-zinc-700">{proposal.body}</p>}
        {reviewing && (
          <form
            className="mt-1 flex flex-col gap-1"
            onSubmit={(e) => {
              e.preventDefault()
              void attempt(async () => {
                const result = await sendProposedNoteAction({ messageId: message.id, index, subject, body })
                if (!result.ok) throw new CollaborationError(result.error, 'general')
                setReviewing(false)
              })
            }}
          >
            <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="rounded border border-zinc-300 px-2 py-1" aria-label="Note subject" />
            <textarea value={body} rows={5} maxLength={4000} onChange={(e) => setBody(e.target.value)} className="rounded border border-zinc-300 px-2 py-1" aria-label="Note body" />
            <p className="text-xs text-zinc-500">You’ll be the note’s author.</p>
            <div className="flex gap-2">
              <button disabled={busy || !subject.trim() || !body.trim()} className={button}>
                {busy ? 'Sending…' : 'Send note'}
              </button>
              <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setReviewing(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
        {status}
        {isParticipant && !done && !reviewing && (
          <div className="mt-1 flex gap-2">
            <button type="button" className={button} disabled={busy} onClick={() => setReviewing(true)}>
              Review and send
            </button>
            <button type="button" className="text-xs text-zinc-500 underline" disabled={busy} onClick={() => void dismiss()}>
              Dismiss
            </button>
          </div>
        )}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    )
  }

  // Field text: the person in control, on the field's page, with the right
  // to edit it, puts it into the shared draft (then reviews and saves).
  const session = collab.session?.status === 'active' && collab.session.thisTabJoined ? collab.session : null
  const state = session?.fields.find((f) => f.field === proposal.field && f.targetId.toLowerCase() === proposal.targetId.toLowerCase())
  const canApply = !!session && session.controllerId === collab.userId && !!state && state.canEdit
  const label = `${FIELD_LABELS[proposal.field]}${proposal.targetName ? ` (${proposal.targetName})` : ''}`
  const where = proposal.field === 'workstream_summary' ? `the ${proposal.targetName ?? ''} workstream page` : 'the Project page'
  return (
    <div className="rounded border border-violet-200 bg-violet-50/50 p-2 text-sm" data-proposal="field">
      <p className="text-xs font-medium text-violet-900">Proposed {label}</p>
      <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-zinc-700">{proposal.text}</p>
      {status}
      {isParticipant && !done && (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          {canApply ? (
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() =>
                void attempt(async () => {
                  if (!(await collab.projectAudienceOk(chat.conversationId, message.evidence ?? [], true))) {
                    throw new CollaborationError(
                      'This text drew on sources that not everyone who can see this field can open, so it can’t be used here. Write the field yourself instead.',
                      'general'
                    )
                  }
                  await collab.setDraft(proposal.field, proposal.targetId, proposal.text)
                  await collab.updateProposal(message.id, index, 'applied')
                })
              }
            >
              Put in shared draft
            </button>
          ) : (
            <span className="text-xs text-zinc-500">To use it: have control, with rights to edit it, on {where}.</span>
          )}
          <button type="button" className="text-xs text-zinc-500 underline" disabled={busy} onClick={() => void dismiss()}>
            Dismiss
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}

// The summary of the conversation's earlier part, and publishing it.
export function SummaryPanel({ chat, onChanged }: { chat: SharedChat; onChanged: () => void }) {
  const summary = chat.summary
  const [open, setOpen] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [subject, setSubject] = useState('Summary of our shared conversation')
  const [body, setBody] = useState(summary?.content ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!summary) {
    return chat.summaryHidden ? (
      <p className="text-xs italic text-zinc-500">The summary of earlier messages drew on sources you can’t open.</p>
    ) : null
  }
  return (
    <div className="rounded border border-zinc-200 bg-zinc-50 p-3 text-sm" data-chat-summary>
      <button type="button" className="text-xs font-medium text-zinc-600 underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide' : 'Show'} summary of earlier messages
      </button>
      {open && (
        <div className="mt-2">
          <Markdown text={summary.content} />
          {summary.publishedNoteId ? (
            <p className="mt-2 text-xs text-zinc-500">
              Published as a{' '}
              <Link href={`/projects/${chat.projectId}/notes/${summary.publishedNoteId}`} className="underline">
                Project note
              </Link>
              .
            </p>
          ) : chat.myRole === 'participant' && !publishing ? (
            <button
              type="button"
              className={`${button} mt-2`}
              onClick={() => {
                setBody(summary.content)
                setPublishing(true)
              }}
            >
              Publish as Project note
            </button>
          ) : null}
          {publishing && (
            <form
              className="mt-2 flex flex-col gap-1"
              onSubmit={(e) => {
                e.preventDefault()
                setBusy(true)
                setError(null)
                void publishSummaryAction({ conversationId: chat.conversationId, summaryId: summary.id, subject, body }).then((result) => {
                  setBusy(false)
                  if (!result.ok) return setError(result.error)
                  setPublishing(false)
                  onChanged()
                })
              }}
            >
              <p className="text-xs text-zinc-500">Review it first: it goes to the whole project team, with you as its author.</p>
              <input value={subject} maxLength={200} onChange={(e) => setSubject(e.target.value)} className="rounded border border-zinc-300 px-2 py-1" aria-label="Note subject" />
              <textarea value={body} rows={8} maxLength={4000} onChange={(e) => setBody(e.target.value)} className="rounded border border-zinc-300 px-2 py-1" aria-label="Note body" />
              <div className="flex gap-2">
                <button disabled={busy || !subject.trim() || !body.trim()} className={button}>
                  {busy ? 'Publishing…' : 'Publish'}
                </button>
                <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setPublishing(false)}>
                  Cancel
                </button>
              </div>
              {error && <p className="text-xs text-red-600">{error}</p>}
            </form>
          )}
        </div>
      )}
    </div>
  )
}
