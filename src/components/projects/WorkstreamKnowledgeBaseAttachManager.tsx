'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { attachWorkstreamKnowledgeBaseAction, detachWorkstreamKnowledgeBaseAction } from '@/app/actions/workstream-knowledge-bases'
import { PendingReviewBadge } from './KnowledgeBaseAttachManager'

// Builder Ontology, Part D: same card-list shape as the Project page's own
// KnowledgeBaseAttachManager -- listAttachableKnowledgeBasesForWorkstream
// already excludes any project_private/selected_projects KB, so everything
// offered here is safe to attach.
export function WorkstreamKnowledgeBaseAttachManager({
  projectId,
  workstreamId,
  availableKnowledgeBases,
}: {
  projectId: string
  workstreamId: string
  availableKnowledgeBases: { id: string; name: string; description: string | null; status?: string }[]
}) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function attach(id: string) {
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      try {
        const result = await attachWorkstreamKnowledgeBaseAction(projectId, workstreamId, id)
        if (result.error) setError(result.error)
        else router.refresh()
      } catch {
        setError('Failed to attach knowledge base')
      } finally {
        setPendingId(null)
      }
    })
  }

  if (availableKnowledgeBases.length === 0) {
    return <p className="text-xs text-zinc-500">No unattached knowledge bases available to attach.</p>
  }

  // Collapsed by default -- the list of attachable KBs grows with the
  // platform, and the workstream already starts with its Project's own KBs
  // attached (createWorkstream), so picking more is the less common path.
  return (
    <details>
      <summary className="cursor-pointer select-none text-xs font-semibold uppercase tracking-wide text-zinc-500">
        Attach a knowledge base ({availableKnowledgeBases.length} available)
      </summary>
      <ul className="mt-2 flex flex-col gap-1.5">
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
      {error && <span className="mt-2 block text-xs text-red-600">{error}</span>}
    </details>
  )
}

export function WorkstreamKnowledgeBaseDetachButton({
  projectId,
  workstreamId,
  knowledgeBaseId,
}: {
  projectId: string
  workstreamId: string
  knowledgeBaseId: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await detachWorkstreamKnowledgeBaseAction(projectId, workstreamId, knowledgeBaseId)
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
