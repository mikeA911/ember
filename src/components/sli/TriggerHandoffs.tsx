'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { answerHandoffAction, proposeHandoffAction, raiseSendBackAction } from '@/app/actions/sli'
import type { ResearchFinding } from '@/lib/sli/api'
import { SEND_BACK_REASONS, STAGE_LABELS, type SendBackReason, type TriggerHandoff, type TriggerHandoffInfo, type TriggerStage } from '@/lib/sli/types'

// Handoffs on a Trigger (Discovery design §7): the sponsor proposes the
// approved handoff with a package; the receiving lead accepts (the package
// is copied into the department's workspace) or returns it; later the
// receiving department can send it back, and the sponsor or a decision
// authority accepts or declines. The database decides who may do what.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'
const STATUS_LABEL: Record<TriggerHandoff['status'], string> = {
  proposed: 'Waiting for an answer',
  accepted: 'Accepted',
  returned: 'Returned',
  withdrawn: 'Withdrawn',
  declined: 'Declined',
}
const when = (iso: string) => new Date(iso).toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })

export function TriggerHandoffs({
  triggerId,
  info,
  researchOptions,
  receivedPackage,
}: {
  triggerId: string
  info: TriggerHandoffInfo
  researchOptions: { id: string; title: string; stage: string }[]
  // The copied package in the receiving department's Workstream, when the
  // caller can read it.
  receivedPackage: ResearchFinding[]
}) {
  const handoffs = [...(info.handoffs ?? [])].reverse()
  return (
    <div className="space-y-4">
      {handoffs.map((h) => (
        <HandoffCard key={h.id} handoff={h} receivedPackage={h.status === 'accepted' && h.kind === 'promote' ? receivedPackage : []} />
      ))}
      {info.canPropose && info.proposeTo && <ProposeForm triggerId={triggerId} proposeTo={info.proposeTo} researchOptions={researchOptions} />}
      {info.canSendBack && <SendBackForm triggerId={triggerId} />}
    </div>
  )
}

function HandoffCard({ handoff: h, receivedPackage }: { handoff: TriggerHandoff; receivedPackage: ResearchFinding[] }) {
  const title =
    h.kind === 'promote'
      ? `Handoff to ${h.destination}`
      : `Sent back by ${h.destination} to ${h.toStage ? STAGE_LABELS[h.toStage] : ''}${h.reasonCategory ? ` (${SEND_BACK_REASONS[h.reasonCategory]})` : ''}`
  return (
    <div className={`space-y-2 rounded border p-4 text-sm ${h.status === 'proposed' ? 'border-amber-300 bg-amber-50' : 'border-zinc-200 bg-white'}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium">{title}</span>
        <span className="text-xs text-zinc-500">
          {STATUS_LABEL[h.status]} · {h.proposedBy}, {when(h.proposedAt)}
          {h.decidedBy && h.decidedAt ? ` · ${h.decidedBy}, ${when(h.decidedAt)}` : ''}
        </span>
      </div>
      {h.message && <p className="whitespace-pre-wrap">{h.message}</p>}
      {h.reason && <p className="whitespace-pre-wrap">{h.reason}</p>}
      {h.kind === 'send_back' && h.downstreamAction && (
        <p className="text-zinc-600">{h.downstreamAction === 'close' ? 'Their work closes if accepted.' : 'Their work pauses if accepted.'}</p>
      )}
      {h.conditions && (
        <p>
          <span className="text-zinc-500">Conditions:</span> {h.conditions}
        </p>
      )}
      {h.targetIndustries && (
        <p>
          <span className="text-zinc-500">Target industries:</span> {h.targetIndustries}
        </p>
      )}
      {h.approvedClaims && (
        <div>
          <span className="text-zinc-500">Approved claims:</span>
          <p className="whitespace-pre-wrap">{h.approvedClaims}</p>
        </div>
      )}
      {receivedPackage.length > 0 ? (
        <div className="space-y-1">
          <span className="text-zinc-500">Package:</span>
          <ul className="space-y-1">
            {receivedPackage.map((f) => (
              <li key={f.id} className="rounded border border-zinc-200 bg-white">
                <details>
                  <summary className="cursor-pointer px-3 py-1.5 font-medium">{f.title}</summary>
                  {f.content && <div className="whitespace-pre-wrap border-t border-zinc-100 px-3 py-2">{f.content}</div>}
                </details>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        h.items.length > 0 && (
          <p>
            <span className="text-zinc-500">Package:</span> {h.items.map((i) => i.title).join(', ')}
          </p>
        )
      )}
      {h.decisionReason && (
        <p className="text-zinc-600">
          <span className="text-zinc-500">Answer:</span> {h.decisionReason}
        </p>
      )}
      {(h.canDecide || h.canWithdraw) && <AnswerForm handoff={h} />}
    </div>
  )
}

function AnswerForm({ handoff: h }: { handoff: TriggerHandoff }) {
  const router = useRouter()
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function answer(kind: 'promote' | 'send_back' | 'withdraw', accept: boolean) {
    setError(null)
    startTransition(async () => {
      const result = await answerHandoffAction({ handoffId: h.id, accept, reason, kind })
      if (!result.ok) return setError(result.error)
      setReason('')
      router.refresh()
    })
  }

  const isPromote = h.kind === 'promote'
  return (
    <div className="space-y-2 border-t border-amber-200 pt-3">
      <label htmlFor={`answer-${h.id}`} className="block text-xs text-zinc-500">
        {h.canDecide ? (isPromote ? 'Reason (required to return it)' : 'Reason (required to decline it)') : 'Reason (optional)'}
      </label>
      <textarea id={`answer-${h.id}`} rows={2} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      <div className="flex flex-wrap gap-2">
        {h.canDecide && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => answer(h.kind, true)}
              className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50"
            >
              {isPromote ? 'Accept handoff' : `Accept and reopen ${h.toStage ? STAGE_LABELS[h.toStage] : ''}`}
            </button>
            <button type="button" disabled={pending} onClick={() => answer(h.kind, false)} className="rounded border border-zinc-300 bg-white px-3 py-1.5 disabled:opacity-50">
              {isPromote ? 'Return it' : 'Decline'}
            </button>
          </>
        )}
        {h.canWithdraw && (
          <button type="button" disabled={pending} onClick={() => answer('withdraw', false)} className="rounded border border-zinc-300 bg-white px-3 py-1.5 disabled:opacity-50">
            Withdraw
          </button>
        )}
      </div>
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}

function ProposeForm({
  triggerId,
  proposeTo,
  researchOptions,
}: {
  triggerId: string
  proposeTo: NonNullable<TriggerHandoffInfo['proposeTo']>
  researchOptions: { id: string; title: string; stage: string }[]
}) {
  const router = useRouter()
  const [message, setMessage] = useState('')
  const [artifacts, setArtifacts] = useState<string[]>([])
  const [targetIndustries, setTargetIndustries] = useState('')
  const [approvedClaims, setApprovedClaims] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await proposeHandoffAction({ triggerId, message, artifacts, targetIndustries, approvedClaims })
          if (!result.ok) return setError(result.error)
          router.refresh()
        })
      }}
      className="max-w-2xl space-y-3 rounded border border-zinc-300 bg-white p-4"
    >
      <h3 className="text-sm font-medium">Hand off to {proposeTo.name}</h3>
      <p className="text-xs text-zinc-500">
        {proposeTo.name}&rsquo;s lead accepts or returns it. They receive copies of what you select, never the research itself.
        {proposeTo.conditions ? ` The decision's conditions go with it: ${proposeTo.conditions}` : ''}
      </p>
      <div>
        <label htmlFor="ho-message" className="mb-1 block text-xs text-zinc-500">What you are handing over, and what you expect next</label>
        <textarea id="ho-message" rows={3} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} className={field} />
      </div>
      {researchOptions.length > 0 && (
        <fieldset className="space-y-1 text-sm">
          <legend className="mb-1 text-xs text-zinc-500">Include in the package</legend>
          {researchOptions.map((a) => (
            <label key={a.id} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={artifacts.includes(a.id)}
                onChange={(e) => setArtifacts((prev) => (e.target.checked ? [...prev, a.id] : prev.filter((x) => x !== a.id)))}
              />
              {a.title} <span className="text-xs text-zinc-400">({a.stage})</span>
            </label>
          ))}
        </fieldset>
      )}
      <div>
        <label htmlFor="ho-industries" className="mb-1 block text-xs text-zinc-500">Target industries</label>
        <input id="ho-industries" maxLength={2000} value={targetIndustries} onChange={(e) => setTargetIndustries(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor="ho-claims" className="mb-1 block text-xs text-zinc-500">Approved claims (what may be said to customers)</label>
        <textarea id="ho-claims" rows={3} maxLength={8000} value={approvedClaims} onChange={(e) => setApprovedClaims(e.target.value)} className={field} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Sending…' : `Propose handoff to ${proposeTo.name}`}
      </button>
    </form>
  )
}

function SendBackForm({ triggerId }: { triggerId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [toStage, setToStage] = useState<TriggerStage>('feasibility')
  const [reasonCategory, setReasonCategory] = useState<SendBackReason>('solution_inadequate')
  const [reason, setReason] = useState('')
  const [downstreamAction, setDownstreamAction] = useState<'pause' | 'close'>('pause')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm">
        Send back to Discovery
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await raiseSendBackAction({
            triggerId,
            toStage: toStage as 'researching' | 'concept' | 'feasibility',
            reasonCategory,
            reason,
            downstreamAction,
          })
          if (!result.ok) return setError(result.error)
          setOpen(false)
          router.refresh()
        })
      }}
      className="max-w-2xl space-y-3 rounded border border-zinc-300 bg-white p-4"
    >
      <h3 className="text-sm font-medium">Send back to Discovery</h3>
      <p className="text-xs text-zinc-500">
        For when the solution itself needs rethinking. A different customer need is better raised as a new Trigger.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sb-category" className="mb-1 block text-xs text-zinc-500">Why</label>
          <select id="sb-category" value={reasonCategory} onChange={(e) => setReasonCategory(e.target.value as SendBackReason)} className={field}>
            {(Object.keys(SEND_BACK_REASONS) as SendBackReason[]).map((k) => (
              <option key={k} value={k}>{SEND_BACK_REASONS[k]}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sb-stage" className="mb-1 block text-xs text-zinc-500">Reopen</label>
          <select id="sb-stage" value={toStage} onChange={(e) => setToStage(e.target.value as TriggerStage)} className={field}>
            {(['researching', 'concept', 'feasibility'] as TriggerStage[]).map((s) => (
              <option key={s} value={s}>{STAGE_LABELS[s]}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="sb-reason" className="mb-1 block text-xs text-zinc-500">What you found (test results, customer feedback)</label>
        <textarea id="sb-reason" required minLength={3} rows={3} maxLength={4000} value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
      </div>
      <fieldset className="flex flex-wrap gap-4 text-sm">
        <legend className="mb-1 text-xs text-zinc-500">If it is accepted, our work</legend>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="sb-action" checked={downstreamAction === 'pause'} onChange={() => setDownstreamAction('pause')} /> pauses
        </label>
        <label className="flex items-center gap-1.5">
          <input type="radio" name="sb-action" checked={downstreamAction === 'close'} onChange={() => setDownstreamAction('close')} /> closes
        </label>
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
          {pending ? 'Sending…' : 'Send back'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="rounded border border-zinc-300 px-3 py-1.5 text-sm">
          Cancel
        </button>
      </div>
    </form>
  )
}
