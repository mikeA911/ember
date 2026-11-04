import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getDecisionSettings, getHandoffInbox, getSliContext, listTriggers } from '@/lib/sli/api'
import { DecisionPanel } from '@/components/sli/DecisionPanel'
import { TriggerCard } from '@/components/sli/TriggerCard'
import type { TriggerStage, TriggerSummary } from '@/lib/sli/types'

export const metadata = { title: 'My work' }

const IN_PROGRESS: TriggerStage[] = ['researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting']

// My work (the classic Home; the calm Home is /sli): what waits on me in Discovery, what I sponsor, the
// Discovery team's other work in progress, and the Triggers I raised.
export default async function SliMyWorkPage() {
  const supabase = await createClient()
  const ctx = await getSliContext(supabase)
  const [triggers, decisionSettings, inbox] = await Promise.all([listTriggers(supabase), getDecisionSettings(supabase), getHandoffInbox(supabase)])

  const waiting = ctx?.canSponsor ? triggers.filter((t) => t.stage === 'new') : []
  const sponsoring = triggers.filter((t) => t.sponsoredByMe && !['declined', 'rejected', 'promoted'].includes(t.stage))
  const raised = triggers.filter((t) => t.raisedByMe)
  // The Discovery team's work in progress that isn't already listed above.
  const listed = new Set([...waiting, ...sponsoring].map((t) => t.id))
  const inProgress = ctx?.isDiscoveryMember
    ? triggers.filter((t) => IN_PROGRESS.includes(t.stage) && !listed.has(t.id))
    : []

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">My work</h1>
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

      {inbox && inbox.toAnswer.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Handoffs waiting for your answer</h2>
          <ul className="mt-2 flex flex-wrap gap-2 text-sm">
            {inbox.toAnswer.map((h) => (
              <li key={h.code + h.kind}>
                <Link href={`/sli/discovery/${h.code}`} className="block rounded border border-amber-200 bg-amber-50 px-3 py-1.5 hover:border-amber-400">
                  <span className="font-mono text-xs">{h.code}</span> {h.title}
                  <span className="text-xs text-zinc-500"> · {h.kind === 'promote' ? `handoff to ${h.department}` : `sent back by ${h.department}`}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {inbox && inbox.received.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Received from Discovery</h2>
          <ul className="mt-2 space-y-1 text-sm">
            {inbox.received.map((r) => (
              <li key={r.code}>
                <Link href={`/sli/discovery/${r.code}`} className="underline">
                  {r.code} · {r.title}
                </Link>
                <span className="text-xs text-zinc-500"> · {r.department}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {decisionSettings && <DecisionPanel settings={decisionSettings} />}
      {ctx?.canSponsor && <Section title="Waiting for a sponsor" empty="No new Triggers waiting." triggers={waiting} />}
      {ctx?.canSponsor && <Section title="You sponsor" empty="You don’t sponsor any open Triggers." triggers={sponsoring} showStage />}
      {ctx?.isDiscoveryMember && (
        <Section title="In progress with the Discovery team" empty="No other Triggers are in research or review." triggers={inProgress} showStage />
      )}
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
