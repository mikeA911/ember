import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getContact } from '@/lib/sli/api'
import { ContactBadges, ContactMethods } from '@/components/sli/CustomerContacts'
import { ContactEditor } from '@/components/sli/ContactEditor'

export default async function ContactPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createClient()
  const contact = await getContact(supabase, id)
  if (!contact) notFound()

  return (
    <div className="space-y-8">
      <div>
        <Link href="/sli/contacts" className="text-sm text-zinc-600 underline">Contacts</Link>
        <h1 className="mt-2 text-2xl font-semibold">{contact.name}</h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <ContactBadges contact={contact} />
        </div>
        <div className="mt-2 text-sm text-zinc-700">
          <ContactMethods contact={contact} />
        </div>
        {contact.marketingConsent !== 'unknown' && (
          <p className="mt-1 text-xs text-zinc-500">
            Consent {contact.marketingConsent}
            {contact.consentSource ? ` (${contact.consentSource})` : ''}
            {contact.consentRecordedAt ? ` · recorded ${new Date(contact.consentRecordedAt).toLocaleDateString('en-PH')}` : ''}
          </p>
        )}
        {contact.notes && <p className="mt-2 whitespace-pre-wrap text-sm">{contact.notes}</p>}
      </div>
      <ContactEditor contact={contact} />
    </div>
  )
}
