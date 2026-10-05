'use client'

import { useState, useTransition } from 'react'
import { reportEmberAnswerAction } from '@/app/actions/knowledge-gaps'
import { FAILURE_KIND_OPTIONS } from '@/components/projects/knowledge-gap-labels'
import type { KnowledgeGapFailureKind } from '@/types/database'

// "Report a problem with this answer" (Ember Readiness, Stage 3). The
// question, the answer, its citations and the model are attached on the
// server from the stored conversation; the user only says what was wrong.
// Goes to the Project's curators, not the platform feedback board.
export function ReportAnswerForm({ messageId, onClose }: { messageId: string; onClose: () => void }) {
  const [failureKind, setFailureKind] = useState<KnowledgeGapFailureKind>('wrong')
  const [details, setDetails] = useState('')
  const [correctAnswer, setCorrectAnswer] = useState('')
  const [suggestedSource, setSuggestedSource] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    startTransition(async () => {
      const result = await reportEmberAnswerAction(messageId, { failureKind, details, correctAnswer, suggestedSource })
      if (result.error) setError(result.error)
      else setSent(true)
    })
  }

  if (sent) {
    return (
      <p className="mt-1 text-xs text-green-700">
        Sent to the Project curators. You can follow it under Knowledge gaps on the Project page.{' '}
        <button type="button" onClick={onClose} className="underline">
          Close
        </button>
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 flex flex-col gap-2 rounded border border-zinc-200 bg-white p-2 text-left text-xs">
      <label className="flex items-center gap-2">
        <span className="font-medium">What was wrong?</span>
        <select value={failureKind} onChange={(e) => setFailureKind(e.target.value as KnowledgeGapFailureKind)} className="rounded border border-zinc-300 px-1 py-0.5">
          {FAILURE_KIND_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <textarea
        rows={2}
        maxLength={4000}
        value={details}
        onChange={(e) => setDetails(e.target.value)}
        placeholder="What was wrong or missing? (optional)"
        className="w-full rounded border border-zinc-300 px-2 py-1"
      />
      <textarea
        rows={2}
        maxLength={4000}
        value={correctAnswer}
        onChange={(e) => setCorrectAnswer(e.target.value)}
        placeholder="The correct answer, if you know it (optional)"
        className="w-full rounded border border-zinc-300 px-2 py-1"
      />
      <input
        maxLength={4000}
        value={suggestedSource}
        onChange={(e) => setSuggestedSource(e.target.value)}
        placeholder="A source that covers it, if you know one (optional)"
        className="w-full rounded border border-zinc-300 px-2 py-1"
      />
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className="rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50">
          {isPending ? 'Sending…' : 'Send to curators'}
        </button>
        <button type="button" onClick={onClose} className="underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
