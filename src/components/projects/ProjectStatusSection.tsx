'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import type { ProjectStatus } from '@/types/database'
import {
  startWorkingOnProjectAction,
  submitProjectForApprovalAction,
  sendProjectBackToWorkingAction,
  approveProjectAction,
  markProjectLiveAction,
  reopenProjectAction,
} from '@/app/actions/projects'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from '@/lib/projects/status-labels'

// Initial Draft -> Working on it -> For Approval -> Approved (awaiting the
// client) -> Live, per Mike (2026-08-28, Live added 2026-10-02). Labels are
// shared with every other status display (lib/projects/status-labels.ts).
const STATUS_LABELS = PROJECT_STATUS_LABELS
const STATUS_STYLES = PROJECT_STATUS_STYLES

interface StatusHistoryEntry {
  fromStatus: ProjectStatus | null
  toStatus: ProjectStatus
  createdAt: string
  actorEmail: string | null
}

export function ProjectStatusSection({
  projectId,
  status,
  canApprove,
  canAddWorkstream,
  showStatus,
  history,
}: {
  projectId: string
  status: ProjectStatus
  canApprove: boolean
  canAddWorkstream: boolean
  showStatus: boolean
  history: StatusHistoryEntry[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function run(action: () => Promise<void>) {
    setError(null)
    startTransition(async () => {
      try {
        await action()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update status')
      }
    })
  }

  if (!showStatus) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}>{STATUS_LABELS[status]}</span>
        {canApprove && status === 'draft' && (
          <button
            disabled={isPending}
            onClick={() => run(() => startWorkingOnProjectAction(projectId))}
            className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 disabled:opacity-50"
          >
            {isPending ? 'Updating…' : 'Start working'}
          </button>
        )}
        {canApprove && status === 'active' && (
          <button
            disabled={isPending}
            onClick={() => run(() => submitProjectForApprovalAction(projectId))}
            className="rounded-full border border-blue-300 bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-800 disabled:opacity-50"
          >
            {isPending ? 'Updating…' : 'Submit for approval'}
          </button>
        )}
        {canApprove && status === 'review' && (
          <button
            disabled={isPending}
            onClick={() => run(() => sendProjectBackToWorkingAction(projectId))}
            className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 disabled:opacity-50"
          >
            {isPending ? 'Updating…' : 'Send back to working'}
          </button>
        )}
        {canApprove && status === 'completed' && (
          <button
            disabled={isPending}
            onClick={() => {
              if (
                !confirm(
                  "Has the client approved this project? It will go Live and into maintenance. A builder's project passes to their agency, with the builder staying on to maintain it."
                )
              )
                return
              run(() => markProjectLiveAction(projectId))
            }}
            className="rounded-full border border-emerald-600 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 disabled:opacity-50"
          >
            {isPending ? 'Updating…' : 'Client approved — go Live'}
          </button>
        )}
        {canApprove && status === 'completed' && (
          <button
            disabled={isPending}
            onClick={() => {
              if (!confirm('Reopen this project for changes before it goes Live? It moves back to Working on it.')) return
              run(() => reopenProjectAction(projectId))
            }}
            className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800 disabled:opacity-50"
          >
            {isPending ? 'Updating…' : 'Reopen'}
          </button>
        )}
        {canApprove && status !== 'completed' && status !== 'live' && status !== 'archived' && (
          <button
            disabled={isPending}
            onClick={() => {
              if (!confirm('Mark this project approved?')) return
              run(() => approveProjectAction(projectId))
            }}
            className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 disabled:opacity-50"
          >
            {isPending ? 'Approving…' : 'Approve'}
          </button>
        )}
        {/* Live projects stay Live -- bug fixes and new features are new
            workstreams inside them (defaulting to Management & Maintenance). */}
        {canAddWorkstream && status === 'live' && (
          <Link
            href={`/projects/${projectId}/workstreams/new`}
            className="rounded-full border border-zinc-300 bg-white px-2 py-0.5 text-xs font-medium text-zinc-700 hover:border-zinc-500"
          >
            + Bug fix or new feature
          </Link>
        )}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
      {history.length > 0 && (
        <details className="text-xs text-zinc-500">
          <summary className="cursor-pointer select-none">Status history ({history.length})</summary>
          <ul className="mt-1 flex flex-col gap-1 pl-1">
            {history.map((h, i) => (
              <li key={i}>
                {new Date(h.createdAt).toLocaleString()} &mdash; {h.fromStatus ? `${STATUS_LABELS[h.fromStatus]} → ` : 'Created as '}
                {STATUS_LABELS[h.toStatus]}
                {h.actorEmail && ` (${h.actorEmail})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
