import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listCustomers } from '@/lib/sli/api'
import { CustomerForm } from '@/components/sli/CustomerForm'

export const metadata = { title: 'Add company' }

export default async function NewCustomerPage() {
  const supabase = await createClient()
  const groups = await listCustomers(supabase, { limit: 500 })
  return (
    <div className="space-y-6">
      <div>
        <Link href="/sli/customers" className="text-sm text-zinc-600 underline">Customers</Link>
        <h1 className="mt-2 text-2xl font-semibold">Add company</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">Ember checks for the same company as you type, so the registry has one record per company.</p>
      </div>
      <CustomerForm groups={groups.map((g) => ({ id: g.id, name: g.name }))} />
    </div>
  )
}
