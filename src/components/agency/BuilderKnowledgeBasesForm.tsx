'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setBuilderKnowledgeBasesAction } from '@/app/actions/agency'
import type { AssignableKnowledgeBase } from '@/lib/workbench/agency-dashboard'

const SCOPE_LABELS: Record<string, string> = {
  project_private: 'project only',
  selected_projects: 'selected projects',
  organization: 'organization',
  platform: 'platform',
  public: 'public',
}

// Admin only. The knowledge bases this builder can see: each one ticked is
// attached to their workspace, so they and Ember can use it there.
export function BuilderKnowledgeBasesForm({
  builderId,
  assignedIds,
  options,
}: {
  builderId: string
  assignedIds: string[]
  options: AssignableKnowledgeBase[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<Set<string>>(new Set(assignedIds))
  const [message, setMessage] = useState<string | null>(null)
  const changed = selected.size !== assignedIds.length || assignedIds.some((id) => !selected.has(id))

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        await setBuilderKnowledgeBasesAction(builderId, [...selected])
        setMessage('Saved')
        router.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  if (options.length === 0) return null

  return (
    <details className="mt-2 rounded border border-zinc-200 p-2 text-xs">
      <summary className="cursor-pointer text-zinc-600">
        Knowledge bases this builder can see <span className="text-zinc-400">({assignedIds.length} assigned)</span>
      </summary>
      <div className="mt-2 flex flex-col gap-1">
        {options.map((kb) => (
          <label key={kb.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.has(kb.id)} disabled={isPending} onChange={() => toggle(kb.id)} />
            <span>{kb.name}</span>
            <span className="text-zinc-400">{SCOPE_LABELS[kb.visibilityScope] ?? kb.visibilityScope}</span>
          </label>
        ))}
        <div className="mt-1 flex items-center gap-2">
          <button
            type="button"
            disabled={isPending || !changed}
            onClick={save}
            className="rounded bg-zinc-900 px-2 py-0.5 font-medium text-white disabled:opacity-40"
          >
            Save
          </button>
          <span className="text-zinc-400">Added to the builder&apos;s workspace; they can&apos;t remove them.</span>
          {message && <span className="text-zinc-500">{message}</span>}
        </div>
      </div>
    </details>
  )
}
