'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignProjectBuilderAction } from '@/app/actions/agency'

// Admin only, on a project whose client Ember found: pick the builder who
// builds and maintains it. They're paid their share for Ember-found
// clients.
export function AssignProjectBuilderForm({
  projectId,
  builderId,
  builders,
}: {
  projectId: string
  builderId: string | null
  builders: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState(builderId ?? '')
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        await assignProjectBuilderAction(projectId, selected)
        setMessage('Saved')
        router.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to assign builder')
      }
    })
  }

  return (
    <section className="flex flex-col gap-2 rounded border border-amber-200 bg-amber-50 p-4">
      <h2 className="text-sm font-semibold">Builder for this Ember-found client</h2>
      <p className="text-xs text-zinc-600">
        The builder you pick joins as curator, maintains the project, and is paid their share for clients Ember found.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Builder"
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="rounded border border-zinc-300 px-2 py-1 text-sm"
        >
          <option value="">Choose a builder</option>
          {builders.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={isPending || !selected || selected === (builderId ?? '')}
          onClick={save}
          className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-40"
        >
          Assign
        </button>
        {message && <span className="text-xs text-zinc-600">{message}</span>}
      </div>
    </section>
  )
}
