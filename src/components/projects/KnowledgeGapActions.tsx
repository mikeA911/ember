'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  triageKnowledgeGapAction,
  resolveKnowledgeGapAction,
  promoteKnowledgeGapAction,
  convertKnowledgeGapToFeedbackAction,
} from '@/app/actions/knowledge-gaps'
import type { KnowledgeGapStatus } from '@/types/database'

type Mode = null | 'triage' | 'resolve'

// A Project curator's actions on one knowledge gap (Ember Readiness,
// Stage 3): triage it, resolve it by linking what now covers it, turn it
// into a draft test question, or move it to the platform feedback board if
// it is a problem with Ember itself rather than a missing source.
export function KnowledgeGapActions({
  gapId,
  isOpen,
  canPromote,
  evalCaseDatasetId,
  sources,
  articles,
  otherGaps,
}: {
  gapId: string
  isOpen: boolean
  canPromote: boolean
  // Set once promoted: the dataset holding the test question.
  evalCaseDatasetId: string | null
  sources: { id: string; title: string }[]
  articles: { id: string; title: string }[]
  // Other gaps in this Project, for "duplicate of".
  otherGaps: { id: string; question: string }[]
}) {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const [triageStatus, setTriageStatus] = useState<KnowledgeGapStatus>('needs_source')
  const [triageNote, setTriageNote] = useState('')
  const [duplicateOf, setDuplicateOf] = useState('')

  const [sourceId, setSourceId] = useState('')
  const [articleId, setArticleId] = useState('')
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState<'yes' | 'no' | 'unchecked'>('unchecked')

  function run<T extends { error?: string }>(action: () => Promise<T>, onSuccess?: (result: T) => void) {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setError(result.error)
        return
      }
      onSuccess?.(result)
      setMode(null)
      router.refresh()
    })
  }

  return (
    <div className="flex flex-col gap-2 text-xs">
      <div className="flex flex-wrap gap-3">
        {isOpen && (
          <>
            <button type="button" onClick={() => setMode(mode === 'triage' ? null : 'triage')} className="text-blue-700 underline">
              Triage
            </button>
            <button type="button" onClick={() => setMode(mode === 'resolve' ? null : 'resolve')} className="text-blue-700 underline">
              Resolve
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (!confirm('Move this to the platform feedback board as a problem with Ember itself, and close it here?')) return
                run(
                  () => convertKnowledgeGapToFeedbackAction(gapId),
                  (result) => setMessage(`Filed as feedback FB-${result.reportNumber}.`)
                )
              }}
              className="text-blue-700 underline disabled:opacity-50"
            >
              It&rsquo;s an Ember problem
            </button>
          </>
        )}
        {canPromote && (
          <button type="button" disabled={isPending} onClick={() => run(() => promoteKnowledgeGapAction(gapId))} className="text-blue-700 underline disabled:opacity-50">
            Make it a test question
          </button>
        )}
        {evalCaseDatasetId && (
          <Link href={`/evals/datasets/${evalCaseDatasetId}`} className="text-zinc-600 underline">
            Test question added
          </Link>
        )}
      </div>

      {mode === 'triage' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() => triageKnowledgeGapAction(gapId, { status: triageStatus, note: triageNote, duplicateOf: duplicateOf || null }))
          }}
          className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
        >
          <select value={triageStatus} onChange={(e) => setTriageStatus(e.target.value as KnowledgeGapStatus)} className="rounded border border-zinc-300 px-2 py-1">
            <option value="needs_source">Needs a source</option>
            <option value="wiki_needed">Needs a Wiki article</option>
            <option value="out_of_scope">Out of scope for this Project (closes it)</option>
            <option value="duplicate">Duplicate of another gap (closes it)</option>
          </select>
          {triageStatus === 'duplicate' && (
            <select required value={duplicateOf} onChange={(e) => setDuplicateOf(e.target.value)} className="rounded border border-zinc-300 px-2 py-1">
              <option value="">Duplicate of…</option>
              {otherGaps.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.question.slice(0, 90)}
                </option>
              ))}
            </select>
          )}
          <input value={triageNote} onChange={(e) => setTriageNote(e.target.value)} maxLength={4000} placeholder="Note (optional)" className="rounded border border-zinc-300 px-2 py-1" />
          <button disabled={isPending} className="self-start rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50">
            Save
          </button>
        </form>
      )}

      {mode === 'resolve' && (
        <form
          onSubmit={(e) => {
            e.preventDefault()
            run(() =>
              resolveKnowledgeGapAction(gapId, {
                resolvingSourceId: sourceId || null,
                resolvingArticleId: articleId || null,
                note,
                verifiedAnswers: verified === 'unchecked' ? null : verified === 'yes',
              })
            )
          }}
          className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-2"
        >
          <p className="text-zinc-600">Link what now covers this question. Add or approve the source first if it isn&rsquo;t listed.</p>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="rounded border border-zinc-300 px-2 py-1">
            <option value="">Source (optional)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </select>
          <select value={articleId} onChange={(e) => setArticleId(e.target.value)} className="rounded border border-zinc-300 px-2 py-1">
            <option value="">Wiki article (optional)</option>
            {articles.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
          <textarea
            rows={2}
            maxLength={4000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How it was resolved, or the correct answer (used as the test question's expected answer if none was reported)"
            className="rounded border border-zinc-300 px-2 py-1"
          />
          <fieldset className="flex flex-wrap gap-3">
            <legend className="mb-1 text-zinc-600">I re-asked Ember the question:</legend>
            {(
              [
                ['yes', 'It now answers correctly'],
                ['no', 'It still doesn’t'],
                ['unchecked', 'Not checked yet'],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-1">
                <input type="radio" name={`verified-${gapId}`} checked={verified === value} onChange={() => setVerified(value)} />
                {label}
              </label>
            ))}
          </fieldset>
          <button disabled={isPending} className="self-start rounded bg-zinc-900 px-2 py-1 font-medium text-white disabled:opacity-50">
            Mark resolved
          </button>
        </form>
      )}

      {error && <p className="text-red-600">{error}</p>}
      {message && <p className="text-green-700">{message}</p>}
    </div>
  )
}
