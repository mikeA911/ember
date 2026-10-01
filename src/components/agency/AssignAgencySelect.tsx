'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignBuilderToAgencyAction } from '@/app/actions/agency'

export function AssignAgencySelect({
  builderId,
  agencyId,
  options,
}: {
  builderId: string
  agencyId: string | null
  options: { id: string; label: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function handleChange(value: string) {
    setError(null)
    startTransition(async () => {
      try {
        await assignBuilderToAgencyAction(builderId, value || null)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to assign agency')
      }
    })
  }

  return (
    <span className="flex items-center gap-1">
      <select
        aria-label="Agency"
        value={agencyId ?? ''}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
        className="rounded border border-zinc-300 px-2 py-0.5 text-xs disabled:opacity-50"
      >
        <option value="">No agency</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </span>
  )
}
