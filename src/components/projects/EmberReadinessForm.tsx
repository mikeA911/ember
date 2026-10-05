'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setProjectReadinessAction } from '@/app/actions/ember-readiness'
import type { EmberReadinessVerdict } from '@/types/database'

const REVIEW_PERIODS = [
  { days: 30, label: '30 days' },
  { days: 60, label: '60 days' },
  { days: 90, label: '90 days' },
  { days: 180, label: '6 months' },
]

// Project owner/curator or platform admin records how confident they are
// that Ember knows enough about this Project. Each save adds a new entry to
// the history; nothing is overwritten.
export function EmberReadinessForm({
  projectId,
  initialConfidence,
  initialVerdict,
}: {
  projectId: string
  initialConfidence: number | null
  initialVerdict: EmberReadinessVerdict | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [confidence, setConfidence] = useState(initialConfidence ?? 50)
  const [verdict, setVerdict] = useState<EmberReadinessVerdict>(initialVerdict ?? 'needs_more_sources')
  const [rationale, setRationale] = useState('')
  const [reviewPeriodDays, setReviewPeriodDays] = useState(90)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await setProjectReadinessAction(projectId, { confidencePercent: confidence, verdict, rationale, reviewPeriodDays })
      if (result.error) {
        setError(result.error)
        return
      }
      setOpen(false)
      setRationale('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        {initialVerdict ? 'Update readiness' : 'Assess readiness'}
      </button>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50 p-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">How confident are you that Ember knows enough about this Project? {confidence}%</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={confidence}
          onChange={(e) => setConfidence(Number(e.target.value))}
          className="w-full"
        />
      </label>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-sm font-medium">Verdict</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="verdict" checked={verdict === 'ready'} onChange={() => setVerdict('ready')} />
          Ready — the team can rely on Ember day to day
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="verdict" checked={verdict === 'needs_more_sources'} onChange={() => setVerdict('needs_more_sources')} />
          Needs more sources — use Ember with care
        </label>
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Why</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="e.g. NENA i3 and K-Suite sources are loaded; Mitel PBX documentation is still missing."
          className="w-full rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <span className="font-medium">Review again in</span>
        <select value={reviewPeriodDays} onChange={(e) => setReviewPeriodDays(Number(e.target.value))} className="rounded border border-zinc-300 px-2 py-1">
          {REVIEW_PERIODS.map((p) => (
            <option key={p.days} value={p.days}>
              {p.label}
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {isPending ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
