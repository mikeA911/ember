'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setBuilderRatesAction } from '@/app/actions/agency'
import type { BuilderRates } from '@/lib/workbench/client-billing'

// Admin only. A builder's own starting figures, adjusted as they succeed:
// Ember's cut when they found the client, and their share when Ember found
// the client. Blank uses the default. Applies to projects promoted from
// now on; each project's fee can still be adjusted on its own.
export function BuilderRatesForm({ builderId, rates, defaults }: { builderId: string; rates: BuilderRates; defaults: { platformRatePct: number; builderSharePct: number } }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initialCut = rates.platformRatePct === null ? '' : String(rates.platformRatePct)
  const initialShare = rates.builderSharePct === null ? '' : String(rates.builderSharePct)
  const [cut, setCut] = useState(initialCut)
  const [share, setShare] = useState(initialShare)
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        await setBuilderRatesAction(builderId, {
          platformRatePct: cut.trim() === '' ? null : Number(cut.trim()),
          builderSharePct: share.trim() === '' ? null : Number(share.trim()),
        })
        setMessage('Saved')
        router.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600">
      <label className="flex items-center gap-1">
        Ember&apos;s cut, client found by builder
        <input
          inputMode="decimal"
          value={cut}
          onChange={(e) => setCut(e.target.value)}
          placeholder={String(defaults.platformRatePct)}
          className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-right"
        />
        %
      </label>
      <label className="flex items-center gap-1">
        Builder&apos;s share, client found by Ember
        <input
          inputMode="decimal"
          value={share}
          onChange={(e) => setShare(e.target.value)}
          placeholder={String(defaults.builderSharePct)}
          className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-right"
        />
        %
      </label>
      <button
        type="button"
        disabled={isPending || (cut.trim() === initialCut && share.trim() === initialShare)}
        onClick={save}
        className="rounded bg-zinc-900 px-2 py-0.5 font-medium text-white disabled:opacity-40"
      >
        Save
      </button>
      <span className="text-zinc-400">Blank uses the default · applies to new paid projects</span>
      {message && <span className="text-zinc-500">{message}</span>}
    </div>
  )
}
