'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addCandidateAction, searchCustomersAction, setCandidateStatusAction } from '@/app/actions/sli-customers'
import { CANDIDATE_TIERS, type CandidateList, type CandidateTier, type CustomerListItem, type SolutionFit } from '@/lib/sli/types'

// The Discovery team's list of companies a Trigger's solution is for
// (Discovery design §7): built in tiers, each with why it fits; trimmed
// candidates keep their reason. Existing customers can be found by what
// they run, from their technology profile.

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'
const FIT_LABEL: Record<SolutionFit, string> = { strong: 'Strong fit', partial: 'Partial fit', poor: 'Poor fit', unknown: 'Fit unknown' }
const FIT_STYLE: Record<SolutionFit, string> = {
  strong: 'bg-emerald-50 text-emerald-800',
  partial: 'bg-amber-50 text-amber-800',
  poor: 'bg-zinc-100 text-zinc-600',
  unknown: 'bg-zinc-50 text-zinc-600',
}

export function CandidateCustomers({ triggerId, list }: { triggerId: string; list: CandidateList }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [trimming, setTrimming] = useState<string | null>(null)
  const [reason, setReason] = useState('')

  const accepted = list.candidates.filter((c) => c.status !== 'removed')
  const trimmed = list.candidates.filter((c) => c.status === 'removed')

  function setStatus(candidateId: string, status: 'accepted' | 'removed', why?: string) {
    setError(null)
    startTransition(async () => {
      const result = await setCandidateStatusAction({ candidateId, status, reason: why })
      if (!result.ok) return setError(result.error)
      setTrimming(null)
      setReason('')
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {accepted.length === 0 ? (
        <p className="text-sm text-zinc-500">No candidate customers yet. Start with existing customers, then related companies, then new prospects.</p>
      ) : (
        (Object.keys(CANDIDATE_TIERS) as CandidateTier[]).map((tier) => {
          const rows = accepted.filter((c) => c.tier === tier)
          if (rows.length === 0) return null
          return (
            <div key={tier} className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
                {CANDIDATE_TIERS[tier]} ({rows.length})
              </h4>
              <ul className="space-y-2">
                {rows.map((c) => (
                  <li key={c.candidateId} className="rounded border border-zinc-200 bg-white p-3 text-sm">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>
                        <Link href={`/sli/customers/${c.id}`} className="font-medium underline">{c.name}</Link>
                        <span className={`ml-2 rounded px-1.5 py-0.5 text-xs ${FIT_STYLE[c.solutionFit]}`}>{FIT_LABEL[c.solutionFit]}</span>
                        {c.priority && <span className="ml-2 text-xs text-zinc-500">{c.priority} priority</span>}
                      </span>
                      <span className="text-xs text-zinc-500">
                        {c.accountRep ? `Account rep: ${c.accountRep}` : 'No account rep'}
                        {c.top1000 ? ` · Top 1000 #${c.top1000}` : ''}
                      </span>
                    </div>
                    <p className="mt-1">{c.fitRationale}</p>
                    {c.relationshipPath && <p className="mt-1 text-zinc-600">{c.relationshipPath}</p>}
                    {list.canEdit &&
                      (trimming === c.candidateId ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault()
                            setStatus(c.candidateId, 'removed', reason)
                          }}
                          className="mt-2 flex flex-wrap gap-2"
                        >
                          <input
                            aria-label="Why trim it"
                            required
                            minLength={3}
                            maxLength={1000}
                            value={reason}
                            onChange={(e) => setReason(e.target.value)}
                            placeholder="Why trim it (e.g. renewed last month)"
                            className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1"
                          />
                          <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50">Trim</button>
                          <button type="button" onClick={() => setTrimming(null)} className="px-2 py-1 text-zinc-600 underline">Cancel</button>
                        </form>
                      ) : (
                        <button type="button" onClick={() => setTrimming(c.candidateId)} className="mt-2 text-xs text-zinc-600 underline">
                          Trim from the list
                        </button>
                      ))}
                  </li>
                ))}
              </ul>
            </div>
          )
        })
      )}
      {trimmed.length > 0 && (
        <details className="text-sm text-zinc-600">
          <summary className="cursor-pointer">Trimmed ({trimmed.length})</summary>
          <ul className="mt-1 space-y-1">
            {trimmed.map((c) => (
              <li key={c.candidateId}>
                {c.name}: {c.trimmedReason}
                {list.canEdit && (
                  <button type="button" disabled={pending} onClick={() => setStatus(c.candidateId, 'accepted')} className="ml-2 text-xs underline">
                    Bring back
                  </button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      {list.canEdit && <AddCandidate triggerId={triggerId} existing={list.candidates.map((c) => c.id)} />}
    </div>
  )
}

function AddCandidate({ triggerId, existing }: { triggerId: string; existing: string[] }) {
  const router = useRouter()
  const [search, setSearch] = useState('')
  const [technology, setTechnology] = useState('')
  const [results, setResults] = useState<CustomerListItem[] | null>(null)
  const [chosen, setChosen] = useState<CustomerListItem | null>(null)
  const [tier, setTier] = useState<CandidateTier>('existing_customer')
  const [solutionFit, setSolutionFit] = useState<SolutionFit>('unknown')
  const [priority, setPriority] = useState('')
  const [fitRationale, setFitRationale] = useState('')
  const [relationshipPath, setRelationshipPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  return (
    <div className="max-w-2xl space-y-3 rounded border border-zinc-300 bg-white p-4 text-sm">
      <h4 className="font-medium">Add a candidate customer</h4>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          startTransition(async () => setResults(await searchCustomersAction({ search, technology })))
        }}
        className="flex flex-wrap gap-2"
      >
        <input aria-label="Company name" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Company name" className="rounded border border-zinc-300 px-2 py-1.5" />
        <input aria-label="Runs" value={technology} onChange={(e) => setTechnology(e.target.value)} placeholder="Runs… (e.g. VMware)" className="rounded border border-zinc-300 px-2 py-1.5" />
        <button type="submit" disabled={pending} className="rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50">Find</button>
        <Link href="/sli/customers/new" target="_blank" className="self-center text-zinc-600 underline">Not in the registry? Add it</Link>
      </form>
      {results && (
        <ul className="max-h-48 space-y-1 overflow-y-auto">
          {results.length === 0 && <li className="text-zinc-500">No companies match.</li>}
          {results.map((r) => {
            const already = existing.includes(r.id)
            return (
              <li key={r.id}>
                <button
                  type="button"
                  disabled={already}
                  onClick={() => setChosen(r)}
                  className={`w-full rounded px-2 py-1 text-left hover:bg-zinc-50 disabled:opacity-50 ${chosen?.id === r.id ? 'bg-zinc-100' : ''}`}
                >
                  <span className="font-medium">{r.name}</span>
                  <span className="text-xs text-zinc-500">
                    {r.industry ? ` · ${r.industry}` : ''}
                    {r.technologies.length ? ` · runs ${r.technologies.join(', ')}` : ''}
                    {already ? ' · already listed' : ''}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {chosen && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            setError(null)
            startTransition(async () => {
              const result = await addCandidateAction({
                triggerId,
                customerId: chosen.id,
                tier,
                fitRationale,
                solutionFit,
                priority: priority as '' | 'low' | 'medium' | 'high',
                relationshipPath,
              })
              if (!result.ok) return setError(result.error)
              setChosen(null)
              setFitRationale('')
              setRelationshipPath('')
              router.refresh()
            })
          }}
          className="space-y-3 border-t border-zinc-200 pt-3"
        >
          <p className="font-medium">{chosen.name}</p>
          <div className="grid gap-3 sm:grid-cols-3">
            <select aria-label="Tier" value={tier} onChange={(e) => setTier(e.target.value as CandidateTier)} className={field}>
              {(Object.keys(CANDIDATE_TIERS) as CandidateTier[]).map((t) => (
                <option key={t} value={t}>{CANDIDATE_TIERS[t]}</option>
              ))}
            </select>
            <select aria-label="Solution fit" value={solutionFit} onChange={(e) => setSolutionFit(e.target.value as SolutionFit)} className={field}>
              {(Object.keys(FIT_LABEL) as SolutionFit[]).map((f) => (
                <option key={f} value={f}>{FIT_LABEL[f]}</option>
              ))}
            </select>
            <select aria-label="Priority" value={priority} onChange={(e) => setPriority(e.target.value)} className={field}>
              <option value="">Priority not set</option>
              <option value="high">High priority</option>
              <option value="medium">Medium priority</option>
              <option value="low">Low priority</option>
            </select>
          </div>
          <textarea
            aria-label="Why this company"
            required
            minLength={3}
            rows={2}
            maxLength={4000}
            value={fitRationale}
            onChange={(e) => setFitRationale(e.target.value)}
            placeholder="Why this company (e.g. runs VMware on 60 VMs, renewal in March)"
            className={field}
          />
          {tier === 'related_company' && (
            <input
              aria-label="Relationship"
              maxLength={500}
              value={relationshipPath}
              onChange={(e) => setRelationshipPath(e.target.value)}
              placeholder="How it is related (e.g. sister company of a Zadara storage customer)"
              className={field}
            />
          )}
          {error && <p className="text-red-600">{error}</p>}
          <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
            {pending ? 'Adding…' : 'Add to the list'}
          </button>
        </form>
      )}
    </div>
  )
}
