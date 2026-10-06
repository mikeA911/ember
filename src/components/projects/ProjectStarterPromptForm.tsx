'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectStarterPromptAction } from '@/app/actions/projects'
import { SharedTextField, useSharedField } from '@/components/collaboration/SharedTextField'

// A short, clickable prompt Ember offers when opened bound to this project
// (see ChatPanel.tsx's project-bound empty state) -- the Sandz Pilot
// Meeting Brief's onboarding pattern calls for one per Q&A/feedback
// Project, e.g. "Ask anything about the Sandz pilot, suggest an
// improvement, or report a problem." Same edit-in-place shape as
// ProjectGoalForm, but single-line (not Markdown) and curator-inclusive
// (canEdit is owner/curator/admin here, not owner-only).
export function ProjectStarterPromptForm({ projectId, starterPrompt, canEdit }: { projectId: string; starterPrompt: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(starterPrompt ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // In a live session showing this Project, edited together (Phase 2).
  const shared = useSharedField('project_starter_prompt', projectId)
  if (shared) {
    return (
      <SharedTextField
        field="project_starter_prompt"
        targetId={projectId}
        shared={shared}
        label="Starter prompt for Ember"
        placeholder="e.g. Ask anything about this project, suggest an improvement, or report a problem."
        rows={2}
        markdown={false}
        saveLabel="Save starter prompt"
      />
    )
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectStarterPromptAction(projectId, value)
        setEditing(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save starter prompt')
      }
    })
  }

  if (!editing) {
    if (!starterPrompt) {
      return canEdit ? (
        <button onClick={() => setEditing(true)} className="text-sm text-blue-700 underline">
          + Add a starter prompt for Ember
        </button>
      ) : null
    }
    return (
      <div className="flex items-start justify-between gap-3 rounded border border-zinc-200 bg-white p-3">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ember starter prompt</h3>
          <p className="mt-1 text-sm text-zinc-700">&ldquo;{starterPrompt}&rdquo;</p>
        </div>
        {canEdit && (
          <button onClick={() => setEditing(true)} className="shrink-0 text-xs text-blue-700 underline">
            Edit
          </button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Ember starter prompt</h3>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="e.g. Ask anything about the Sandz pilot, suggest an improvement, or report a problem."
        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={isPending} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(starterPrompt ?? '')
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
