import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCustomer, getSliContext, listCustomers } from '@/lib/sli/api'
import { CustomerForm } from '@/components/sli/CustomerForm'
import { CustomerAssignments, CustomerRankings, CustomerTechnologies } from '@/components/sli/CustomerPanels'
import { CustomerContacts, CustomerProfilePanel } from '@/components/sli/CustomerContacts'
import { CANDIDATE_TIERS, STAGE_LABELS } from '@/lib/sli/types'

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const supabase = await createClient()
  const [customer, ctx] = await Promise.all([getCustomer(supabase, id), getSliContext(supabase)])
  if (!customer) notFound()
  const canEditTech = customer.canEdit || !!ctx?.departments.some((d) => d.code === 'presales')
  const groups = customer.canEdit ? await listCustomers(supabase, { limit: 500 }) : []

  return (
    <div className="space-y-8">
      <div>
        <Link href="/sli/customers" className="text-sm text-zinc-600 underline">Customers</Link>
        <h1 className="mt-2 text-2xl font-semibold">{customer.name}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {[customer.industry, customer.subIndustry, customer.region].filter(Boolean).join(' · ') || 'No industry recorded'}
          {customer.group && (
            <>
              {' '}· part of {customer.parentId ? <Link href={`/sli/customers/${customer.parentId}`} className="underline">{customer.group}</Link> : customer.group}
            </>
          )}
        </p>
        <p className="mt-1 text-sm text-zinc-500">
          {[customer.domain, customer.mainPhone].filter(Boolean).join(' · ')}
        </p>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Company profile</h2>
        <CustomerProfilePanel customer={customer} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">People</h2>
        <CustomerContacts customer={customer} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Who looks after it</h2>
        <CustomerAssignments customer={customer} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What they run</h2>
        <CustomerTechnologies customer={customer} canEdit={canEditTech} />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Rankings</h2>
        <CustomerRankings customer={customer} canRecord={!!ctx && (ctx.isDiscoveryMember || ctx.isPlatformAdmin)} />
      </section>

      {customer.members.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Companies in this group</h2>
          <ul className="flex flex-wrap gap-2 text-sm">
            {customer.members.map((m) => (
              <li key={m.id}>
                <Link href={`/sli/customers/${m.id}`} className="block rounded border border-zinc-200 bg-white px-3 py-1.5 underline">{m.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {customer.triggers.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Candidate for</h2>
          <ul className="space-y-1 text-sm">
            {customer.triggers.map((t) => (
              <li key={t.code}>
                <Link href={`/sli/discovery/${t.code}`} className="underline">{t.code} · {t.title}</Link>
                <span className="text-zinc-500"> · {STAGE_LABELS[t.stage]} · {CANDIDATE_TIERS[t.tier]}{t.status === 'removed' ? ' (trimmed)' : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {customer.canEdit && (
        <section className="space-y-2">
          <details>
            <summary className="cursor-pointer text-sm font-semibold uppercase tracking-wide text-zinc-500">Edit company details</summary>
            <div className="mt-3">
              <CustomerForm customer={customer} groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
            </div>
          </details>
        </section>
      )}
    </div>
  )
}
