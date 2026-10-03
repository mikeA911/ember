'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { PortfolioCategory } from '@/types/database'
import { updateProjectPortfolioCategoryAction } from '@/app/actions/projects'
import { CATEGORY_LABELS } from '@/lib/projects/portfolio-categories'

export { CATEGORY_LABELS }

// Inline editor for the "My Projects" list-grouping tag (2026-09-04) --
// deliberately a plain select-and-save, not ProjectStarterPromptForm's
// edit-in-place shape, since there's no free text to compose, just a fixed
// option list. 'other' is the column default, shown as "Uncategorized" and
// highlighted so owners notice it still needs picking. canEdit is owner/curator/admin, same bar as
// updateProjectPortfolioCategory itself.
export function ProjectCategorySelector({
  projectId,
  category,
  canEdit,
}: {
  projectId: string
  category: PortfolioCategory
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!canEdit) {
    return <span className="text-xs text-zinc-500">Category: {CATEGORY_LABELS[category]}</span>
  }

  function handleChange(value: PortfolioCategory) {
    setError(null)
    startTransition(async () => {
      try {
        await updateProjectPortfolioCategoryAction(projectId, value)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save category')
      }
    })
  }

  return (
    <label className="flex items-center gap-2 text-xs text-zinc-500">
      Category:
      <select
        value={category}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value as PortfolioCategory)}
        className={`rounded border px-2 py-1 text-xs text-zinc-900 disabled:opacity-50 ${
          category === 'other' ? 'border-amber-400 bg-amber-50' : 'border-zinc-300'
        }`}
      >
        {(Object.entries(CATEGORY_LABELS) as [PortfolioCategory, string][]).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      {category === 'other' && !isPending && <span className="text-amber-700">Set one</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </label>
  )
}
