'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setBuilderShareAction } from '@/app/actions/agency'

// Admin only. A builder's own share of maintenance fees, raised as they
// bring more paid projects; blank puts them back on the default. Applies to
// projects promoted from now on -- recorded fees keep their share.
export function BuilderShareForm({ builderId, sharePct, defaultPct }: { builderId: string; sharePct: number | null; defaultPct: number }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const initial = sharePct === null ? '' : String(sharePct)
  const [value, setValue] = useState(initial)
  const [message, setMessage] = useState<string | null>(null)

  function save() {
    setMessage(null)
    startTransition(async () => {
      try {
        const trimmed = value.trim()
        await setBuilderShareAction(builderId, trimmed === '' ? null : Number(trimmed))
        setMessage('Saved')
        router.refresh()
      } catch (err) {
        setMessage(err instanceof Error ? err.message : 'Failed to save')
      }
    })
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600">
      <label className="flex items-center gap-1">
        Builder&apos;s share
        <input
          inputMode="decimal"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={String(defaultPct)}
          className="w-14 rounded border border-zinc-300 px-2 py-0.5 text-right"
        />
        %
      </label>
      <button
        type="button"
        disabled={isPending || value.trim() === initial}
        onClick={save}
        className="rounded bg-zinc-900 px-2 py-0.5 font-medium text-white disabled:opacity-40"
      >
        Save
      </button>
      <span className="text-zinc-400">{sharePct === null ? `Default (${defaultPct}%)` : 'Own share'} · applies to new paid projects</span>
      {message && <span className="text-zinc-500">{message}</span>}
    </div>
  )
}
