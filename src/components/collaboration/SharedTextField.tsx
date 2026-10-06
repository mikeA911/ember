'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Markdown } from '@/components/shared/Markdown'
import { CollaborationError } from '@/lib/collaboration/errors'
import type { SharedDraft, SharedFieldState, SharedTextFieldName } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// Shared workspace sessions, Phase 2: a Project or Workstream text field
// edited together. While a live session shows this field's page, the
// person in control edits a shared draft (sent as they type, after a short
// pause) and everyone else in the session sees it live, read-only. Save is
// explicit; Cancel drops the draft. A change made to the field outside the
// session shows as a conflict to resolve, never a silent overwrite.
//
// Outside a session (or on a page the session isn't showing) the field's
// ordinary form is used instead -- see useSharedField.

const SEND_AFTER_MS = 400

export interface SharedFieldInfo {
  role: 'controller' | 'observer' | 'watcher'
  canEdit: boolean
  saved: string | null
  draft: SharedDraft | null
  controllerName: string
}

// The shared state of one field, or null when the field isn't being shared
// in this tab (no live session here, or the session shows another page).
export function useSharedField(field: SharedTextFieldName, targetId: string): SharedFieldInfo | null {
  const collab = useCollaboration()
  if (!collab) return null
  const { session, watch, userId } = collab
  let source: { fields: SharedFieldState[]; role: SharedFieldInfo['role']; controllerName: string } | null = null
  if (session?.status === 'active' && session.thisTabJoined) {
    const controller = session.controllerId === session.host.id ? session.host : session.guest
    source = { fields: session.fields, role: session.controllerId === userId ? 'controller' : 'observer', controllerName: controller.name }
  } else if (watch) {
    const controller = watch.controllerId === watch.host.id ? watch.host : watch.guest
    source = { fields: watch.fields, role: 'watcher', controllerName: controller.name }
  }
  if (!source) return null
  const state = source.fields.find((f) => f.field === field && f.targetId.toLowerCase() === targetId.toLowerCase())
  if (!state || state.field === 'workstream_deliverables') return null
  return { role: source.role, canEdit: source.role === 'controller' && state.canEdit, saved: state.saved, draft: state.draft, controllerName: source.controllerName }
}

// A workstream's deliverables checklist in a live session on its page:
// the live list, and whether this person (in control, with the right) may
// tick items. Null when not shared here.
export function useSharedDeliverables(workstreamId: string): { deliverables: { label: string; completed: boolean }[]; canEdit: boolean } | null {
  const collab = useCollaboration()
  if (!collab) return null
  const { session, watch, userId } = collab
  const fields = session?.status === 'active' && session.thisTabJoined ? session.fields : watch?.fields
  if (!fields) return null
  const state = fields.find((f) => f.field === 'workstream_deliverables' && f.targetId.toLowerCase() === workstreamId.toLowerCase())
  if (!state || state.field !== 'workstream_deliverables') return null
  const inControl = !!session?.thisTabJoined && session.controllerId === userId
  return { deliverables: state.deliverables, canEdit: inControl && state.canEdit }
}

export function SharedTextField({
  field,
  targetId,
  shared,
  label,
  placeholder,
  rows,
  markdown,
  saveLabel,
  anchorId,
}: {
  field: SharedTextFieldName
  targetId: string
  shared: SharedFieldInfo
  label: string
  placeholder: string
  rows: number
  markdown: boolean
  saveLabel: string
  anchorId?: string
}) {
  const collab = useCollaboration()!
  const router = useRouter()
  const { canEdit, draft, saved } = shared
  const editing = canEdit && !!draft
  // What this person has typed, ahead of the last snapshot, tagged with the
  // control generation it was typed under: after any handover it no longer
  // applies and the shared draft shows instead. Only the person in control
  // types; everyone else always sees the shared draft.
  const generation = collab.session?.controlGeneration ?? -1
  const [typed, setTyped] = useState<{ generation: number; value: string } | null>(null)
  const local = editing && typed?.generation === generation ? typed.value : null
  const setLocal = (value: string | null) => setTyped(value === null ? null : { generation, value })
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const chain = useRef<Promise<void>>(Promise.resolve())

  // A save (by anyone) changes the saved text: refresh the rest of the
  // page, which was rendered with the old value.
  const lastSaved = useRef(saved)
  useEffect(() => {
    if (lastSaved.current !== saved) router.refresh()
    lastSaved.current = saved
  }, [saved, router])

  const send = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    const value = pending.current
    if (value === null) return chain.current
    pending.current = null
    chain.current = chain.current
      .then(() => collab.setDraft(field, targetId, value))
      .catch((err) => setError(err instanceof CollaborationError ? err.message : 'Your latest typing wasn’t shared. Try again.'))
    return chain.current
  }, [collab, field, targetId])

  // Typing not yet sent goes out before a handover or leaving.
  useEffect(() => {
    if (!editing) return
    return collab.registerPendingDraft(`${field}:${targetId}`, send)
  }, [editing, collab, field, targetId, send])

  function type(value: string) {
    setLocal(value)
    setError(null)
    pending.current = value
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void send(), SEND_AFTER_MS)
  }

  async function attempt(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      if (err instanceof CollaborationError && err.kind === 'conflict') setConflict(true)
      else setError(err instanceof CollaborationError ? err.message : 'That didn’t work. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const startEditing = () =>
    attempt(async () => {
      await collab.setDraft(field, targetId, saved ?? '')
      setLocal(saved ?? '')
    })
  const save = () =>
    attempt(async () => {
      await send()
      await collab.saveField(field, targetId)
      setLocal(null)
      setConflict(false)
    })
  const cancel = () =>
    attempt(async () => {
      pending.current = null
      if (timer.current) clearTimeout(timer.current)
      await chain.current
      await collab.discardDraft(field, targetId)
      setLocal(null)
      setConflict(false)
    })
  const keepMine = () =>
    attempt(async () => {
      await send()
      await collab.setDraft(field, targetId, local ?? draft?.value ?? '', true)
      setConflict(false)
    })

  const heading = <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{label}</h2>
  const sharedNote = (text: string) => <p className="text-xs font-medium text-amber-800">{text}</p>

  if (editing) {
    const changedOutside = conflict || draft!.baseChanged
    return (
      <form
        id={anchorId}
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
        className="scroll-mt-4 flex flex-col gap-2 rounded border border-amber-300 bg-white p-4"
        data-shared-field={field}
      >
        {heading}
        {sharedNote('Shared draft — the others in the session see what you type. Not saved until you save it.')}
        <textarea
          rows={rows}
          value={local ?? draft!.value}
          onChange={(e) => type(e.target.value)}
          placeholder={placeholder}
          className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
        {changedOutside && (
          <div className="flex flex-col gap-2 rounded border border-red-200 bg-red-50 p-2 text-sm" role="alert">
            <p className="font-medium text-red-800">This was changed outside the session since editing began. The saved text is now:</p>
            <p className="whitespace-pre-wrap rounded bg-white p-2 text-zinc-700">{saved || '(empty)'}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void keepMine()} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs">
                Keep my text (I’ll save over it)
              </button>
              <button type="button" disabled={busy} onClick={() => void cancel()} className="rounded border border-zinc-300 bg-white px-2 py-1 text-xs">
                Discard my changes
              </button>
            </div>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex items-center gap-2">
          <button disabled={busy || changedOutside} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            {busy ? 'Saving…' : saveLabel}
          </button>
          <button type="button" disabled={busy} onClick={() => void cancel()} className="text-sm text-zinc-500 underline">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  // Someone is drafting, and it isn't this person typing.
  if (draft) {
    return (
      <section id={anchorId} className="scroll-mt-4 flex flex-col gap-2 rounded border border-amber-300 bg-amber-50/40 p-4" data-shared-field={field}>
        {heading}
        {sharedNote(
          shared.role === 'controller'
            ? `${draft.editorName ?? 'Someone'}’s unsaved draft — your account can’t edit this field, so it can’t be saved from here.`
            : `✎ ${draft.editorName ?? shared.controllerName} is editing — not saved yet`
        )}
        <p className="whitespace-pre-wrap rounded border border-zinc-200 bg-white p-2 font-mono text-sm text-zinc-700">{draft.value || ' '}</p>
      </section>
    )
  }

  if (!saved) {
    return canEdit ? (
      <section id={anchorId} className="scroll-mt-4" data-shared-field={field}>
        <button type="button" disabled={busy} onClick={() => void startEditing()} className="text-sm text-blue-700 underline">
          + Add {label.toLowerCase()}
        </button>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </section>
    ) : null
  }

  return (
    <section id={anchorId} className="scroll-mt-4 rounded border border-zinc-200 bg-white p-4" data-shared-field={field}>
      <div className="flex items-start justify-between gap-3">
        {heading}
        {canEdit && (
          <button type="button" disabled={busy} onClick={() => void startEditing()} className="shrink-0 text-xs text-blue-700 underline">
            Edit
          </button>
        )}
      </div>
      <div className="mt-2">{markdown ? <Markdown text={saved} /> : <p className="text-sm text-zinc-600">{saved}</p>}</div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
