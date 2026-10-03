'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { generatePresentationAction } from '@/app/actions/presentations'
import { BusyOverlay } from '@/components/shared/BusyOverlay'

// Workstream Presentation & Review, Part A. "Generate" always creates a NEW
// version (presentation_versions is insert-only) -- offered again even
// when a presentation already exists, same "regenerate, don't edit"
// convention as Ember's other one-shot suggestions in this codebase.
export function GeneratePresentationButton({
  projectId,
  workstreamId,
  hasExisting,
}: {
  projectId: string
  workstreamId: string
  hasExisting: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleClick() {
    setError(null)
    startTransition(async () => {
      try {
        await generatePresentationAction(projectId, workstreamId)
        router.push(`/projects/${projectId}/workstreams/${workstreamId}/presentation`)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to generate presentation')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Stays up through router.push to the new presentation on success. */}
      <BusyOverlay active={isPending} message="Ember is writing the presentation…" />
      <button
        type="button"
        disabled={isPending}
        onClick={handleClick}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Generating…' : hasExisting ? 'Regenerate Presentation' : 'Generate Presentation'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
