'use client'

import { useState } from 'react'
import type { AICostLine, AICostPeriod, AICostReport } from '@/lib/workbench/ai-cost-report'

function usd(n: number) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: n !== 0 && Math.abs(n) < 1 ? 4 : 2 }).format(n)
}

function tokens(n: number) {
  return new Intl.NumberFormat(undefined, { notation: n >= 100_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)
}

function CostTable({ heading, lines, total }: { heading: string; lines: AICostLine[]; total: AICostLine }) {
  return (
    <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
      <table className="w-full min-w-[40rem] text-left text-xs">
        <thead className="bg-zinc-50 text-zinc-500">
          <tr>
            <th className="px-3 py-2 font-medium">{heading}</th>
            <th className="px-3 py-2 text-right font-medium">Calls</th>
            <th className="px-3 py-2 text-right font-medium">Input tokens</th>
            <th className="px-3 py-2 text-right font-medium" title="Share of input served from the provider's prompt cache, where the provider reports it">
              Cached
            </th>
            <th className="px-3 py-2 text-right font-medium">Output tokens</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">
          {lines.map((l) => (
            <tr key={l.key}>
              <td className="px-3 py-1.5 text-zinc-800">
                {l.label}
                {l.unpricedCalls > 0 && (
                  <span className="ml-1 rounded bg-amber-50 px-1 text-amber-800" title="Calls on a model with no price set -- not included in the cost">
                    {l.unpricedCalls} unpriced
                  </span>
                )}
                {l.byoLlmCalls > 0 && (
                  <span className="ml-1 rounded bg-zinc-100 px-1 text-zinc-600" title="Calls through a builder's own LLM -- never charged to the platform">
                    {l.byoLlmCalls} own LLM
                  </span>
                )}
                {l.failedCalls > 0 && <span className="ml-1 text-red-700">{l.failedCalls} failed</span>}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{l.calls.toLocaleString()}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{tokens(l.inputTokens)}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{l.cachedPct === null ? '—' : `${l.cachedPct}%`}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{tokens(l.outputTokens)}</td>
              <td className="px-3 py-1.5 text-right font-medium tabular-nums">{usd(l.costUsd)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t border-zinc-200 font-medium">
          <tr>
            <td className="px-3 py-1.5">Total</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{total.calls.toLocaleString()}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{tokens(total.inputTokens)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{total.cachedPct === null ? '—' : `${total.cachedPct}%`}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{tokens(total.outputTokens)}</td>
            <td className="px-3 py-1.5 text-right tabular-nums">{usd(total.costUsd)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}

function Period({ period }: { period: AICostPeriod }) {
  if (period.total.calls === 0) return <p className="text-sm text-zinc-500">No AI calls in this period.</p>
  return (
    <div className="flex flex-col gap-4">
      {period.total.unpricedCalls > 0 && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          {period.total.unpricedCalls.toLocaleString()} call{period.total.unpricedCalls === 1 ? ' was' : 's were'} on models with no price set, so
          the cost below is incomplete. Set each model&apos;s prices in the AI Config tab: open the provider and use Edit prices.
        </p>
      )}
      <CostTable heading="Task" lines={period.byTask} total={period.total} />
      <CostTable heading="Model" lines={period.byModel} total={period.total} />
    </div>
  )
}

// Admin AI spend by task and by model (src/lib/workbench/ai-cost-report.ts).
// Costs are as logged at call time, from each model's prices then.
export function AICostReportView({ report }: { report: AICostReport }) {
  const [range, setRange] = useState<'thisMonth' | 'last30Days'>('thisMonth')
  const period = report[range]
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600">
          AI spend by task and model, from {period.since} (UTC). Costs use each model&apos;s prices at the time of the call.
        </p>
        <div className="flex rounded border border-zinc-300 text-xs">
          {(['thisMonth', 'last30Days'] as const).map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setRange(r)}
              className={`px-2 py-1 ${range === r ? 'bg-zinc-900 text-white' : 'text-zinc-600'}`}
            >
              {report[r].label}
            </button>
          ))}
        </div>
      </div>
      <Period period={period} />
    </div>
  )
}
