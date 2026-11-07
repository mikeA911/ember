'use client'

import { useState, useTransition } from 'react'
import { saveContactAction } from '@/app/actions/sli-customers'
import { BUYING_ROLES, CONTACT_METHOD_KINDS, type BuyingRole, type ContactBrief, type ContactMethodKind, type MarketingConsent } from '@/lib/sli/types'

// Create or edit a person: name, buying role (the Lead Form's "title
// description"), how to reach them, consent and do-not-contact. Opened from
// a company, it also records their job there.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'

type MethodRow = { kind: ContactMethodKind; value: string; isPrimary: boolean; optedOut: boolean }

export function ContactForm({
  contact,
  customerId,
  consentSource,
  notes,
  onSaved,
  onCancel,
}: {
  contact?: ContactBrief
  // Adding someone at this company: also asks for their job there.
  customerId?: string
  consentSource?: string | null
  notes?: string | null
  onSaved: (id: string) => void
  onCancel?: () => void
}) {
  const [firstName, setFirstName] = useState(contact?.firstName ?? '')
  const [lastName, setLastName] = useState(contact?.lastName ?? '')
  const [buyingRole, setBuyingRole] = useState<BuyingRole | ''>(contact?.buyingRole ?? '')
  const [methods, setMethods] = useState<MethodRow[]>(
    contact?.methods.length
      ? contact.methods.map((m) => ({ kind: m.kind, value: m.value, isPrimary: m.isPrimary, optedOut: m.optedOut }))
      : [
          { kind: 'email', value: '', isPrimary: true, optedOut: false },
          { kind: 'mobile', value: '', isPrimary: false, optedOut: false },
        ]
  )
  const [consent, setConsent] = useState<MarketingConsent>(contact?.marketingConsent ?? 'unknown')
  const [source, setSource] = useState(consentSource ?? '')
  const [doNotContact, setDoNotContact] = useState(contact?.doNotContact ?? false)
  const [note, setNote] = useState(notes ?? '')
  const [jobTitle, setJobTitle] = useState('')
  const [department, setDepartment] = useState('')
  const [isPrimary, setIsPrimary] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function setMethod(i: number, change: Partial<MethodRow>) {
    setMethods((rows) => rows.map((r, j) => (j === i ? { ...r, ...change } : change.isPrimary && r.kind === rows[i].kind ? { ...r, isPrimary: false } : r)))
  }

  return (
    <form
      className="space-y-3 rounded border border-zinc-200 bg-white p-4 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const res = await saveContactAction({
            id: contact?.id ?? '',
            firstName,
            lastName,
            buyingRole,
            marketingConsent: consent,
            consentSource: source,
            doNotContact,
            notes: note,
            methods,
            customerId: customerId ?? '',
            jobTitle,
            department,
            isPrimary,
          })
          if (res.ok) onSaved(res.id)
          else setError(res.error)
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-zinc-600">First name</span>
          <input className={field} value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={100} />
        </label>
        <label className="block">
          <span className="text-zinc-600">Last name</span>
          <input className={field} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={100} />
        </label>
      </div>

      {customerId && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="text-zinc-600">Job title</span>
            <input className={field} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} maxLength={200} placeholder="IT Director" />
          </label>
          <label className="block">
            <span className="text-zinc-600">Department</span>
            <input className={field} value={department} onChange={(e) => setDepartment(e.target.value)} maxLength={200} placeholder="IT, Finance" />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input type="checkbox" checked={isPrimary} onChange={(e) => setIsPrimary(e.target.checked)} />
            Main contact at this company
          </label>
        </div>
      )}

      <label className="block">
        <span className="text-zinc-600">Buying role</span>
        <select className={field} value={buyingRole} onChange={(e) => setBuyingRole(e.target.value as BuyingRole | '')}>
          <option value="">Not known</option>
          {Object.entries(BUYING_ROLES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-2">
        <legend className="text-zinc-600">How to reach them</legend>
        {methods.map((m, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select className="rounded border border-zinc-300 bg-white px-2 py-2" value={m.kind} onChange={(e) => setMethod(i, { kind: e.target.value as ContactMethodKind })}>
              {Object.entries(CONTACT_METHOD_KINDS).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <input
              className="min-w-0 flex-1 rounded border border-zinc-300 bg-white px-3 py-2"
              value={m.value}
              onChange={(e) => setMethod(i, { value: e.target.value })}
              type={m.kind === 'email' ? 'email' : 'text'}
              maxLength={300}
              aria-label={CONTACT_METHOD_KINDS[m.kind]}
            />
            <label className="flex items-center gap-1 text-xs text-zinc-600">
              <input type="checkbox" checked={m.isPrimary} onChange={(e) => setMethod(i, { isPrimary: e.target.checked })} /> Main
            </label>
            <label className="flex items-center gap-1 text-xs text-zinc-600" title="They asked not to be contacted this way">
              <input type="checkbox" checked={m.optedOut} onChange={(e) => setMethod(i, { optedOut: e.target.checked })} /> Opted out
            </label>
            <button type="button" className="text-xs text-zinc-500 underline" onClick={() => setMethods((rows) => rows.filter((_, j) => j !== i))}>
              Remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="text-xs text-zinc-600 underline"
          onClick={() => setMethods((rows) => [...rows, { kind: 'email', value: '', isPrimary: false, optedOut: false }])}
        >
          Add another
        </button>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-zinc-600">Marketing consent</span>
          <select className={field} value={consent} onChange={(e) => setConsent(e.target.value as MarketingConsent)}>
            <option value="unknown">Not recorded</option>
            <option value="given">Given</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
        </label>
        <label className="block">
          <span className="text-zinc-600">How consent was given</span>
          <input className={field} value={source} onChange={(e) => setSource(e.target.value)} maxLength={200} placeholder="Webinar sign-up, signed form…" />
        </label>
      </div>
      <label className="flex items-center gap-2">
        <input type="checkbox" checked={doNotContact} onChange={(e) => setDoNotContact(e.target.checked)} />
        Do not contact
      </label>
      <label className="block">
        <span className="text-zinc-600">Notes</span>
        <textarea className={field} rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} />
      </label>

      {error && <p className="text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button disabled={pending} className="rounded bg-zinc-900 px-3 py-2 font-medium text-white disabled:opacity-50">
          {pending ? 'Saving…' : contact ? 'Save' : 'Add contact'}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded border border-zinc-300 px-3 py-2">
            Cancel
          </button>
        )}
      </div>
    </form>
  )
}
