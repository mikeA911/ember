import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getSliContext, listTriggerTypes } from '@/lib/sli/api'
import { RaiseTriggerForm } from '@/components/sli/RaiseTriggerForm'

export const metadata = { title: 'Raise a Trigger' }

export default async function RaiseTriggerPage() {
  const supabase = await createClient()
  const ctx = await getSliContext(supabase)
  if (!ctx?.isDepartmentMember) redirect('/sli/discovery')
  const types = await listTriggerTypes(supabase)

  return (
    <div className="space-y-6">
      <div>
        <Link href="/sli/discovery" className="text-sm text-zinc-600 underline">Discovery</Link>
        <h1 className="mt-2 text-2xl font-semibold">Raise a Trigger</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          Anything that might justify a new or changed solution: a market event, a customer problem, a partner offering, an idea. The Discovery
          team will accept it into research or explain why not.
        </p>
      </div>
      <RaiseTriggerForm types={types} departments={ctx.departments} />
    </div>
  )
}
