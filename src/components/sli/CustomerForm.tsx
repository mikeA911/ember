'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { findCustomerDuplicatesAction, saveCustomerAction } from '@/app/actions/sli-customers'
import type { CustomerDetail, DuplicateMatch } from '@/lib/sli/types'

// Create or edit a company, with the registry's duplicate checks shown as
// you type: the same website is blocked, the same main phone needs a
// reason, similar names are shown for a second look.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'

export function CustomerForm({
  customer,
  groups,
  onSaved,
}: {
  customer?: CustomerDetail
  groups: { id: string; name: string }[]
  onSaved?: (id: string) => void
}) {
  const router = useRouter()
  const [name, setName] = useState(customer?.name ?? '')
  const [website, setWebsite] = useState(customer?.website ?? '')
  const [mainPhone, setMainPhone] = useState(customer?.mainPhone ?? '')
  const [industry, setIndustry] = useState(customer?.industry ?? '')
  const [subIndustry, setSubIndustry] = useState(customer?.subIndustry ?? '')
  const [region, setRegion] = useState(customer?.region ?? '')
  const [parentId, setParentId] = useState(customer?.parentId ?? '')
  const [priority, setPriority] = useState(customer?.priority ?? '')
  const [overrideReason, setOverrideReason] = useState('')
  const [matches, setMatches] = useState<DuplicateMatch[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (name.trim().length < 2) return
    let cancelled = false
    const timer = setTimeout(() => {
      findCustomerDuplicatesAction({ name, website, mainPhone, excludeId: customer?.id }).then((m) => {
        if (!cancelled) setMatches(m)
      })
    }, 400)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [name, website, mainPhone, customer?.id])

  const shownMatches = name.trim().length < 2 ? [] : matches
  const blocking = shownMatches.find((m) => m.strength === 'blocking')
  const warning = shownMatches.find((m) => m.strength === 'warning')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await saveCustomerAction({
            id: customer?.id ?? '',
            name,
            website,
            mainPhone,
            industry,
            subIndustry,
            region,
            parentId,
            priority: priority as '' | 'low' | 'medium' | 'high',
            overrideReason,
          })
          if (!result.ok) return setError(result.error)
          if (onSaved) onSaved(result.id)
          else router.push(`/sli/customers/${result.id}`)
          router.refresh()
        })
      }}
      className="max-w-2xl space-y-4"
    >
      <div>
        <label htmlFor="c-name" className="mb-1 block text-sm font-medium">Company name</label>
        <input id="c-name" required minLength={2} maxLength={200} value={name} onChange={(e) => setName(e.target.value)} className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="c-website" className="mb-1 block text-sm font-medium">Website</label>
          <input id="c-website" maxLength={300} value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="example.com.ph" className={field} />
        </div>
        <div>
          <label htmlFor="c-phone" className="mb-1 block text-sm font-medium">Main phone (trunk line)</label>
          <input id="c-phone" maxLength={40} value={mainPhone} onChange={(e) => setMainPhone(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="c-industry" className="mb-1 block text-sm font-medium">Industry</label>
          <input id="c-industry" maxLength={100} value={industry} onChange={(e) => setIndustry(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="c-sub" className="mb-1 block text-sm font-medium">Sub-industry</label>
          <input id="c-sub" maxLength={100} value={subIndustry} onChange={(e) => setSubIndustry(e.target.value)} className={field} />
        </div>
        <div>
          <label htmlFor="c-region" className="mb-1 block text-sm font-medium">Region</label>
          <input id="c-region" maxLength={100} value={region} onChange={(e) => setRegion(e.target.value)} placeholder="NCR, Region VII…" className={field} />
        </div>
        <div>
          <label htmlFor="c-priority" className="mb-1 block text-sm font-medium">Priority</label>
          <select id="c-priority" value={priority} onChange={(e) => setPriority(e.target.value as typeof priority)} className={field}>
            <option value="">Not set</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="c-group" className="mb-1 block text-sm font-medium">Group (conglomerate)</label>
        <select id="c-group" value={parentId} onChange={(e) => setParentId(e.target.value)} className={field}>
          <option value="">Not part of a group</option>
          {groups
            .filter((g) => g.id !== customer?.id)
            .map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
        </select>
      </div>
      {shownMatches.length > 0 && (
        <div className={`rounded border p-3 text-sm ${blocking ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          <p className="font-medium">{blocking ? 'This company is already in the registry' : 'Check these first'}</p>
          <ul className="mt-1 space-y-0.5">
            {shownMatches.map((m) => (
              <li key={m.id}>
                <Link href={`/sli/customers/${m.id}`} className="underline">{m.name}</Link>
                <span className="text-zinc-600"> · {m.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warning && !blocking && (
        <div>
          <label htmlFor="c-override" className="mb-1 block text-sm font-medium">Why save it anyway?</label>
          <input id="c-override" maxLength={1000} value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} className={field} placeholder="For example: shared switchboard with a sister company" />
        </div>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending || !!blocking} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Saving…' : customer ? 'Save changes' : 'Add company'}
      </button>
    </form>
  )
}
