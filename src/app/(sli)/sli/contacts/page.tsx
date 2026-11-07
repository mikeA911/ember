import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listContacts } from '@/lib/sli/api'
import { ContactBadges, ContactMethods } from '@/components/sli/CustomerContacts'

export const metadata = { title: 'Contacts' }

// People at the companies in the registry, searchable by name, email or
// phone. New contacts are added from their company's page.
export default async function ContactsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams
  const supabase = await createClient()
  const contacts = await listContacts(supabase, { search: q })

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Contacts</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          People at the companies in the registry. Add someone from their company’s page. Synthetic data only on this instance.
        </p>
      </div>
      <form className="flex flex-wrap items-center gap-3 text-sm" action="/sli/contacts">
        <input name="q" defaultValue={q ?? ''} placeholder="Name, email or phone" aria-label="Search contacts" className="w-64 max-w-full rounded border border-zinc-300 bg-white px-3 py-1.5" />
        <button type="submit" className="rounded border border-zinc-300 bg-white px-3 py-1.5">Search</button>
        {q && (
          <Link href="/sli/contacts" className="text-zinc-600 underline">Clear</Link>
        )}
      </form>
      {contacts.length === 0 ? (
        <p className="text-sm text-zinc-500">{q ? 'No contacts match.' : 'No contacts yet. Open a company under Customers to add its people.'}</p>
      ) : (
        <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 bg-white text-sm">
          {contacts.map((c) => (
            <li key={c.id} className="space-y-1 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/sli/contacts/${c.id}`} className="font-medium underline">{c.name}</Link>
                <ContactBadges contact={c} />
              </div>
              <p className="text-zinc-600">
                {c.companies.length === 0
                  ? 'No current company'
                  : c.companies.map((k, i) => (
                      <span key={k.id}>
                        {i > 0 && ', '}
                        {k.jobTitle ? `${k.jobTitle}, ` : ''}
                        <Link href={`/sli/customers/${k.id}`} className="underline">{k.name}</Link>
                      </span>
                    ))}
              </p>
              <div className="text-zinc-700">
                <ContactMethods contact={c} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
