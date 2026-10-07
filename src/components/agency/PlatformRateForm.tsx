'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setBillingRatesAction } from '@/app/actions/agency'

// Admin only. The deployment defaults: Ember's cut when a builder found the
// client, and the builder's share when Ember found the client. Both apply
// to fees recorded from now on; recorded fees keep their split, and each
// builder or project can be adjusted on its own.
export function PlatformRateForm({ current, currentBuilderShare }: { current: number; currentBuilderShare: number }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(String(current))
  const [builderShare, setBuilderShare] = useState(String(currentBuilderShare))
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        await setBillingRatesAction({ platformRatePct: Number(value), builderSharePct: Number(builderShare) })
        setMessage('Saved')
        router.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-zinc-600">
      <label className="flex items-center gap-2">
        Ember&apos;s cut when the builder found the client
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="w-16 rounded border border-zinc-300 px-2 py-0.5 text-right"
        />
        %
      </label>
      <label className="flex items-center gap-2">
        Builder&apos;s share when Ember found the client
        <input
          inputMode="decimal"
          value={builderShare}
          onChange={(e) => setBuilderShare(e.target.value)}
          className="w-16 rounded border border-zinc-300 px-2 py-0.5 text-right"
        />
        %
      </label>
      <button
        type="button"
        disabled={isPending || (value === String(current) && builderShare === String(currentBuilderShare))}
        onClick={save}
        className="rounded bg-zinc-900 px-2 py-0.5 text-xs font-medium text-white disabled:opacity-40"
      >
        Save
      </button>
      <span className="text-xs text-zinc-400">Applies to new fees; recorded fees keep their rates.</span>
      {message && <span className="text-xs text-zinc-500">{message}</span>}
    </div>
  )
}
