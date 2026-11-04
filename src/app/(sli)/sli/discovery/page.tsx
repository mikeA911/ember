import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getSliContext, listTriggers } from '@/lib/sli/api'
import { TriggerCard } from '@/components/sli/TriggerCard'
import { BOARD_STAGES, SHELF_STAGES, STAGE_LABELS } from '@/lib/sli/types'

export const metadata = { title: 'Discovery' }

// The Discovery board: active Triggers by stage, with shelved and closed
// ones below. Archived Triggers appear only when asked for, and search
// still finds them then.
export default async function DiscoveryPage({ searchParams }: { searchParams: Promise<{ q?: string; archived?: string }> }) {
  const { q, archived } = await searchParams
  const includeArchived = archived === '1'
  const supabase = await createClient()
  const [ctx, triggers] = await Promise.all([getSliContext(supabase), listTriggers(supabase, { includeArchived, search: q })])

  const visible = includeArchived ? triggers.filter((t) => t.archived) : triggers
  const shelved = visible.filter((t) => SHELF_STAGES.includes(t.stage))

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Discovery</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-600">
            Triggers are ideas, market events, customer problems and lessons that may justify a new or changed solution. The Discovery team
            researches them and management decides which to pursue.
          </p>
        </div>
        {ctx?.isDepartmentMember && (
          <Link href="/sli/discovery/new" className="rounded bg-zinc-900 px-3 py-2 text-sm font-medium text-white">
            Raise a Trigger
          </Link>
        )}
      </div>

      <form className="flex flex-wrap items-center gap-3 text-sm" action="/sli/discovery">
        <input
          name="q"
          defaultValue={q ?? ''}
          placeholder="Search code or title"
          aria-label="Search Triggers"
          className="w-64 max-w-full rounded border border-zinc-300 bg-white px-3 py-1.5"
        />
        <label className="flex items-center gap-1.5 text-zinc-600">
          <input type="checkbox" name="archived" value="1" defaultChecked={includeArchived} />
          Archived only
        </label>
        <button type="submit" className="rounded border border-zinc-300 bg-white px-3 py-1.5">
          Apply
        </button>
        {(q || includeArchived) && (
          <Link href="/sli/discovery" className="text-zinc-600 underline">
            Clear
          </Link>
        )}
      </form>

      {includeArchived ? (
        <TriggerGrid triggers={visible} empty="No archived Triggers." />
      ) : (
        <>
          <div className="overflow-x-auto pb-2">
            <div className="flex gap-3">
              {BOARD_STAGES.map((stage) => {
                const column = visible.filter((t) => t.stage === stage)
                return (
                  <section key={stage} className="w-56 shrink-0">
                    <h2 className="mb-2 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500">
                      {STAGE_LABELS[stage]}
                      <span className="font-normal">{column.length}</span>
                    </h2>
                    <div className="space-y-2">
                      {column.map((t) => (
                        <TriggerCard key={t.id} trigger={t} />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          </div>
          <section>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Deferred, declined and rejected</h2>
            <TriggerGrid triggers={shelved} empty="None." showStage />
          </section>
        </>
      )}
    </div>
  )
}

function TriggerGrid({ triggers, empty, showStage = true }: { triggers: Parameters<typeof TriggerCard>[0]['trigger'][]; empty: string; showStage?: boolean }) {
  if (triggers.length === 0) return <p className="mt-2 text-sm text-zinc-500">{empty}</p>
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {triggers.map((t) => (
        <TriggerCard key={t.id} trigger={t} showStage={showStage} />
      ))}
    </div>
  )
}
