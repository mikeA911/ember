'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { submitWorkingKnowledgeSourceAction } from '@/app/actions/source-submissions'

// The promotion bridge from a private notebook to curator-reviewed content
// in one target Project's knowledge base -- the notebook's own Project, or
// the operator's Organization Home Project (docs/dev-request-kb-sandbox-
// builder-product.md); the detail page renders one form per target.
// Deliberately not folded into SubmitSourceForm.tsx, which submits files and
// artifacts from the Project page itself rather than a notebook.
export function WorkingKnowledgePromoteForm({
  workingKnowledgeItemId,
  targetProjectId,
  targetProjectName,
  knowledgeBases,
}: {
  workingKnowledgeItemId: string
  targetProjectId: string
  targetProjectName: string
  knowledgeBases: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [knowledgeBaseId, setKnowledgeBaseId] = useState(knowledgeBases[0]?.id ?? '')

  if (knowledgeBases.length === 0) return null

  if (submitted) {
    return (
      <p className="text-sm text-emerald-700">
        Submitted to {targetProjectName} -- its curator or owner will review it.{' '}
        <button type="button" onClick={() => setSubmitted(false)} className="underline">
          Submit again
        </button>
      </p>
    )
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!knowledgeBaseId) return
    setError(null)
    startTransition(async () => {
      try {
        await submitWorkingKnowledgeSourceAction({ projectId: targetProjectId, knowledgeBaseId, workingKnowledgeItemId })
        setSubmitted(true)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Submission failed')
      }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Submit to {targetProjectName}</h2>
      <p className="text-xs text-zinc-500">
        Propose this notebook for curator review, snapshotted at the point it&apos;s approved -- it stays private until then.
      </p>
      {knowledgeBases.length > 1 && (
        <select
          value={knowledgeBaseId}
          onChange={(e) => setKnowledgeBaseId(e.target.value)}
          className="rounded border border-zinc-300 px-3 py-2 text-sm"
        >
          {knowledgeBases.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}
            </option>
          ))}
        </select>
      )}
      <button
        disabled={isPending || !knowledgeBaseId}
        className="self-start rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
      >
        {isPending ? 'Submitting…' : 'Submit for review'}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </form>
  )
}
