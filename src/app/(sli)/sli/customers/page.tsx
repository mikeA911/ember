import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSliContext, listCustomers } from '@/lib/sli/api'

export const metadata = { title: 'Customers' }

// The customer registry's core: companies, their group, account rep and
// rankings, searchable by name, domain or phone, and by what they run.
export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string; tech?: string }> }) {
  const { q, tech } = await searchParams
  const supabase = await createClient()
  const [ctx, customers] = await Promise.all([getSliContext(supabase), listCustomers(supabase, { search: q, technology: tech })])
  const canAdd =
    !!ctx && (ctx.isPlatformAdmin || ctx.isDiscoveryMember || ctx.departments.some((d) => d.code === 'marketing' || d.code === 'sales'))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Customers</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">Companies Sandz works with or may approach. Synthetic data only on this instance.</p>
        </div>
        {canAdd && (
          <Link href="/sli/customers/new" className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
            Add company
          </Link>
        )}
      </div>
      <form className="flex flex-wrap items-center gap-3 text-sm" action="/sli/customers">
        <input name="q" defaultValue={q ?? ''} placeholder="Name, website or phone" aria-label="Search companies" className="w-64 max-w-full rounded border border-zinc-300 bg-white px-3 py-1.5" />
        <input name="tech" defaultValue={tech ?? ''} placeholder="Runs… (e.g. VMware)" aria-label="Filter by technology" className="w-48 max-w-full rounded border border-zinc-300 bg-white px-3 py-1.5" />
        <button type="submit" className="rounded border border-zinc-300 bg-white px-3 py-1.5">Search</button>
        {(q || tech) && (
          <Link href="/sli/customers" className="text-zinc-600 underline">Clear</Link>
        )}
      </form>
      {customers.length === 0 ? (
        <p className="text-sm text-zinc-500">{q || tech ? 'No companies match.' : 'No companies yet.'}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="py-2 pr-4 font-medium">Company</th>
                <th className="py-2 pr-4 font-medium">Industry</th>
                <th className="py-2 pr-4 font-medium">Group</th>
                <th className="py-2 pr-4 font-medium">Account rep</th>
                <th className="py-2 pr-4 font-medium">Top 1000</th>
                <th className="py-2 font-medium">Runs</th>
              </tr>
            </thead>
            <tbody>
              {customers.map((c) => (
                <tr key={c.id} className="border-t border-zinc-200">
                  <td className="py-2 pr-4">
                    <Link href={`/sli/customers/${c.id}`} className="font-medium underline">{c.name}</Link>
                    {c.domain && <span className="block text-xs text-zinc-500">{c.domain}</span>}
                  </td>
                  <td className="py-2 pr-4">{c.industry ?? '—'}</td>
                  <td className="py-2 pr-4">{c.group ?? '—'}</td>
                  <td className="py-2 pr-4">{c.accountRep ?? '—'}</td>
                  <td className="py-2 pr-4 tabular-nums">{c.top1000 ?? '—'}</td>
                  <td className="py-2 text-xs text-zinc-600">{c.technologies.join(', ') || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
