'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { grantBuilderCreditAction, setBuilderAllowanceAction } from '@/app/actions/builder-metering'

// Budget actions for the builder's agency or the platform admin (metering.ts
// requireBudgetManager), on the agency dashboard and the Builder Operations
// tab: top up a builder's credit balance, or adjust their monthly allowance/stop
// threshold. Deliberately no "reduce spend" or "refund" action -- spend is
// an append-only log (ai_operation_logs), never edited.
export function BuilderMeteringActions({
  builderId,
  currentAllowanceUsd,
  currentWarningThresholdPct,
  currentStopAtAllowance,
}: {
  builderId: string
  currentAllowanceUsd: number
  currentWarningThresholdPct: number
  currentStopAtAllowance: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [creditAmount, setCreditAmount] = useState('')
  const [creditReason, setCreditReason] = useState('')
  const [allowanceUsd, setAllowanceUsd] = useState(String(currentAllowanceUsd))
  const [stopAtAllowance, setStopAtAllowance] = useState(currentStopAtAllowance)

  function grantCredit() {
    setError(null)
    const amount = Number(creditAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      setError('Enter a positive credit amount')
      return
    }
    startTransition(async () => {
      try {
        await grantBuilderCreditAction(builderId, amount, creditReason)
        setCreditAmount('')
        setCreditReason('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to grant credit')
      }
    })
  }

  function saveAllowance() {
    setError(null)
    const amount = Number(allowanceUsd)
    if (!Number.isFinite(amount) || amount < 0) {
      setError('Enter a non-negative monthly allowance')
      return
    }
    startTransition(async () => {
      try {
        await setBuilderAllowanceAction(builderId, {
          monthlyAllowanceUsd: amount,
          warningThresholdPct: currentWarningThresholdPct,
          stopAtAllowance,
        })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update allowance')
      }
    })
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 text-xs">
      <input
        value={creditAmount}
        onChange={(e) => setCreditAmount(e.target.value)}
        placeholder="Credit $"
        className="w-20 rounded border border-zinc-300 px-1.5 py-1"
      />
      <input
        value={creditReason}
        onChange={(e) => setCreditReason(e.target.value)}
        placeholder="Reason"
        className="w-32 rounded border border-zinc-300 px-1.5 py-1"
      />
      <button
        type="button"
        disabled={isPending || !creditAmount.trim() || !creditReason.trim()}
        onClick={grantCredit}
        className="rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50"
      >
        Grant credit
      </button>
      <span className="text-zinc-300">|</span>
      <span className="text-zinc-500">Monthly allowance $</span>
      <input
        value={allowanceUsd}
        onChange={(e) => setAllowanceUsd(e.target.value)}
        className="w-16 rounded border border-zinc-300 px-1.5 py-1"
      />
      <label className="flex items-center gap-1 text-zinc-500">
        <input type="checkbox" checked={stopAtAllowance} onChange={(e) => setStopAtAllowance(e.target.checked)} />
        Stop at limit
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={saveAllowance}
        className="rounded border border-zinc-300 px-2 py-1 font-medium text-zinc-700 disabled:opacity-50"
      >
        Save
      </button>
      {error && <p className="w-full text-red-600">{error}</p>}
    </div>
  )
}
