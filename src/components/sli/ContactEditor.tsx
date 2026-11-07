'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition } from 'react'
import { archiveContactAction, saveContactAction, searchCustomersAction, updateContactLinkAction } from '@/app/actions/sli-customers'
import type { ContactDetail, CustomerListItem } from '@/lib/sli/types'
import { ContactForm } from './ContactForm'

// A contact's companies over time (with "has left" and moves), and editing.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'
type Link_ = ContactDetail['links'][number]

function LinkRow({ link, canEdit }: { link: Link_; canEdit: boolean }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [jobTitle, setJobTitle] = useState(link.jobTitle ?? '')
  const [department, setDepartment] = useState(link.department ?? '')
  const [isPrimary, setIsPrimary] = useState(link.isPrimary)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function save(endedOn: string | null) {
    setError(null)
    startTransition(async () => {
      const res = await updateContactLinkAction({ linkId: link.linkId, jobTitle, department, isPrimary, endedOn: endedOn ?? '' })
      if (res.ok) {
        setEditing(false)
        router.refresh()
      } else setError(res.error)
    })
  }

  return (
    <li className="rounded border border-zinc-200 bg-white p-3 text-sm">
      <p>
        <Link href={`/sli/customers/${link.customerId}`} className="font-medium underline">{link.customerName}</Link>
        <span className="text-zinc-600">
          {' '}
          · {[link.jobTitle, link.department].filter(Boolean).join(', ') || 'no title'}
          {link.isPrimary ? ' · main contact' : ''}
        </span>
      </p>
      <p className="text-xs text-zinc-500">
        {link.startedOn ? `Since ${link.startedOn}` : 'Start not recorded'}
        {link.endedOn ? `, left ${link.endedOn}` : ''}
      </p>
      {canEdit && !link.endedOn && !editing && (
        <div className="mt-1 flex gap-3 text-xs text-zinc-600">
          <button type="button" className="underline" onClick={() => setEditing(true)}>Change title</button>
          <button
            type="button"
            className="underline"
            disabled={pending}
            onClick={() => window.confirm(`Record that they left ${link.customerName}?`) && save(new Date().toISOString().slice(0, 10))}
          >
            Has left
          </button>
        </div>
      )}
      {editing && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <input className={field} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title" aria-label="Job title" />
          <input className={field} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" aria-label="Department" />
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} /> Main contact
          </label>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save(null)} className="rounded bg-zinc-900 px-3 py-1.5 text-xs text-white">Save</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded border border-zinc-300 px-3 py-1.5 text-xs">Cancel</button>
          </div>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </li>
  )
}

function AddToCompany({ contact, onDone }: { contact: ContactDetail; onDone: () => void }) {
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<CustomerListItem[]>([])
  const [company, setCompany] = useState<CustomerListItem | null>(null)
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (search.trim().length < 2) return
    let cancelled = false
    const t = setTimeout(() => {
      void searchCustomersAction({ search }).then((r) => {
        if (!cancelled) setResults(r)
      })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [search])

  return (
    <div className="space-y-2 rounded border border-zinc-200 bg-white p-3 text-sm">
      {company ? (
        <p>
          At <span className="font-medium">{company.name}</span>{' '}
          <button type="button" className="text-xs underline" onClick={() => setCompany(null)}>change</button>
        </p>
      ) : (
        <>
          <input className={field} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find the company" aria-label="Find the company" />
          {search.trim().length >= 2 && (
            <ul className="max-h-48 overflow-y-auto">
              {results.map((r) => (
                <li key={r.id}>
                  <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-zinc-100" onClick={() => setCompany(r)}>
                    {r.name} <span className="text-zinc-500">{r.domain}</span>
                  </button>
                </li>
              ))}
              {results.length === 0 && <li className="px-2 text-zinc-500">No match. Add the company under Customers first.</li>}
            </ul>
          )}
        </>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <input className={field} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="Job title there" aria-label="Job title" />
        <input className={field} value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="Department" aria-label="Department" />
      </div>
      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={!company || pending}
          className="rounded bg-zinc-900 px-3 py-1.5 text-white disabled:opacity-50"
          onClick={() =>
            startTransition(async () => {
              const res = await saveContactAction({
                id: contact.id,
                firstName: contact.firstName,
                lastName: contact.lastName ?? '',
                buyingRole: contact.buyingRole ?? '',
                marketingConsent: contact.marketingConsent,
                consentSource: contact.consentSource ?? '',
                doNotContact: contact.doNotContact,
                notes: contact.notes ?? '',
                methods: contact.methods.map((m) => ({ kind: m.kind, value: m.value, isPrimary: m.isPrimary, optedOut: m.optedOut })),
                customerId: company?.id ?? '',
                jobTitle,
                department,
                isPrimary: false,
              })
              if (res.ok) onDone()
              else setError(res.error)
            })
          }
        >
          Add
        </button>
        <button type="button" onClick={onDone} className="rounded border border-zinc-300 px-3 py-1.5">Cancel</button>
      </div>
    </div>
  )
}

export function ContactEditor({ contact }: { contact: ContactDetail }) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit' | 'add'>('view')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function remove() {
    const reason = window.prompt('Why remove this contact? (for example: duplicate, asked to be forgotten)')
    if (!reason) return
    startTransition(async () => {
      const res = await archiveContactAction({ contactId: contact.id, reason })
      if (res.ok) router.push('/sli/contacts')
      else setError(res.error)
    })
  }

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Companies</h2>
        {contact.links.length === 0 ? (
          <p className="text-sm text-zinc-500">Not linked to a company.</p>
        ) : (
          <ul className="space-y-2">
            {contact.links.map((l) => (
              <LinkRow key={l.linkId} link={l} canEdit={contact.canEdit} />
            ))}
          </ul>
        )}
        {contact.canEdit &&
          (mode === 'add' ? (
            <AddToCompany
              contact={contact}
              onDone={() => {
                setMode('view')
                router.refresh()
              }}
            />
          ) : (
            <button type="button" onClick={() => setMode('add')} className="text-sm text-zinc-600 underline">
              Add to a company (for example, after a move)
            </button>
          ))}
      </section>

      {contact.canEdit && (
        <section className="space-y-2">
          {mode === 'edit' ? (
            <ContactForm
              contact={contact}
              consentSource={contact.consentSource}
              notes={contact.notes}
              onSaved={() => {
                setMode('view')
                router.refresh()
              }}
              onCancel={() => setMode('view')}
            />
          ) : (
            <div className="flex gap-4 text-sm">
              <button type="button" onClick={() => setMode('edit')} className="rounded border border-zinc-300 bg-white px-3 py-1.5">
                Edit contact
              </button>
              <button type="button" disabled={pending} onClick={remove} className="text-zinc-500 underline disabled:opacity-50">
                Remove contact
              </button>
            </div>
          )}
          {error && <p className="text-sm text-red-700">{error}</p>}
        </section>
      )}
      <p className="text-xs text-zinc-500">
        Added by {contact.createdBy ?? 'someone'} · {contact.source === 'zoho_import' ? 'imported from Zoho' : 'entered in Ember'}
      </p>
    </div>
  )
}
