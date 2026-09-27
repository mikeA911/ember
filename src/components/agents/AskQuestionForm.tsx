'use client'

import { useState } from 'react'
import { askRagAnswerAgentAction } from '@/app/actions/agents'
import type { RetrievedEvidenceItem, GraphStep } from '@/types/database'
import type { RagGraphEvaluation } from '@/lib/graph/state'

interface AnswerState {
  answer: string | null
  evidence: RetrievedEvidenceItem[]
  evaluation: RagGraphEvaluation | null
  terminationReason: string | null
  steps: GraphStep[]
}

export function AskQuestionForm() {
  const [question, setQuestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AnswerState | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!question.trim()) return
    setSubmitting(true)
    setError(null)
    setResult(null)
    try {
      const res = await askRagAnswerAgentAction({ question })
      setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get an answer')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Question</span>
          <textarea
            required
            rows={3}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about anything covered by approved Ember knowledge…"
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button disabled={submitting} className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
          {submitting ? 'Thinking…' : 'Ask'}
        </button>
      </form>

      {result && (
        <div className="flex flex-col gap-4">
          <div className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Answer</h2>
            {result.answer ? (
              <p className="whitespace-pre-wrap text-sm text-zinc-700">{result.answer}</p>
            ) : (
              <p className="text-sm text-zinc-500">No answer was generated ({result.terminationReason ?? 'unknown reason'}).</p>
            )}
          </div>

          <div className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Evidence</h2>
            {result.evidence.length ? (
              <ol className="flex flex-col gap-1 text-sm text-zinc-700">
                {result.evidence.map((item) => (
                  <li key={`${item.type}-${item.id}`}>
                    {item.rank}. [{item.type}] {item.title} <span className="text-zinc-400">({item.similarity.toFixed(3)})</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-zinc-500">No evidence retrieved.</p>
            )}
          </div>

          {result.evaluation && (
            <div className="rounded border border-zinc-200 bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Evaluation</h2>
              <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                <div>Generation: {result.evaluation.generation?.toFixed(2) ?? '—'}</div>
                <div>Grounding: {result.evaluation.grounding?.toFixed(2) ?? '—'}</div>
                <div>Outcome: {result.evaluation.outcome?.toFixed(2) ?? '—'}</div>
                <div>Terminated: {result.terminationReason ?? '—'}</div>
              </div>
            </div>
          )}

          <div className="rounded border border-zinc-200 bg-white p-4">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Trace</h2>
            <ol className="flex flex-col gap-2">
              {result.steps.map((step) => (
                <li
                  key={step.id}
                  className={`rounded border px-3 py-2 text-sm ${step.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-zinc-100'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">
                      {step.sequence_number}. {step.node_name}{' '}
                      <span className="font-normal text-zinc-400">(iteration {step.iteration})</span>
                    </span>
                    <span className="text-xs text-zinc-500">{step.latency_ms !== null ? `${step.latency_ms}ms` : '—'}</span>
                  </div>
                  {step.status === 'failed' && (
                    <p className="mt-1 text-xs text-red-700">
                      {step.error_code}: {step.error_message}
                    </p>
                  )}
                </li>
              ))}
              {result.steps.length === 0 && <li className="text-sm text-zinc-500">No steps recorded.</li>}
            </ol>
          </div>
        </div>
      )}
    </div>
  )
}
