'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { reportTypedFailureAction } from '@/app/actions/knowledge-gaps'
import { FAILURE_KIND_OPTIONS } from './knowledge-gap-labels'
import type { KnowledgeGapFailureKind } from '@/types/database'

// Any Project member can tell the curators that Ember got something wrong
// or couldn't answer, without having the answer to hand (Ember Readiness,
// Stage 3). From inside a chat, "Report a problem" on the answer is better:
// it attaches the answer and its sources automatically.
export function ReportFailureForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [emberAnswer, setEmberAnswer] = useState('')
  const [failureKind, setFailureKind] = useState<KnowledgeGapFailureKind>('could_not_answer')
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
      const result = await reportTypedFailureAction(projectId, { question, emberAnswer, failureKind, details, correctAnswer, suggestedSource })
      if (result.error) {
        setError(result.error)
        return
      }
      setSent(true)
      setOpen(false)
      setQuestion('')
      setEmberAnswer('')
      setDetails('')
      setCorrectAnswer('')
      setSuggestedSource('')
      router.refresh()
    })
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => { setOpen(true); setSent(false) }} className="text-sm text-blue-700 underline">
          Report something Ember got wrong
        </button>
        {sent && <span className="text-sm text-green-700">Sent to the Project curators.</span>}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm">
      <label className="flex flex-col gap-1">
        <span className="font-medium">What did you ask Ember?</span>
        <textarea required rows={2} maxLength={4000} value={question} onChange={(e) => setQuestion(e.target.value)} className="w-full rounded border border-zinc-300 px-2 py-1" />
      </label>
      <label className="flex items-center gap-2">
        <span className="font-medium">What went wrong?</span>
        <select value={failureKind} onChange={(e) => setFailureKind(e.target.value as KnowledgeGapFailureKind)} className="rounded border border-zinc-300 px-2 py-1">
          {FAILURE_KIND_OPTIONS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <textarea rows={2} maxLength={8000} value={emberAnswer} onChange={(e) => setEmberAnswer(e.target.value)} placeholder="What Ember said (optional)" className="w-full rounded border border-zinc-300 px-2 py-1" />
      <textarea rows={2} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} placeholder="What was wrong or missing? (optional)" className="w-full rounded border border-zinc-300 px-2 py-1" />
      <textarea rows={2} maxLength={4000} value={correctAnswer} onChange={(e) => setCorrectAnswer(e.target.value)} placeholder="The correct answer, if you know it (optional)" className="w-full rounded border border-zinc-300 px-2 py-1" />
      <input maxLength={4000} value={suggestedSource} onChange={(e) => setSuggestedSource(e.target.value)} placeholder="A source that covers it, if you know one (optional)" className="w-full rounded border border-zinc-300 px-2 py-1" />
      {error && <p className="text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white disabled:opacity-50">
          {isPending ? 'Sending…' : 'Send to curators'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
