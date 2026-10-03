'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateProjectObjectiveAction } from '@/app/actions/projects'

// The short description under the project title (`objective`). Plain text,
// not Markdown -- it's also fed verbatim into prompts (presentations,
// project context) and the project directory listing. Owner/curator/admin
// can toggle into an inline textarea.
export function ProjectObjectiveForm({ projectId, objective, canEdit }: { projectId: string; objective: string | null; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState(objective ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectObjectiveAction(projectId, value)
        setEditing(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save description')
      }
    })
  }

  if (!editing) {
    if (!objective) {
      return canEdit ? (
        <button onClick={() => setEditing(true)} className="mt-2 text-sm text-blue-700 underline">
          + Add a description
        </button>
      ) : null
    }
    return (
      <p className="mt-2 text-sm text-zinc-600">
        {objective}
        {canEdit && (
          <button onClick={() => setEditing(true)} className="ml-2 text-xs text-blue-700 underline">
            Edit
          </button>
        )}
      </p>
    )
  }

  return (
    <form onSubmit={handleSave} className="mt-2 flex flex-col gap-2">
      <textarea
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="What is this project trying to achieve?"
        className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex items-center gap-2">
        <button disabled={isPending} className="self-start rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save description'}
        </button>
        <button
          type="button"
          onClick={() => {
            setValue(objective ?? '')
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
