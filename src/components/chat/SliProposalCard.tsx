'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { cancelSliProposalAction, confirmSliProposalAction } from '@/app/actions/sli-proposals'
import { CANDIDATE_TIERS, type SliProposal } from '@/lib/sli/types'

// A change Ember proposed (docs/design-notes/ember-sli-calm-workspace.md §3
// principle 3): nothing is saved until the person confirms. Once decided
// it becomes a quiet line saying what happened.

const RECOMMENDATIONS: Record<string, string> = { approve: 'Approve', revise: 'Revise', defer: 'Defer', reject: 'Reject' }

function text(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function tier(v: unknown): string | null {
  return typeof v === 'string' && v in CANDIDATE_TIERS ? CANDIDATE_TIERS[v as keyof typeof CANDIDATE_TIERS] : text(v)
}

function details(p: SliProposal): [string, string | null][] {
  const d = p.payload
  const candidate = (d.candidate ?? null) as Record<string, unknown> | null
  switch (p.kind) {
    case 'raise_trigger':
      return [
        ['Title', text(d.title)],
        ['Summary', text(d.summary)],
        ['Event date', text(d.eventDate)],
        ['Reference', text(d.eventReference)],
        ['Objective', text(d.strategicObjective)],
      ]
    case 'add_candidate':
      return [
        ['Company', text(d.customerName)],
        ['Tier', tier(d.tier)],
        ['Why', text(d.fitRationale)],
        ['Fit', text(d.solutionFit)],
        ['Priority', text(d.priority)],
      ]
    case 'create_customer':
      return [
        ['Company', text(d.name)],
        ['Website', text(d.website)],
        ['Phone', text(d.mainPhone)],
        ['Industry', [text(d.industry), text(d.subIndustry)].filter(Boolean).join(' · ') || null],
        ['Region', text(d.region)],
        ['Candidate', candidate ? tier(candidate.tier) : null],
        ['Why', candidate ? text(candidate.fitRationale) : null],
      ]
    case 'save_notes':
      return [['Title', text(d.title)]]
    case 'record_recommendation':
      return [
        ['Recommend', RECOMMENDATIONS[String(d.recommendation)] ?? text(d.recommendation)],
        ['Hand to', text(d.destinationName)],
        ['Comments', text(d.comments)],
      ]
  }
}

function Outcome({ p }: { p: SliProposal }) {
  const trigger = p.result?.code ?? p.triggerCode
  switch (p.kind) {
    case 'raise_trigger':
      return (
        <>
          Raised as{' '}
          <Link href={`/sli/discovery/${p.result?.code}`} className="font-medium underline">
            {p.result?.code}
          </Link>{' '}
          · in the history
        </>
      )
    case 'add_candidate':
      return (
        <>
          {text(p.payload.customerName)} added to{' '}
          <Link href={`/sli/discovery/${trigger}`} className="underline">
            {trigger}
          </Link>
          ’s candidates
        </>
      )
    case 'create_customer':
      return (
        <>
          <Link href={`/sli/customers/${p.result?.customerId}`} className="font-medium underline">
            {text(p.payload.name)}
          </Link>{' '}
          added to the registry{p.payload.candidate ? ` and to ${trigger}’s candidates` : ''}
        </>
      )
    case 'record_recommendation':
      return <>Recommendation recorded on {trigger} · in the history</>
    case 'save_notes':
      return (
        <>
          Saved to{' '}
          <Link href={`/sli/discovery/${trigger}/workspace`} className="underline">
            {trigger}
          </Link>
          ’s research · under Saved
        </>
      )
  }
}

export function SliProposalCard({ proposal: initial }: { proposal: SliProposal }) {
  const [proposal, setProposal] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function decide(confirm: boolean) {
    setError(null)
    startTransition(async () => {
      const res = await (confirm ? confirmSliProposalAction(proposal.id) : cancelSliProposalAction(proposal.id))
      if (res.ok) setProposal(res.proposal)
      else setError(res.error)
    })
  }

  if (proposal.status === 'confirmed') {
    return (
      <p className="mt-2 flex items-center gap-2 text-xs text-zinc-600">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        <span>
          <Outcome p={proposal} />
        </span>
      </p>
    )
  }
  if (proposal.status === 'cancelled') {
    return <p className="mt-2 text-xs text-zinc-500">Not saved: {proposal.summary.charAt(0).toLowerCase() + proposal.summary.slice(1)}.</p>
  }

  const rows = details(proposal).filter((r): r is [string, string] => r[1] !== null)
  return (
    <div className="mt-2 max-w-md rounded-xl border border-orange-200/80 bg-white/90 p-3 text-sm shadow-sm" role="group" aria-label="Ember suggests">
      <p className="text-xs uppercase tracking-wide text-orange-700">Ember suggests</p>
      <p className="mt-1 font-medium text-zinc-900">{proposal.summary}?</p>
      {rows.length > 0 && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-zinc-700">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-zinc-500">{label}</dt>
              <dd className="whitespace-pre-wrap">{value}</dd>
            </div>
          ))}
        </dl>
      )}
      {proposal.kind === 'save_notes' && text(proposal.payload.content) && (
        <details className="mt-2 text-xs text-zinc-700">
          <summary className="cursor-pointer text-zinc-500">The notes</summary>
          <div className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-zinc-50 p-2">{text(proposal.payload.content)}</div>
        </details>
      )}
      {proposal.status === 'failed' && (
        <p className="mt-2 text-xs text-red-700">Not saved: {proposal.error ?? 'it was refused.'} Tell Ember what to change.</p>
      )}
      {proposal.status === 'proposed' && (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            disabled={isPending}
            onClick={() => decide(true)}
            className="rounded-full bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Confirm'}
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => decide(false)}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs text-zinc-700 disabled:opacity-50"
          >
            Not now
          </button>
          <span className="text-xs text-zinc-500">To change it, just tell Ember.</span>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}
