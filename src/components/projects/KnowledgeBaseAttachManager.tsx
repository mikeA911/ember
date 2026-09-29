'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachKnowledgeBaseAction, createAndAttachKnowledgeBaseAction, detachKnowledgeBaseAction } from '@/app/actions/projects'

// OR-036: a bare <select> of names couldn't show what each KB is for, so a
// curator had no way to decide whether they actually needed it -- switched
// to a list of cards (name + description) each with its own Attach button, a
// native <option> can't render a description. listAttachableKnowledgeBases
// (src/lib/knowledge-bases.ts) already excludes any project_private/
// selected_projects KB, so everything offered here is safe for any project
// to attach.
export function KnowledgeBaseAttachManager({
  projectId,
  availableKnowledgeBases,
}: {
  projectId: string
  availableKnowledgeBases: { id: string; name: string; description: string | null; status?: string }[]
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')

  function attach(id: string) {
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      try {
        const result = await attachKnowledgeBaseAction(projectId, id)
        if (result.error) setError(result.error)
        else router.refresh()
      } catch {
        setError('Failed to attach knowledge base')
      } finally {
        setPendingId(null)
      }
    })
  }

  function create(e: React.FormEvent) {
    e.preventDefault()
    if (!newName.trim()) return
    setError(null)
    setPendingId(CREATE_PENDING_ID)
    startTransition(async () => {
      try {
        const result = await createAndAttachKnowledgeBaseAction(projectId, { name: newName, description: newDescription })
        if (result.error) {
          setError(result.error)
        } else {
          setNewName('')
          setNewDescription('')
          setShowCreate(false)
          router.refresh()
        }
      } catch {
        setError('Failed to create knowledge base')
      } finally {
        setPendingId(null)
      }
    })
  }

  // Creating one is always available -- including when there's nothing
  // left to attach, the case that used to be a dead end.
  const createForm = showCreate ? (
    <form onSubmit={create} className="flex flex-col gap-1.5 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs">
      <p className="text-zinc-600">
        Creates a new knowledge base and attaches it to this project right away. An admin reviews new knowledge bases, but you can
        add sources to it straight away.
      </p>
      <input
        placeholder="Name"
        value={newName}
        onChange={(e) => setNewName(e.target.value)}
        className="rounded border border-zinc-300 bg-white px-2 py-1"
      />
      <input
        placeholder="What it's for (optional)"
        value={newDescription}
        onChange={(e) => setNewDescription(e.target.value)}
        className="rounded border border-zinc-300 bg-white px-2 py-1"
      />
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={isPending || !newName.trim()}
          className="rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50"
        >
          {isPending && pendingId === CREATE_PENDING_ID ? 'Creating…' : 'Create and attach'}
        </button>
        <button type="button" onClick={() => setShowCreate(false)} className="text-zinc-500 underline hover:text-zinc-700">
          Cancel
        </button>
      </div>
    </form>
  ) : (
    <button type="button" onClick={() => setShowCreate(true)} className="self-start text-xs underline">
      + Create a knowledge base
    </button>
  )

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Attach a knowledge base</h3>
      {availableKnowledgeBases.length === 0 && (
        <p className="text-xs text-zinc-500">Every available knowledge base is already attached -- create a new one below.</p>
      )}
      {availableKnowledgeBases.length > 0 && (
      <ul className="flex flex-col gap-1.5">
        {availableKnowledgeBases.map((kb) => (
          <li key={kb.id} className="flex items-start justify-between gap-3 rounded border border-zinc-200 bg-white p-2 text-xs">
            <div>
              <div className="font-medium">
                {kb.name}
                {kb.status === 'pending' && <PendingReviewBadge />}
              </div>
              {kb.description && <p className="mt-0.5 text-zinc-500">{kb.description}</p>}
            </div>
            <button
              disabled={isPending}
              onClick={() => attach(kb.id)}
              className="shrink-0 rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50"
            >
              {isPending && pendingId === kb.id ? 'Attaching…' : 'Attach'}
            </button>
          </li>
        ))}
      </ul>
      )}
      {createForm}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  )
}

const CREATE_PENDING_ID = '__create__'

// Curator-created knowledge bases start 'pending' until an admin reviews
// them -- usable (attachable, uploadable, searchable) in the meantime.
export function PendingReviewBadge() {
  return (
    <span
      title="An admin hasn't reviewed this knowledge base yet. You can still attach it and add sources."
      className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800"
    >
      Pending admin review
    </span>
  )
}

export function KnowledgeBaseDetachButton({ projectId, knowledgeBaseId }: { projectId: string; knowledgeBaseId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await detachKnowledgeBaseAction(projectId, knowledgeBaseId)
          router.refresh()
        })
      }
      disabled={isPending}
      className="text-xs text-red-600 underline disabled:opacity-50"
    >
      Detach
    </button>
  )
}
