'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { saveCustomerProfileAction, updateContactLinkAction } from '@/app/actions/sli-customers'
import { BUYING_ROLES, CONTACT_METHOD_KINDS, PROCUREMENT_TYPES, type ContactBrief, type ProcurementType, type CustomerContact, type CustomerDetail } from '@/lib/sli/types'
import { ContactForm } from './ContactForm'

// A company's people (current, then past) and its Lead Form profile.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'

export function ContactBadges({ contact }: { contact: ContactBrief }) {
  return (
    <>
      {contact.buyingRole && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-700">{BUYING_ROLES[contact.buyingRole]}</span>}
      {contact.doNotContact && <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-800">Do not contact</span>}
      {contact.marketingConsent === 'given' && <span className="rounded bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-800">Consent given</span>}
      {contact.marketingConsent === 'withdrawn' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-900">Consent withdrawn</span>}
    </>
  )
}

export function ContactMethods({ contact }: { contact: ContactBrief }) {
  if (contact.methods.length === 0) return <span className="text-zinc-500">No contact details</span>
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5">
      {contact.methods.map((m) => (
        <span key={m.id} className={m.optedOut ? 'text-zinc-400 line-through' : ''} title={m.optedOut ? 'Opted out' : CONTACT_METHOD_KINDS[m.kind]}>
          {m.kind === 'email' && !m.optedOut ? <a href={`mailto:${m.value}`} className="underline">{m.value}</a> : m.value}
          {m.kind !== 'email' && <span className="text-zinc-400"> ({CONTACT_METHOD_KINDS[m.kind].toLowerCase()})</span>}
        </span>
      ))}
    </span>
  )
}

function ContactRow({ c, canEdit }: { c: CustomerContact; canEdit: boolean }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function leave() {
    if (!window.confirm(`Record that ${c.name} has left? They stay in the history.`)) return
    startTransition(async () => {
      const res = await updateContactLinkAction({
        linkId: c.linkId,
        jobTitle: c.jobTitle ?? '',
        department: c.department ?? '',
        isPrimary: false,
        endedOn: new Date().toISOString().slice(0, 10),
      })
      if (res.ok) router.refresh()
      else setError(res.error)
    })
  }

  return (
    <li className="rounded border border-zinc-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/sli/contacts/${c.id}`} className="font-medium underline">
          {c.name}
        </Link>
        {c.isPrimary && <span className="rounded bg-orange-50 px-1.5 py-0.5 text-xs text-orange-800">Main contact</span>}
        <ContactBadges contact={c} />
      </div>
      <p className="text-zinc-600">{[c.jobTitle, c.department].filter(Boolean).join(' · ') || 'No title recorded'}</p>
      <div className="mt-1 text-zinc-700">
        <ContactMethods contact={c} />
      </div>
      {canEdit && !c.endedOn && (
        <button type="button" disabled={pending} onClick={leave} className="mt-1 text-xs text-zinc-500 underline disabled:opacity-50">
          Has left the company
        </button>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </li>
  )
}

export function CustomerContacts({ customer }: { customer: CustomerDetail }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const current = customer.contacts.filter((c) => !c.endedOn)
  const past = customer.contacts.filter((c) => c.endedOn)

  return (
    <div className="space-y-3">
      {current.length === 0 ? (
        <p className="text-sm text-zinc-500">No contacts yet.</p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {current.map((c) => (
            <ContactRow key={c.linkId} c={c} canEdit={customer.canEdit} />
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600">Past contacts ({past.length})</summary>
          <ul className="mt-2 space-y-1">
            {past.map((c) => (
              <li key={c.linkId}>
                <Link href={`/sli/contacts/${c.id}`} className="underline">{c.name}</Link>
                <span className="text-zinc-500"> · {c.jobTitle ?? 'no title'} · left {c.endedOn}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
      {customer.canEdit &&
        (adding ? (
          <ContactForm
            customerId={customer.id}
            onSaved={() => {
              setAdding(false)
              router.refresh()
            }}
            onCancel={() => setAdding(false)}
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm">
            Add a contact
          </button>
        ))}
    </div>
  )
}

export function CustomerProfilePanel({ customer }: { customer: CustomerDetail }) {
  const router = useRouter()
  const p = customer.profile
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    overview: p.overview ?? '',
    productsServices: p.productsServices ?? '',
    notableCustomers: p.notableCustomers ?? '',
    address: p.address ?? '',
    employeeCount: p.employeeCount ?? '',
    procurementType: (p.procurementType ?? '') as ProcurementType | '',
  })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  const rows: [string, string | null][] = [
    ['Overview', p.overview],
    ['Products and services', p.productsServices],
    ['Their customers', p.notableCustomers],
    ['Address', p.address],
    ['Employees', p.employeeCount],
    ['Procurement', p.procurementType ? PROCUREMENT_TYPES[p.procurementType] : null],
  ]
  const filled = rows.filter((r): r is [string, string] => !!r[1])

  if (editing) {
    const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))
    return (
      <form
        className="space-y-3 rounded border border-zinc-200 bg-white p-4 text-sm"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          startTransition(async () => {
            const res = await saveCustomerProfileAction({ customerId: customer.id, ...form })
            if (res.ok) {
              setEditing(false)
              router.refresh()
            } else setError(res.error)
          })
        }}
      >
        <label className="block">
          <span className="text-zinc-600">Overview</span>
          <textarea className={field} rows={3} value={form.overview} onChange={set('overview')} maxLength={4000} />
        </label>
        <label className="block">
          <span className="text-zinc-600">Products and services</span>
          <textarea className={field} rows={2} value={form.productsServices} onChange={set('productsServices')} maxLength={4000} />
        </label>
        <label className="block">
          <span className="text-zinc-600">Their customers</span>
          <input className={field} value={form.notableCustomers} onChange={set('notableCustomers')} maxLength={2000} />
        </label>
        <label className="block">
          <span className="text-zinc-600">Address (building, number, street)</span>
          <input className={field} value={form.address} onChange={set('address')} maxLength={500} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-zinc-600">Employees</span>
            <input className={field} value={form.employeeCount} onChange={set('employeeCount')} maxLength={50} placeholder="500-1000" />
          </label>
          <label className="block">
            <span className="text-zinc-600">Procurement</span>
            <select className={field} value={form.procurementType} onChange={set('procurementType')}>
              <option value="">Not known</option>
              {Object.entries(PROCUREMENT_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        {error && <p className="text-red-700">{error}</p>}
        <div className="flex gap-2">
          <button disabled={pending} className="rounded bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-50">
            {pending ? 'Saving…' : 'Save'}
          </button>
          <button type="button" onClick={() => setEditing(false)} className="rounded border border-zinc-300 px-3 py-2">
            Cancel
          </button>
        </div>
      </form>
    )
  }

  return (
    <div className="space-y-2 text-sm">
      {filled.length === 0 ? (
        <p className="text-zinc-500">No profile yet.</p>
      ) : (
        <dl className="grid gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          {filled.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {customer.canEdit && (
        <button type="button" onClick={() => setEditing(true)} className="text-xs text-zinc-600 underline">
          {filled.length === 0 ? 'Add the company profile' : 'Edit the profile'}
        </button>
      )}
    </div>
  )
}
