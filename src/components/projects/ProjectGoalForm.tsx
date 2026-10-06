'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectGoalAction } from '@/app/actions/projects'
import { Markdown } from '@/components/shared/Markdown'
import { SharedTextField, useSharedField } from '@/components/collaboration/SharedTextField'

// Shared method/approach for every workstream in this project -- workstream
// pages link back here (`#goal`) instead of repeating the text. View mode
// renders as Markdown; owner/admin can toggle into an editable textarea.
export function ProjectGoalForm({ projectId, goal, canEdit }: { projectId: string; goal: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(goal ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()


  // In a live session showing this Project, edited together (Phase 2).
  const shared = useSharedField('project_goal', projectId)
  if (shared) {
    return (
      <SharedTextField
        field="project_goal"
        targetId={projectId}
        shared={shared}
        label="Goal"
        placeholder="The shared method/approach for every workstream in this project. Markdown supported."
        rows={8}
        markdown
        saveLabel="Save goal"
        anchorId="goal"
      />
    )
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectGoalAction(projectId, value)
        setEditing(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save goal')
      }
    })
  }

  if (!editing) {
    if (!goal) {
      return canEdit ? (
        <section id="goal" className="scroll-mt-4">
          <button onClick={() => setEditing(true)} className="text-sm text-blue-700 underline">
            + Add a goal
          </button>
        </section>
      ) : null
    }
    return (
      <section id="goal" className="scroll-mt-4 rounded border border-zinc-200 bg-white p-4">
        <div className="flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Goal</h2>
          {canEdit && (
            <button onClick={() => setEditing(true)} className="shrink-0 text-xs text-blue-700 underline">
              Edit
            </button>
          )}
        </div>
        <div className="mt-2">
          <Markdown text={goal} />
        </div>
      </section>
    )
  }

  return (
    <form onSubmit={handleSave} id="goal" className="scroll-mt-4 flex flex-col gap-2 rounded border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Goal</h2>
      <textarea
        rows={8}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="The shared method/approach for every workstream in this project. Markdown supported."
        className="w-full rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={isPending} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save goal'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(goal ?? '')
            setEditing(false)
            setError(null)
          }}
          className="text-sm text-zinc-500 underline"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
