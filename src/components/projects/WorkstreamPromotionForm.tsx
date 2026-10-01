'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitWorkstreamForPromotionAction } from '@/app/actions/workstream-promotions'

// Submit a completed workstream for this Project's own curator to review --
// on approval, a new Project is created for the promoted work (this
// Project's other, unsubmitted content is never exposed). Visible to any
// active member of this Project, and only when there's nothing already in
// flight for it -- see the page's own gating. In builder mode this is how
// an accepted client proposal becomes the client's own Project: the
// builder names the client people to add as viewers, and their agency
// approves.
export function WorkstreamPromotionForm({
  projectId,
  workstreamId,
  isBuilderProposal = false,
}: {
  projectId: string
  workstreamId: string
  isBuilderProposal?: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [clientEmails, setClientEmails] = useState('')

  if (submitted) {
    return (
      <p className="text-sm text-emerald-700">
        {isBuilderProposal
          ? 'Sent -- your agency will review it and create the client project.'
          : 'Submitted for promotion -- the operator will review it.'}
      </p>
    )
  }

  function handleSubmit() {
    setError(null)
    startTransition(async () => {
      try {
        const emails = clientEmails.split(/[\s,;]+/).filter(Boolean)
        await submitWorkstreamForPromotionAction(projectId, workstreamId, emails)
        setSubmitted(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {isBuilderProposal ? 'Proposal accepted? Request a client project' : 'Submit for promotion'}
      </h2>
      {isBuilderProposal ? (
        <p className="text-xs text-zinc-500">
          Ask your agency to create a project for this client. You&apos;ll own it, it starts with your approved
          artifacts, and the client people below can view it. Your other workstreams and notes stay private.
        </p>
      ) : (
        <p className="text-xs text-zinc-500">
          Propose this completed workstream to this Project&apos;s curator. If accepted, a new Project is created with
          your approved artifacts, and you&apos;re added as a member.
        </p>
      )}
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-zinc-600">Client emails (optional -- added as viewers)</span>
        <textarea
          value={clientEmails}
          onChange={(e) => setClientEmails(e.target.value)}
          rows={2}
          placeholder="jane@client.com, sam@client.com"
          className="rounded border border-zinc-300 px-3 py-2 text-sm"
        />
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={handleSubmit}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Submitting…' : isBuilderProposal ? 'Request client project' : 'Submit for promotion'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
