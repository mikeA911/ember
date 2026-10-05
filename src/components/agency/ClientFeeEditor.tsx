'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setClientProjectFeeAction } from '@/app/actions/agency'
import type { AgencyClientFee } from '@/lib/workbench/agency-dashboard'
import { formatMoney } from './money'

// Shows a client Project's maintenance fee, the platform's share and the
// builder's share (an employee's bonus), with an inline editor for the
// agency/admin (the only viewers of /agency). The platform rate is fixed
// when the fee is recorded; the builder's share is negotiated per Project.
export function ClientFeeEditor({ projectId, fee }: { projectId: string; fee: AgencyClientFee | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [amount, setAmount] = useState(fee ? String(fee.amount) : '')
  const [currency, setCurrency] = useState<'PHP' | 'USD'>(fee?.currency ?? 'PHP')
  const [period, setPeriod] = useState<'monthly' | 'annual'>(fee?.period ?? 'monthly')
  // Blank on a new fee: the deployment default applies.
  const [builderShare, setBuilderShare] = useState(fee ? String(fee.builderSharePct) : '')

  function save() {
    setError(null)
    const value = Number(amount.replace(/,/g, '').trim())
    if (!amount.trim() || !Number.isFinite(value)) {
      setError('Enter an amount')
      return
    }
    const share = builderShare.trim() ? Number(builderShare.trim()) : undefined
    if (share !== undefined && !Number.isFinite(share)) {
      setError("Enter the builder's share as a percentage")
      return
    }
    startTransition(async () => {
      try {
        await setClientProjectFeeAction(projectId, { amount: value, currency, period, builderSharePct: share })
        setEditing(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save fee')
      }
    })
  }

  if (!editing) {
    return (
      <div className="flex flex-col gap-0.5 text-xs">
        {fee ? (
          <>
            <span className="font-medium text-zinc-700">
              {formatMoney(fee.amount, fee.currency)} / {fee.period === 'annual' ? 'year' : 'month'}
            </span>
            <span className="text-zinc-500">
              Platform share {formatMoney(fee.platformMonthly, fee.currency)}/mo ({fee.platformRatePct}%)
            </span>
            <span className="text-zinc-500">
              Builder share {formatMoney(fee.builderMonthly, fee.currency)}/mo ({fee.builderSharePct}%)
            </span>
          </>
        ) : (
          <span className="text-zinc-400">No fee recorded</span>
        )}
        <button type="button" onClick={() => setEditing(true)} className="w-fit text-zinc-500 underline">
          {fee ? 'Edit fee' : 'Add fee'}
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1 text-xs">
      <div className="flex flex-wrap items-center gap-1">
        <select aria-label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value as 'PHP' | 'USD')} className="rounded border border-zinc-300 px-1 py-0.5">
          <option value="PHP">PHP</option>
          <option value="USD">USD</option>
        </select>
        <input
          aria-label="Fee amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          className="w-24 rounded border border-zinc-300 px-1.5 py-0.5"
        />
        <select aria-label="Billing period" value={period} onChange={(e) => setPeriod(e.target.value as 'monthly' | 'annual')} className="rounded border border-zinc-300 px-1 py-0.5">
          <option value="monthly">/ month</option>
          <option value="annual">/ year</option>
        </select>
      </div>
      <label className="flex items-center gap-1 text-zinc-600">
        Builder share
        <input
          aria-label="Builder share percentage"
          inputMode="decimal"
          value={builderShare}
          placeholder="default"
          onChange={(e) => setBuilderShare(e.target.value)}
          className="w-14 rounded border border-zinc-300 px-1.5 py-0.5 text-right"
        />
        %
      </label>
      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={save} className="rounded bg-zinc-900 px-2 py-0.5 font-medium text-white disabled:opacity-50">
          Save
        </button>
        <button type="button" disabled={isPending} onClick={() => setEditing(false)} className="underline">
          Cancel
        </button>
      </div>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  )
}
