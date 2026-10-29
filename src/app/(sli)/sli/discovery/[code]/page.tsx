import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getTrigger } from '@/lib/sli/api'
import { StageBadge } from '@/components/sli/StageBadge'
import { TriggerActions } from '@/components/sli/TriggerActions'
import { STAGE_LABELS, type TriggerHistoryEntry } from '@/lib/sli/types'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: code.toUpperCase() }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })

function describe(h: TriggerHistoryEntry): string {
  switch (h.event) {
    case 'raised':
      return 'Raised'
    case 'archived':
      return 'Archived'
    case 'unarchived':
      return 'Unarchived'
    default:
      return `${h.fromStage ? STAGE_LABELS[h.fromStage] : ''} → ${STAGE_LABELS[h.toStage]}`
  }
}

export default async function TriggerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()
  const trigger = await getTrigger(supabase, code)
  if (!trigger) notFound()

  const limited = trigger.access === 'summary'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/sli/discovery" className="text-sm text-zinc-600 underline">Discovery</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span className="font-mono">{trigger.code}</span>
          <StageBadge stage={trigger.stage} />
          {trigger.archived && <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700">Archived</span>}
          <span>{trigger.triggerTypeLabel ?? trigger.triggerType}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{trigger.title}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Raised by {trigger.raisedByMe ? 'you' : trigger.raisedByName}
          {trigger.sourceDepartment ? ` (${trigger.sourceDepartment})` : ''} on {when(trigger.createdAt)}
          {trigger.sponsorName ? ` · Sponsor: ${trigger.sponsoredByMe ? 'you' : trigger.sponsorName}` : ' · No sponsor yet'}
        </p>
      </div>

      <TriggerActions triggerId={trigger.id} actions={trigger.allowedActions} />

      {limited ? (
        <p className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          The Discovery team is handling this Trigger. Its details and research are visible to the Discovery team only.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <section className="space-y-4 md:col-span-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800">{trigger.summary || 'No summary given.'}</p>
            </div>
            {trigger.strategicObjective && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Objective it could serve</h2>
                <p className="mt-2 text-sm text-zinc-800">{trigger.strategicObjective}</p>
              </div>
            )}
            {trigger.archived && trigger.archiveReason && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Why it was archived</h2>
                <p className="mt-2 text-sm text-zinc-800">{trigger.archiveReason}</p>
              </div>
            )}
            <div className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
              Research, concept and feasibility work will appear here (the next part of this stage).
            </div>
          </section>
          <aside className="space-y-3 text-sm">
            {trigger.eventDate && (
              <p>
                <span className="text-zinc-500">Event date:</span> {trigger.eventDate}
              </p>
            )}
            {trigger.eventReference && (
              <p className="break-words">
                <span className="text-zinc-500">Source:</span>{' '}
                {/^https?:\/\//.test(trigger.eventReference) ? (
                  <a href={trigger.eventReference} target="_blank" rel="noopener noreferrer" className="underline">
                    {trigger.eventReference}
                  </a>
                ) : (
                  trigger.eventReference
                )}
              </p>
            )}
            <p>
              <span className="text-zinc-500">Sensitivity:</span> {trigger.informationSensitivity}
            </p>
          </aside>
        </div>
      )}

      {trigger.history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">History</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {trigger.history.map((h, i) => (
              <li key={i} className="rounded border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{describe(h)}</span>
                  <span className="text-xs text-zinc-500">
                    {h.changedByName} · {when(h.changedAt)}
                  </span>
                </div>
                {h.reason && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{h.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
