'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordDecisionAction, recordRecommendationAction } from '@/app/actions/sli'
import { OUTCOME_LABELS, STAGE_LABELS, type DecisionOutcome, type TriggerDecisionInfo, type TriggerStage } from '@/lib/sli/types'

// Management review on a Trigger (Discovery design §6): the Discovery
// team's recommendations, the recorded decisions (a new one supersedes the
// last; both stay), and the forms the caller may use. The database decides
// who may recommend or decide; this only shows what it allows.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'
const OUTCOMES: DecisionOutcome[] = ['approve', 'revise', 'defer', 'reject']
const REVISE_STAGES: TriggerStage[] = ['researching', 'concept', 'feasibility']
const AS_LABEL = { authority: 'decision authority', delegate: 'delegate', platform_admin: 'platform admin' } as const

const when = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })

function outcomeText(outcome: DecisionOutcome, destination: string | null, returnTo: TriggerStage | null) {
  if (outcome === 'approve') return `Approve${destination ? `, to ${destination}` : ''}`
  if (outcome === 'revise') return `Revise${returnTo ? ` in ${STAGE_LABELS[returnTo]}` : ''}`
  return OUTCOME_LABELS[outcome]
}

export function TriggerDecision({
  triggerId,
  info,
  evidenceOptions,
  candidateCount = 0,
}: {
  triggerId: string
  info: TriggerDecisionInfo
  evidenceOptions: { id: string; title: string; stage: string }[]
  candidateCount?: number
}) {
  const decisions = [...(info.decisions ?? [])].reverse()
  const current = (info.recommendations ?? []).filter((r) => r.current)
  const earlier = (info.recommendations ?? []).filter((r) => !r.current)

  return (
    <div className="space-y-5">
      {decisions.length > 0 && (
        <ul className="space-y-2">
          {decisions.map((d) => (
            <li key={d.id} className={`rounded border p-3 text-sm ${d.superseded ? 'border-zinc-200 bg-zinc-50 text-zinc-500' : 'border-zinc-300 bg-white'}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="font-medium">
                  {outcomeText(d.outcome, d.destination, d.returnToStage)}
                  {d.superseded && <span className="ml-2 text-xs font-normal">(superseded)</span>}
                </span>
                <span className="text-xs text-zinc-500">
                  {d.decidedBy ? `${d.decidedBy}${d.decidedAs ? ` as ${AS_LABEL[d.decidedAs]}` : ''} · ` : ''}
                  {when(d.decidedAt)}
                </span>
              </div>
              {d.rationale && <p className="mt-1 whitespace-pre-wrap">{d.rationale}</p>}
              {d.conditions && (
                <p className="mt-1">
                  <span className="text-zinc-500">Conditions:</span> {d.conditions}
                </p>
              )}
              {d.evidence && d.evidence.length > 0 && (
                <p className="mt-1 text-xs text-zinc-500">Evidence: {d.evidence.map((e) => e.title).join(', ')}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {info.recommendations !== undefined && (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">Recommendations</h3>
          {current.length === 0 ? (
            <p className="text-sm text-zinc-500">No recommendations yet.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {current.map((r) => (
                <li key={r.by + r.recordedAt} className="rounded border border-zinc-200 bg-white px-3 py-2">
                  <span className="font-medium">{r.byMe ? 'You' : r.by}:</span> {outcomeText(r.recommendation, r.destination, null)}
                  {r.comments && <span className="text-zinc-600"> — {r.comments}</span>}
                  <span className="ml-2 text-xs text-zinc-400">{when(r.recordedAt)}</span>
                </li>
              ))}
            </ul>
          )}
          {earlier.length > 0 && (
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer">Earlier recommendations ({earlier.length})</summary>
              <ul className="mt-1 space-y-1">
                {earlier.map((r) => (
                  <li key={r.by + r.recordedAt}>
                    {r.by}: {outcomeText(r.recommendation, r.destination, null)} {r.comments ? `— ${r.comments}` : ''} ({when(r.recordedAt)})
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {info.canRecommend && <RecommendForm triggerId={triggerId} destinations={info.destinations ?? []} />}
      {info.canDecide && (
        <DecideForm
          triggerId={triggerId}
          destinations={info.destinations ?? []}
          evidenceOptions={evidenceOptions}
          decideAs={info.decideAs ?? null}
          candidateCount={candidateCount}
        />
      )}
      {!info.canDecide && info.decisionBlockedReason && info.recommendations !== undefined && (
        <p className="text-sm text-zinc-500">
          {info.decisionBlockedReason === 'Only the decision authority can decide a Trigger'
            ? 'Waiting for the decision authority.'
            : info.decisionBlockedReason}
        </p>
      )}
    </div>
  )
}

function RecommendForm({ triggerId, destinations }: { triggerId: string; destinations: { id: string; name: string }[] }) {
  const router = useRouter()
  const [recommendation, setRecommendation] = useState<DecisionOutcome>('approve')
  const [destinationId, setDestinationId] = useState('')
  const [comments, setComments] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await recordRecommendationAction({ triggerId, recommendation, destinationId, comments })
          if (!result.ok) return setError(result.error)
          setSaved(true)
          setComments('')
          router.refresh()
        })
      }}
      className="max-w-2xl space-y-3 rounded border border-zinc-200 bg-white p-4"
    >
      <h3 className="text-sm font-medium">Your recommendation</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="rec-outcome" className="mb-1 block text-xs text-zinc-500">Recommend</label>
          <select id="rec-outcome" value={recommendation} onChange={(e) => setRecommendation(e.target.value as DecisionOutcome)} className={field}>
            {OUTCOMES.map((o) => (
              <option key={o} value={o}>{OUTCOME_LABELS[o]}</option>
            ))}
          </select>
        </div>
        {recommendation === 'approve' && (
          <div>
            <label htmlFor="rec-destination" className="mb-1 block text-xs text-zinc-500">Goes to</label>
            <select id="rec-destination" value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={field}>
              <option value="">Not sure yet</option>
              {destinations.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label htmlFor="rec-comments" className="mb-1 block text-xs text-zinc-500">Comments</label>
        <textarea id="rec-comments" rows={3} maxLength={4000} value={comments} onChange={(e) => setComments(e.target.value)} className={field} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saved && !error && <p className="text-sm text-zinc-600">Recorded. You can change it until the decision is made.</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Saving…' : 'Record recommendation'}
      </button>
    </form>
  )
}

function DecideForm({
  triggerId,
  destinations,
  evidenceOptions,
  decideAs,
  candidateCount,
}: {
  triggerId: string
  destinations: { id: string; name: string }[]
  evidenceOptions: { id: string; title: string; stage: string }[]
  decideAs: TriggerDecisionInfo['decideAs']
  candidateCount: number
}) {
  const router = useRouter()
  const [outcome, setOutcome] = useState<DecisionOutcome>('approve')
  const [destinationId, setDestinationId] = useState('')
  const [returnToStage, setReturnToStage] = useState<TriggerStage>('feasibility')
  const [rationale, setRationale] = useState('')
  const [conditions, setConditions] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [share, setShare] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await recordDecisionAction({
            triggerId,
            outcome,
            rationale,
            destinationId: outcome === 'approve' ? destinationId : '',
            returnToStage: outcome === 'revise' ? (returnToStage as 'researching' | 'concept' | 'feasibility') : '',
            conditions,
            evidence,
            shareWithRaiser: share,
          })
          if (!result.ok) return setError(result.error)
          router.refresh()
        })
      }}
      className="max-w-2xl space-y-3 rounded border border-zinc-300 bg-white p-4"
    >
      <h3 className="text-sm font-medium">
        Decision{decideAs && decideAs !== 'authority' ? ` (as ${AS_LABEL[decideAs]})` : ''}
      </h3>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Outcome</legend>
        {OUTCOMES.map((o) => (
          <label key={o} className="flex items-center gap-1.5">
            <input type="radio" name="outcome" value={o} checked={outcome === o} onChange={() => setOutcome(o)} />
            {OUTCOME_LABELS[o]}
          </label>
        ))}
      </fieldset>
      {outcome === 'approve' && (
        <div>
          <label htmlFor="dec-destination" className="mb-1 block text-xs text-zinc-500">Goes to</label>
          <select id="dec-destination" required value={destinationId} onChange={(e) => setDestinationId(e.target.value)} className={field}>
            <option value="" disabled>Choose…</option>
            {destinations.map((d) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          {candidateCount === 1 && (
            <p className="mt-1 text-xs text-zinc-600">
              There is one candidate customer. A single customer usually goes straight to Presales, with its account rep named in the handoff,
              rather than through a Marketing campaign.
            </p>
          )}
        </div>
      )}
      {outcome === 'revise' && (
        <div>
          <label htmlFor="dec-stage" className="mb-1 block text-xs text-zinc-500">Revise in</label>
          <select id="dec-stage" value={returnToStage} onChange={(e) => setReturnToStage(e.target.value as TriggerStage)} className={field}>
            {REVISE_STAGES.map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <label htmlFor="dec-rationale" className="mb-1 block text-xs text-zinc-500">Rationale</label>
        <textarea id="dec-rationale" required minLength={3} rows={4} maxLength={8000} value={rationale} onChange={(e) => setRationale(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="dec-conditions" className="mb-1 block text-xs text-zinc-500">Conditions (optional)</label>
        <input
          id="dec-conditions"
          maxLength={4000}
          value={conditions}
          onChange={(e) => setConditions(e.target.value)}
          placeholder="For example: start with existing Zadara storage customers"
          className={field}
        />
      </div>
      {evidenceOptions.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 text-xs text-zinc-500">Evidence relied on</legend>
          {evidenceOptions.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={evidence.includes(a.id)}
                onChange={(e) => setEvidence((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)))}
              />
              {a.title} <span className="text-xs text-zinc-400">({a.stage})</span>
            </label>
          ))}
        </fieldset>
      )}
      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />
        Share the rationale with the person who raised this Trigger
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Recording…' : 'Record decision'}
      </button>
    </form>
  )
}
