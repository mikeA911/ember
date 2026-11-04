import Link from 'next/link'
import type { TriggerSummary } from '@/lib/sli/types'
import { StageBadge } from './StageBadge'

export function TriggerCard({ trigger, showStage = false }: { trigger: TriggerSummary; showStage?: boolean }) {
  return (
    <Link
      href={`/sli/discovery/${trigger.code}`}
      className="block rounded-md border border-zinc-200 bg-white p-3 text-sm shadow-sm hover:border-zinc-400"
    >
      <div className="flex items-center justify-between gap-2 text-xs text-zinc-500">
        <span className="font-mono">{trigger.code}</span>
        {showStage ? <StageBadge stage={trigger.stage} /> : trigger.archived && <span>Archived</span>}
      </div>
      <p className="mt-1 font-medium text-zinc-900">{trigger.title}</p>
      <p className="mt-1 text-xs text-zinc-500">
        {trigger.triggerTypeLabel ?? trigger.triggerType}
        {trigger.sponsorName ? ` · Sponsor: ${trigger.sponsorName}` : ''}
        {trigger.raisedByMe ? ' · Raised by you' : ''}
      </p>
    </Link>
  )
}
