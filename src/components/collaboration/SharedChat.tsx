'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { Markdown } from '@/components/shared/Markdown'
import { CollaborationError } from '@/lib/collaboration/errors'
import { orderForDisplay } from '@/lib/collaboration/format'
import type { SharedChat as SharedChatData, SharedChatMessage, SharedEvidence } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'
import { Proposals, SummaryPanel } from './SharedChatExtras'

// Shared workspace sessions, Phase 3: a shared conversation's Ember chat.
// One of the pair asks Ember from their session tab; answers come one at a
// time, in order, for everyone. Viewers read along and comment; either of
// the pair can pass a comment on to Ember. Each person's unsent text stays
// in their own browser.
//
// Reloads when the polled chat state changes -- in a live session or while
// watching. A viewer who isn't watching adds no polling: they reload by
// hand. The database decides what each reader may see: an answer built on
// a source someone can't open shows to them only as hidden.

const MAX_CHARS = 4000

const errorText = (err: unknown) => (err instanceof CollaborationError ? err.message : 'That didn’t work. Try again.')

function evidenceHref(e: SharedEvidence) {
  return e.type === 'wiki_article' ? `/wiki/${encodeURIComponent(e.id)}` : `/sources/${encodeURIComponent(e.id)}`
}

export function SharedChat({ conversationId, compact = false }: { conversationId: string; compact?: boolean }) {
  const collab = useCollaboration()!
  const [chat, setChat] = useState<SharedChatData | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [text, setText] = useState('')
  // Kept until the send succeeds, so a retried send can't post twice.
  const pendingRequest = useRef<string | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)

  const { session, watch, loadChat } = collab
  const inSession = session?.status === 'active' && session.thisTabJoined && session.conversationId === conversationId ? session : null
  const watching = watch?.conversationId === conversationId ? watch : null
  const version = inSession?.chat?.version ?? watching?.chat?.version ?? null

  // Reload now (after posting, or Refresh). Tries three times -- a single
  // dropped request mustn't leave the chat stale -- then says it failed.
  const reload = useCallback(async () => {
    for (let n = 0; n < 3; n++) {
      try {
        setChat(await loadChat(conversationId))
        setLoadError(null)
        return
      } catch (err) {
        if (n === 2) setLoadError(errorText(err))
        else await new Promise((r) => setTimeout(r, 1000 * (n + 1)))
      }
    }
  }, [loadChat, conversationId])

  // Load, and reload whenever the polled chat state changes. A failed load
  // is retried (after 2, 4, 8 s...) -- the next change might be a while.
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const attempt = (n: number) =>
      loadChat(conversationId).then(
        (next) => {
          if (cancelled) return
          setChat(next)
          setLoadError(null)
        },
        (err) => {
          if (cancelled) return
          setLoadError(errorText(err))
          if (n < 6) timer = setTimeout(() => void attempt(n + 1), 2000 * 2 ** Math.min(n, 3))
        }
      )
    void attempt(0)
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [loadChat, conversationId, version])

  const count = chat?.messages.length ?? 0
  useEffect(() => {
    if (count) bottom.current?.scrollIntoView({ block: 'nearest' })
  }, [count])

  if (!chat) {
    return <p className="text-sm text-zinc-500">{loadError ?? 'Loading the shared chat…'}</p>
  }

  const isViewer = chat.myRole === 'viewer'
  // Ember answers while both of the pair are in the live session.
  const canAsk = !isViewer && !!inSession && !inSession.host.left && !inSession.guest.left
  const byId = new Map(chat.messages.map((m) => [m.id, m]))

  async function send() {
    const content = text.trim()
    if (!content) return
    pendingRequest.current ??= crypto.randomUUID()
    setSending(true)
    setSendError(null)
    try {
      if (isViewer) await collab.postComment(conversationId, content, pendingRequest.current)
      else await collab.askEmber(content, pendingRequest.current)
      pendingRequest.current = null
      setText('')
      await reload()
    } catch (err) {
      setSendError(errorText(err))
    } finally {
      setSending(false)
    }
  }

  async function queue(messageId: string) {
    setActionError(null)
    try {
      await collab.queueTurn(messageId)
      await reload()
    } catch (err) {
      setActionError(errorText(err))
    }
  }

  return (
    <section className="flex min-h-0 flex-col gap-3" aria-label="Shared Ember chat" data-shared-chat={conversationId}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Shared Ember chat</h2>
        {!inSession && !watching && (
          <span className="flex items-center gap-2">
            {loadError && <span className="text-xs text-red-600">Couldn’t refresh: {loadError}</span>}
            <button type="button" onClick={() => void reload()} className="text-xs text-blue-700 underline">
              Refresh
            </button>
          </span>
        )}
      </div>

      <SummaryPanel chat={chat} onChanged={() => void reload()} />

      <ol className={`flex flex-col gap-3 ${compact ? 'max-h-[55vh] overflow-y-auto pr-1' : ''}`}>
        {chat.messages.length === 0 && (
          <li className="text-sm text-zinc-500">
            {isViewer ? 'Nothing here yet. Comments you post are seen by the pair and other viewers.' : 'No messages yet. Everyone in this conversation sees what you ask Ember and its answers.'}
          </li>
        )}
        {orderForDisplay(chat.messages).map((m) => (
          <ChatItem
            key={m.id}
            message={m}
            prompt={m.promptId ? byId.get(m.promptId) : undefined}
            canAct={canAsk}
            onQueue={queue}
            chat={chat}
            onChanged={() => void reload()}
          />
        ))}
      </ol>
      <div ref={bottom} />
      {actionError && <p className="text-sm text-red-600">{actionError}</p>}

      {(chat.state.answering || chat.state.waiting > 0) && (
        <p className="text-xs text-zinc-500" aria-live="polite">
          {chat.state.answering ? 'Ember is answering…' : ''} {chat.state.waiting > 0 ? `${chat.state.waiting} waiting` : ''}
        </p>
      )}

      {isViewer || canAsk ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            void send()
          }}
        >
          <textarea
            rows={compact ? 2 : 3}
            value={text}
            maxLength={MAX_CHARS}
            onChange={(e) => {
              setText(e.target.value)
              // Different text is a different message.
              pendingRequest.current = null
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send()
              }
            }}
            placeholder={isViewer ? 'Add a comment for the pair (Ember answers only if one of them passes it on)' : 'Ask Ember — everyone in this conversation sees it'}
            className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
            aria-label={isViewer ? 'Comment' : 'Message to Ember'}
          />
          {sendError && <p className="text-sm text-red-600">{sendError}</p>}
          <button disabled={sending || !text.trim()} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {sending ? 'Sending…' : isViewer ? 'Post comment' : 'Ask Ember'}
          </button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">Ember answers in this chat while you’re both in a live session — ask from the session tab.</p>
      )}
    </section>
  )
}

function ChatItem({
  message: m,
  prompt,
  canAct,
  onQueue,
  chat,
  onChanged,
}: {
  message: SharedChatMessage
  prompt: SharedChatMessage | undefined
  canAct: boolean
  onQueue: (messageId: string) => void
  chat: SharedChatData
  onChanged: () => void
}) {
  if (m.kind === 'reply') {
    const passedOn = prompt?.kind === 'comment' && prompt.turn ? ` · answering ${prompt.authorName}’s comment, passed on by ${prompt.turn.requestedByName}` : ''
    return (
      <li className="rounded border border-zinc-200 bg-white p-3" data-chat-kind="reply">
        <p className="text-xs font-medium text-zinc-500">Ember{passedOn}</p>
        {m.hidden ? (
          <p className="mt-1 text-sm italic text-zinc-500">Hidden — this answer drew on sources you can’t open.</p>
        ) : (
          <>
            <div className="mt-1 text-sm">
              <Markdown text={m.content ?? ''} />
            </div>
            {m.evidence && m.evidence.some((e) => e.title) && (
              <p className="mt-2 text-xs text-zinc-500">
                Sources:{' '}
                {m.evidence
                  .filter((e) => e.title)
                  .map((e, i) => (
                    <span key={`${e.type}:${e.id}`}>
                      {i > 0 && ', '}
                      <Link href={evidenceHref(e)} className="underline">
                        {e.title}
                      </Link>
                    </span>
                  ))}
              </p>
            )}
            <Proposals message={m} chat={chat} onChanged={onChanged} />
          </>
        )}
      </li>
    )
  }

  const isComment = m.kind === 'comment'
  const turn = m.turn
  return (
    <li className={`rounded p-3 ${isComment ? 'border border-dashed border-zinc-300 bg-zinc-50' : 'bg-amber-50'}`} data-chat-kind={m.kind}>
      <p className="text-xs font-medium text-zinc-500">{isComment ? `Comment from ${m.authorName ?? 'a viewer'}` : (m.authorName ?? 'Someone')}</p>
      <p className="mt-1 whitespace-pre-wrap text-sm">{m.hidden ? '(hidden)' : m.content}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {turn?.status === 'queued' && <span>Waiting for Ember…</span>}
        {turn?.status === 'running' && <span>Ember is answering…</span>}
        {isComment && turn && turn.status !== 'failed' && turn.status !== 'cancelled' && <span>Passed on to Ember by {turn.requestedByName}</span>}
        {turn?.status === 'failed' && <span className="text-red-700">{turn.error ?? 'Ember couldn’t answer.'}</span>}
        {turn?.status === 'cancelled' && <span>Not answered — {turn.error ? turn.error.replace(/\.$/, '').toLowerCase() : 'the session ended'}.</span>}
        {canAct && isComment && !turn && (
          <button type="button" className="text-blue-700 underline" onClick={() => onQueue(m.id)}>
            Ask Ember to respond
          </button>
        )}
        {canAct && turn && (turn.status === 'failed' || turn.status === 'cancelled') && (
          <button type="button" className="text-blue-700 underline" onClick={() => onQueue(m.id)}>
            Ask again
          </button>
        )}
      </div>
    </li>
  )
}
