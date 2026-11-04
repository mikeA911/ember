import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSliContext, listTriggers } from '@/lib/sli/api'
import { TriggerCard } from '@/components/sli/TriggerCard'
import type { TriggerSummary } from '@/lib/sli/types'

export const metadata = { title: 'Home' }

// SLI Home: my work. What waits on me in Discovery, what I sponsor, and
// the Triggers I raised.
export default async function SliHomePage() {
  const supabase = await createClient()
  const ctx = await getSliContext(supabase)
  const triggers = await listTriggers(supabase)

  const waiting = ctx?.canSponsor ? triggers.filter((t) => t.stage === 'new') : []
  const sponsoring = triggers.filter((t) => t.sponsoredByMe && !['declined', 'rejected', 'promoted'].includes(t.stage))
  const raised = triggers.filter((t) => t.raisedByMe)

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Home</h1>
          <p className="mt-1 text-sm text-zinc-600">
            {ctx?.organizationName}
            {ctx && ctx.departments.length > 0 ? ` · ${ctx.departments.map((d) => d.name).join(', ')}` : ''}
          </p>
        </div>
        {ctx?.isDepartmentMember && (
          <Link href="/sli/discovery/new" className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
            Raise a Trigger
          </Link>
        )}
      </div>

      {ctx?.isPlatformAdmin && !ctx.isMember && (
        <p className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          You’re viewing {ctx.organizationName} as a platform admin. You aren’t a member, so you can’t raise Triggers. Opening a Trigger is logged.
        </p>
      )}

      {ctx?.canSponsor && <Section title="Waiting for a sponsor" empty="No new Triggers waiting." triggers={waiting} />}
      {ctx?.canSponsor && <Section title="You sponsor" empty="You don’t sponsor any open Triggers." triggers={sponsoring} showStage />}
      {ctx?.isDepartmentMember && (
        <Section title="You raised" empty="You haven’t raised any Triggers yet. Anyone in a department can raise one." triggers={raised} showStage />
      )}
    </div>
  )
}

function Section({ title, empty, triggers, showStage = false }: { title: string; empty: string; triggers: TriggerSummary[]; showStage?: boolean }) {
  return (
    <section>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{title}</h2>
      {triggers.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{empty}</p>
      ) : (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {triggers.map((t) => (
            <TriggerCard key={t.id} trigger={t} showStage={showStage} />
          ))}
        </div>
      )}
    </section>
  )
}
