'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PortfolioCategory } from '@/types/database'
import { deleteProjectAction, updateProjectPortfolioCategoryAction } from '@/app/actions/projects'

// Archive is just portfolio_category = 'archived' -- My Projects already
// groups that under "Archived" -- so it's reversible and needs the same
// owner/curator/admin bar as ProjectCategorySelector. Restoring puts it back
// in "Others" (uncategorized); the owner can re-pick a category from there.
// Permanent delete is platform-admin only (deleteProject re-checks), with a
// type-the-name confirmation the server also enforces.
export function ProjectArchiveDeleteActions({
  projectId,
  projectName,
  category,
  canArchive,
  canDelete,
}: {
  projectId: string
  projectName: string
  category: PortfolioCategory
  canArchive: boolean
  canDelete: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [typedName, setTypedName] = useState('')

  if (!canArchive && !canDelete) return null
  const archived = category === 'archived'

  function setArchived(next: boolean) {
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectPortfolioCategoryAction(projectId, next ? 'archived' : 'other')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update project')
      }
    })
  }

  function handleDelete(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      try {
        await deleteProjectAction(projectId, typedName)
        router.push('/projects')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete project')
      }
    })
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-red-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-red-700">Archive or delete</h2>
      {canArchive && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            disabled={isPending}
            onClick={() => {
              if (!archived && !confirm(`Archive "${projectName}"? It moves to the Archived section of My Projects and can be restored.`)) return
              setArchived(!archived)
            }}
            className="rounded border border-zinc-300 px-3 py-1.5 text-sm font-medium disabled:opacity-50"
          >
            {archived ? 'Restore from archive' : 'Archive project'}
          </button>
          <span className="text-xs text-zinc-500">
            {archived ? 'This project is archived. Restoring moves it back to Others.' : 'Hides it under Archived in My Projects. Nothing is deleted.'}
          </span>
        </div>
      )}
      {canDelete &&
        (confirmingDelete ? (
          <form onSubmit={handleDelete} className="flex flex-col gap-2">
            <p className="text-sm text-zinc-700">
              This permanently deletes the project with its members, workstreams, notes, assessments and governance records. Ember
              conversations and knowledge bases linked to it are kept but unlinked. This cannot be undone. Type{' '}
              <span className="font-mono font-medium">{projectName}</span> to confirm.
            </p>
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              aria-label="Project name"
              className="w-full max-w-md rounded border border-zinc-300 px-3 py-1.5 text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                disabled={isPending || typedName.trim() !== projectName}
                className="rounded bg-red-700 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
              >
                {isPending ? 'Deleting…' : 'Delete permanently'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirmingDelete(false)
                  setTypedName('')
                  setError(null)
                }}
                className="text-sm text-zinc-500 underline"
              >
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setConfirmingDelete(true)}
              className="rounded border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700"
            >
              Delete permanently…
            </button>
            <span className="text-xs text-zinc-500">Platform admins only.</span>
          </div>
        ))}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </section>
  )
}
