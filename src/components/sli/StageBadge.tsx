import { STAGE_LABELS, type TriggerStage } from '@/lib/sli/types'

const STYLES: Partial<Record<TriggerStage, string>> = {
  new: 'bg-sky-50 text-sky-800 ring-sky-200',
  under_review: 'bg-amber-50 text-amber-800 ring-amber-200',
  approved: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  promoted: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  declined: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  rejected: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
  deferred: 'bg-violet-50 text-violet-800 ring-violet-200',
}

export function StageBadge({ stage }: { stage: TriggerStage }) {
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset ${STYLES[stage] ?? 'bg-zinc-50 text-zinc-700 ring-zinc-200'}`}>
      {STAGE_LABELS[stage]}
    </span>
  )
}
