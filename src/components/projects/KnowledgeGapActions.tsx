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

export interface ResolutionSource {
  id: string
  title: string
  // The workstream whose knowledge base holds it; null for the Project's own.
  context: string | null
  // Has at least one approved chunk, so Ember can actually retrieve it.
  searchable: boolean
}

// A Project curator's actions on one knowledge gap (Ember Readiness,
// Stage 3): triage it, resolve it by linking what now covers it, turn it
// into a draft test question, or move it to the platform feedback board if
// it is a problem with Ember itself rather than a missing source.
export function KnowledgeGapActions({
  gapId,
  isOpen,
  canPromote,
  evalCaseDatasetId,
  projectId,
  sources,
  submittableArtifacts,
  articles,
  otherGaps,
}: {
  gapId: string
  isOpen: boolean
  canPromote: boolean
  // Set once promoted: the dataset holding the test question.
  evalCaseDatasetId: string | null
  projectId: string
  sources: ResolutionSource[]
  submittableArtifacts: { id: string; title: string }[]
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
  const [artifactId, setArtifactId] = useState('')
  const [articleId, setArticleId] = useState('')
  const [note, setNote] = useState('')
  const [verified, setVerified] = useState<'yes' | 'no' | 'unchecked'>('unchecked')

  const selectedSource = sources.find((src) => src.id === sourceId)

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
          <p className="text-zinc-600">Link what now covers this question: a source in this Project&rsquo;s or one of its workstreams&rsquo; knowledge bases, or a Wiki article attached to the Project.</p>
          <select value={sourceId} onChange={(e) => setSourceId(e.target.value)} className="rounded border border-zinc-300 px-2 py-1">
            <option value="">Source (optional)</option>
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
                {s.context ? ` — ${s.context}` : ''}
                {s.searchable ? '' : ' (not searchable yet)'}
              </option>
            ))}
          </select>
          {selectedSource && !selectedSource.searchable && (
            <p className="text-amber-800">
              Ember can&rsquo;t search this source until its chunks are approved, so it won&rsquo;t answer the question yet. A platform curator or
              admin approves them from the source&rsquo;s Review link; you can resolve now and re-check later.
            </p>
          )}
          <details className="rounded border border-zinc-200 bg-white p-2">
            <summary className="cursor-pointer text-zinc-700">The source isn&rsquo;t listed?</summary>
            <ol className="mt-1 list-decimal space-y-0.5 pl-4 text-zinc-600">
              <li>
                Submit it as a candidate source on the Project page, or submit an approved workstream artifact (a research dossier, findings, test
                results…):
                {submittableArtifacts.length > 0 ? (
                  <span className="mt-1 flex flex-wrap items-center gap-2">
                    <select value={artifactId} onChange={(e) => setArtifactId(e.target.value)} className="rounded border border-zinc-300 px-2 py-0.5">
                      <option value="">Choose an approved artifact…</option>
                      {submittableArtifacts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.title}
                        </option>
                      ))}
                    </select>
                    <a
                      href={artifactId ? `/projects/${projectId}?submitArtifact=${artifactId}#submit-source` : `/projects/${projectId}#submit-source`}
                      className="text-blue-700 underline"
                    >
                      Submit as a source
                    </a>
                  </span>
                ) : (
                  <>
                    {' '}
                    <a href={`/projects/${projectId}#submit-source`} className="text-blue-700 underline">
                      Submit a source
                    </a>
                  </>
                )}
              </li>
              <li>Approve the submission under Knowledge on the Project page.</li>
              <li>A platform curator or admin approves its chunks (Review, next to the source) so Ember can search it.</li>
              <li>Come back here, link it and mark the gap resolved.</li>
            </ol>
          </details>
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
