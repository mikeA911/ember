'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { resubmitProjectForApprovalAction } from '@/app/actions/project-approval'
import type { ProjectApprovalState } from '@/lib/workbench/project-approval'
import { ProjectApprovalDecision } from './ProjectApprovalDecision'

export function ProjectApprovalBanner({
  projectId,
  projectName,
  state,
  viewerIsCreator,
  viewerCanDecide,
}: {
  projectId: string
  projectName: string
  state: ProjectApprovalState
  viewerIsCreator: boolean
  viewerCanDecide: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const rejected = state.status === 'rejected'

  return (
    <div className={`flex flex-col gap-2 rounded border p-4 text-sm ${rejected ? 'border-red-300 bg-red-50 text-red-900' : 'border-amber-300 bg-amber-50 text-amber-900'}`}>
      <p className="font-medium">{rejected ? 'Not approved' : 'Awaiting approval'}</p>
      {rejected ? (
        <p>
          Reason: {state.reason ?? 'none given'}. You can keep working on it and resubmit when you&apos;re ready.
        </p>
      ) : viewerIsCreator ? (
        <p>
          Waiting for {state.approverLabel} to approve this project. You can keep working on it meanwhile -- until it&apos;s approved, only you can see
          it, and members can&apos;t be added or the project shared.
        </p>
      ) : (
        <p>Only the creator can see this project until it&apos;s approved.</p>
      )}
      {state.pendingMemberEmails.length > 0 && (
        <p className="text-xs">Added on approval: {state.pendingMemberEmails.join(', ')}</p>
      )}
      {viewerCanDecide && state.status === 'pending' && <ProjectApprovalDecision projectId={projectId} projectName={projectName} />}
      {viewerIsCreator && rejected && (
        <div>
          <button
            disabled={isPending}
            onClick={() => {
              setError(null)
              startTransition(async () => {
                try {
                  await resubmitProjectForApprovalAction(projectId)
                  router.refresh()
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Action failed')
                }
              })
            }}
            className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            Resubmit for approval
          </button>
        </div>
      )}
      {error && <p className="text-red-600">{error}</p>}
    </div>
  )
}
