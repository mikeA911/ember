'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { assignCustomerAction, recordRankingAction, saveTechnologyAction } from '@/app/actions/sli-customers'
import { TECHNOLOGY_CATEGORIES, type CustomerDetail, type TechnologyCategory } from '@/lib/sli/types'

// The editable parts of a company page: who looks after it, Discovery's
// rankings and its technology profile. The database decides who may
// change each.

const input = 'rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm'
const ROLE_LABEL = { account_rep: 'Account rep (Sales)', isr_owner: 'ISR owner (Marketing)', account_owner: 'Account owner' } as const
const RANKING_LABEL = { top1000: 'Top 1000', bsp: 'BSP' } as const
const STATUS_LABEL = { in_use: 'In use', evaluating: 'Evaluating', replacing: 'Replacing', retired: 'Retired' } as const
const dateText = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })

function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function run(fn: () => Promise<{ ok: boolean; error?: string }>, after?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await fn()
      if (!result.ok) return setError(result.error ?? 'Something went wrong.')
      after?.()
      router.refresh()
    })
  }
  return { error, pending, run }
}

export function CustomerAssignments({ customer }: { customer: CustomerDetail }) {
  const { error, pending, run } = useAction()
  return (
    <div className="space-y-2">
      {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((role) => {
        const current = customer.assignments.find((a) => a.role === role && a.to === null)
        const choices = customer.salesMembers.filter((m) =>
          role === 'account_rep' ? m.department === 'sales' : role === 'isr_owner' ? m.department === 'marketing' : true
        )
        const unique = choices.filter((m, i) => choices.findIndex((x) => x.userId === m.userId) === i)
        return (
          <div key={role} className="flex flex-wrap items-center gap-2 text-sm">
            <span className="w-44 text-zinc-500">{ROLE_LABEL[role]}</span>
            {customer.canAssign[role] ? (
              <select
                aria-label={ROLE_LABEL[role]}
                value={current?.userId ?? ''}
                disabled={pending}
                onChange={(e) => run(() => assignCustomerAction({ customerId: customer.id, role, userId: e.target.value }))}
                className={input}
              >
                <option value="">Nobody</option>
                {unique.map((m) => (
                  <option key={m.userId} value={m.userId}>{m.name}</option>
                ))}
              </select>
            ) : (
              <span>{current?.name ?? '—'}</span>
            )}
          </div>
        )
      })}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

export function CustomerRankings({ customer, canRecord }: { customer: CustomerDetail; canRecord: boolean }) {
  const { error, pending, run } = useAction()
  const [type, setType] = useState<'top1000' | 'bsp'>('top1000')
  const [rank, setRank] = useState('')
  const [asOf, setAsOf] = useState('')
  const [source, setSource] = useState('')
  return (
    <div className="space-y-2 text-sm">
      {customer.rankings.length === 0 ? (
        <p className="text-zinc-500">No rankings yet.</p>
      ) : (
        <ul className="space-y-1">
          {customer.rankings.map((r, i) => (
            <li key={i}>
              {RANKING_LABEL[r.type]} <span className="font-medium tabular-nums">#{r.rank}</span>
              <span className="text-zinc-500">
                {r.asOf ? ` · as of ${r.asOf}` : ''}
                {r.source ? ` · ${r.source}` : ''} · {r.recordedBy}, {dateText(r.recordedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {canRecord && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() => recordRankingAction({ customerId: customer.id, type, rank, asOf, source }), () => setRank(''))
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <select aria-label="Ranking" value={type} onChange={(e) => setType(e.target.value as 'top1000' | 'bsp')} className={input}>
            <option value="top1000">Top 1000</option>
            <option value="bsp">BSP</option>
          </select>
          <input aria-label="Rank" type="number" min={1} required value={rank} onChange={(e) => setRank(e.target.value)} placeholder="Rank" className={`${input} w-24`} />
          <input aria-label="As of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={input} />
          <input aria-label="Source" maxLength={200} value={source} onChange={(e) => setSource(e.target.value)} placeholder="Source" className={input} />
          <button type="submit" disabled={pending} className="rounded border border-zinc-300 bg-white px-3 py-1.5 disabled:opacity-50">
            Record
          </button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}

export function CustomerTechnologies({ customer, canEdit }: { customer: CustomerDetail; canEdit: boolean }) {
  const { error, pending, run } = useAction()
  const [category, setCategory] = useState<TechnologyCategory>('virtualisation')
  const [vendor, setVendor] = useState('')
  const [product, setProduct] = useState('')
  const [scale, setScale] = useState('')
  const [renewalDate, setRenewalDate] = useState('')
  const [suppliedBySandz, setSuppliedBySandz] = useState(false)
  return (
    <div className="space-y-2 text-sm">
      {customer.technologies.length === 0 ? (
        <p className="text-zinc-500">Nothing recorded yet. What the company runs helps Discovery find the customers a solution fits.</p>
      ) : (
        <ul className="space-y-1">
          {customer.technologies.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-zinc-200 bg-white px-3 py-1.5">
              <span>
                <span className="text-zinc-500">{TECHNOLOGY_CATEGORIES[t.category]}:</span> <span className="font-medium">{t.vendor}</span>
                {t.product ? ` ${t.product}` : ''}
                <span className="text-zinc-500">
                  {' '}· {STATUS_LABEL[t.status]}
                  {t.scale ? ` · ${t.scale}` : ''}
                  {t.renewalDate ? ` · renews ${t.renewalDate}` : ''}
                  {t.suppliedBySandz ? ' · supplied by Sandz' : ''}
                </span>
              </span>
              {canEdit && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    run(() =>
                      saveTechnologyAction({ customerId: customer.id, id: t.id, category: t.category, vendor: t.vendor, remove: true })
                    )
                  }
                  className="text-xs text-zinc-600 underline disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(
              () => saveTechnologyAction({ customerId: customer.id, category, vendor, product, scale, renewalDate, suppliedBySandz }),
              () => {
                setVendor('')
                setProduct('')
                setScale('')
                setRenewalDate('')
                setSuppliedBySandz(false)
              }
            )
          }}
          className="flex flex-wrap items-end gap-2"
        >
          <select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value as TechnologyCategory)} className={input}>
            {(Object.keys(TECHNOLOGY_CATEGORIES) as TechnologyCategory[]).map((c) => (
              <option key={c} value={c}>{TECHNOLOGY_CATEGORIES[c]}</option>
            ))}
          </select>
          <input aria-label="Vendor" required maxLength={100} value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Vendor (e.g. VMware)" className={input} />
          <input aria-label="Product" maxLength={100} value={product} onChange={(e) => setProduct(e.target.value)} placeholder="Product" className={input} />
          <input aria-label="Scale" maxLength={200} value={scale} onChange={(e) => setScale(e.target.value)} placeholder="Scale (e.g. 60 VMs)" className={input} />
          <input aria-label="Renewal date" type="date" value={renewalDate} onChange={(e) => setRenewalDate(e.target.value)} className={input} />
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={suppliedBySandz} onChange={(e) => setSuppliedBySandz(e.target.checked)} /> Supplied by Sandz
          </label>
          <button type="submit" disabled={pending || !vendor.trim()} className="rounded border border-zinc-300 bg-white px-3 py-1.5 disabled:opacity-50">
            Add
          </button>
        </form>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
