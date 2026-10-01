'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { approveWorkstreamPromotionAction, rejectWorkstreamPromotionAction } from '@/app/actions/workstream-promotions'
import type { ClientViewerResult, PendingWorkstreamPromotionRow } from '@/lib/workbench/workstream-promotions'

// Review queue for workstream promotions -- same approve/reject shape as
// SourceSubmissionsReview.tsx. Reused in two places: scoped to one Project
// on that Project's own page (projectId passed -- the primary path for an
// ordinary team's own curator, e.g. an HR Manager, who may have no /admin
// access at all), and platform-wide on the /admin "Workstream Promotions"
// tab and the agency dashboard (projectId omitted).
export function WorkstreamPromotionsReview({ promotions, projectId }: { promotions: PendingWorkstreamPromotionRow[]; projectId?: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  // Shown once after an approval that added client viewers -- a new
  // account's password is never retrievable again after this.
  const [clientResults, setClientResults] = useState<{ projectId: string; viewers: ClientViewerResult[] } | null>(null)

  function approve(promotionId: string) {
    setError(null)
    setClientResults(null)
    startTransition(async () => {
      try {
        const result = await approveWorkstreamPromotionAction(promotionId, projectId)
        if (result.clientViewers.length > 0) setClientResults({ projectId: result.createdProjectId, viewers: result.clientViewers })
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  function reject(promotionId: string) {
    const reason = prompt('Reason for rejecting this promotion? (optional)')
    if (reason === null) return
    setError(null)
    startTransition(async () => {
      try {
        await rejectWorkstreamPromotionAction(promotionId, reason || undefined, projectId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  const clientResultsPanel = clientResults && (
    <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm">
      <p className="font-medium text-emerald-900">
        Client project created.{' '}
        <a href={`/projects/${clientResults.projectId}`} className="underline">
          Open it
        </a>
      </p>
      <ul className="mt-1 flex flex-col gap-0.5 text-xs">
        {clientResults.viewers.map((v) => (
          <li key={v.email} className={v.status === 'failed' ? 'text-red-700' : 'text-emerald-900'}>
            {v.email}:{' '}
            {v.status === 'added' && 'added as viewer'}
            {v.status === 'created' && (
              <>
                new account, temporary password <code className="rounded bg-white px-1">{v.password}</code>
              </>
            )}
            {v.status === 'failed' && `not added -- ${v.error}`}
          </li>
        ))}
      </ul>
      {clientResults.viewers.some((v) => v.status === 'created') && (
        <p className="mt-1 text-xs text-emerald-800">Copy these now and send them to the client -- they won&apos;t be shown again.</p>
      )}
    </div>
  )

  if (promotions.length === 0) {
    return clientResultsPanel || <p className="text-sm text-zinc-500">No pending workstream promotions.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      {clientResultsPanel}
      <ul className="flex flex-col gap-2">
        {promotions.map((p) => (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white p-3 text-sm">
            <div>
              <div className="font-medium">{p.workstreamName}</div>
              <div className="text-xs text-zinc-500">
                {p.projectName} · submitted by {p.submitterEmail ?? 'unknown'} · {p.approvedArtifactCount} approved artifact
                {p.approvedArtifactCount === 1 ? '' : 's'}
              </div>
              {p.clientEmails.length > 0 && <div className="text-xs text-zinc-500">Client viewers: {p.clientEmails.join(', ')}</div>}
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                disabled={isPending}
                onClick={() => approve(p.id)}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={() => reject(p.id)}
                className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          </li>
        ))}
      </ul>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
