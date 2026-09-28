'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { Document, DocumentChunk } from '@/types/database'
import {
  approveChunkAction,
  approveRemainingChunksAction,
  rejectChunkAction,
  saveChunkDraftAction,
  submitDocumentAction,
  enrichMoreChunks,
} from '@/app/actions/curator'
import { HelpTip } from '@/components/shared/HelpTip'

// Plain-language status per chunk -- the raw review_status values ("pending",
// "filtered", ...) don't say whether the chunk is searchable, which is the
// thing a reviewer actually needs to know.
const STATUS: Record<DocumentChunk['review_status'], { label: string; style: string }> = {
  pending: { label: 'Not reviewed yet', style: 'bg-zinc-100 text-zinc-700' },
  draft: { label: 'Note saved -- not decided yet', style: 'bg-amber-100 text-amber-800' },
  enriching: { label: 'Generating metadata…', style: 'bg-blue-100 text-blue-700' },
  failed: { label: 'Not reviewed yet (metadata failed)', style: 'bg-zinc-100 text-zinc-700' },
  approved: { label: 'Approved -- searchable', style: 'bg-green-100 text-green-800' },
  rejected: { label: 'Rejected -- not searchable', style: 'bg-red-100 text-red-800' },
  filtered: { label: 'Filtered out automatically', style: 'bg-zinc-200 text-zinc-600' },
}

const isDecided = (c: DocumentChunk) => c.review_status === 'approved' || c.review_status === 'rejected'

// Chunk review. A document is split into chunks (sections); each chunk is
// approved or rejected on its own, and an approved chunk is embedded and
// searchable immediately. "Approve all remaining" covers the common case of
// accepting the rest in one go; the admin sign-off at the end is optional and
// doesn't affect search.
export function ChunkReviewer({
  document,
  chunks,
  sourceRestricted,
}: {
  document: Document
  chunks: DocumentChunk[]
  sourceRestricted: boolean
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [notes, setNotes] = useState('')
  const [isPending, startTransition] = useTransition()
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // A one-time heads-up on page load, not a gate on every Approve click --
  // the real enforcement is at Wiki-synthesis-input time (see
  // src/app/actions/wiki.ts), and a confirm() per chunk would be pure
  // friction for a document with dozens of chunks without adding any real
  // protection.
  useEffect(() => {
    if (sourceRestricted) {
      window.alert(
        "This document's source is classified as restricted. Approved chunks remain part of that restricted source and stay excluded from Wiki-synthesis input."
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const visible = chunks.filter((c) => !c.is_filtered)
  const chunk = visible[Math.min(index, Math.max(visible.length - 1, 0))]
  const approvedCount = visible.filter((c) => c.review_status === 'approved').length
  const rejectedCount = visible.filter((c) => c.review_status === 'rejected').length
  const remainingCount = visible.length - approvedCount - rejectedCount
  const allDecided = visible.length > 0 && remainingCount === 0

  // Runs a review action; on success optionally jumps to the next chunk still
  // waiting for a decision, so reviewing is a straight run through the
  // document rather than re-landing on the chunk just decided.
  function run(
    action: () => Promise<{ ok: boolean; error?: string }>,
    opts: { busy?: string; advance?: boolean; done?: (result: { ok: boolean; error?: string }) => string | null } = {}
  ) {
    setError(null)
    setNotice(null)
    setBusyMessage(opts.busy ?? null)
    const current = index
    startTransition(async () => {
      try {
        const result = await action()
        if (!result.ok) {
          setError(result.error ?? 'Action failed')
        } else {
          setNotes('')
          if (opts.advance) {
            const next = visible.findIndex((c, i) => i > current && !isDecided(c))
            const firstOpen = visible.findIndex((c, i) => i !== current && !isDecided(c))
            if (next !== -1) setIndex(next)
            else if (firstOpen !== -1) setIndex(firstOpen)
          }
        }
        if (opts.done) setNotice(opts.done(result))
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setBusyMessage(null)
      }
    })
  }

  function approveAllRemaining() {
    const confirmed = window.confirm(
      `Approve all ${remainingCount} remaining chunk${remainingCount === 1 ? '' : 's'}? Each one is embedded and becomes searchable by the Assistant. Chunks you already approved or rejected are left as they are.`
    )
    if (!confirmed) return
    run(() => approveRemainingChunksAction(document.id), {
      busy: `Approving ${remainingCount} chunk${remainingCount === 1 ? '' : 's'} -- embedding each one. This can take a minute; please don't leave the page.`,
      done: (result) => {
        const approved = (result as { approved?: number }).approved ?? 0
        return result.ok ? `Approved ${approved} chunk${approved === 1 ? '' : 's'}.` : approved > 0 ? `Approved ${approved} before the error -- click again to continue.` : null
      },
    })
  }

  if (document.processing_status === 'failed') {
    return (
      <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
        <p className="font-medium">Processing failed at stage: {document.processing_error?.stage}</p>
        <p className="mt-1">{document.processing_error?.message}</p>
      </div>
    )
  }

  if (chunks.length === 0 || !chunk) {
    return <p className="text-zinc-600">No chunks to review yet -- processing may still be in progress.</p>
  }

  const status = STATUS[chunk.review_status]

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold">{document.original_filename}</h1>
        <p className="flex items-center gap-2 text-sm text-zinc-600">
          Reviewed chunk by chunk
          <HelpTip label="How chunk review works">
            This document was split into {visible.length} chunk{visible.length === 1 ? '' : 's'} (sections). You decide on each
            chunk separately: <strong>Approve</strong> makes it searchable by the Assistant right away, <strong>Reject</strong>{' '}
            keeps it out of search. Use <strong>Approve all remaining</strong> to accept every chunk you haven&apos;t decided on
            in one go. You can change a decision later.
          </HelpTip>
        </p>
        <p className="text-sm text-zinc-600">
          <span className="font-medium text-green-800">{approvedCount} approved</span>
          {' · '}
          <span className="font-medium text-red-800">{rejectedCount} rejected</span>
          {' · '}
          <span className="font-medium text-zinc-900">{remainingCount} to review</span>
        </p>
        <div className="h-1.5 w-full rounded-full bg-zinc-200" aria-hidden="true">
          <div className="h-1.5 rounded-full bg-green-600" style={{ width: `${((approvedCount + rejectedCount) / visible.length) * 100}%` }} />
        </div>

        {remainingCount > 0 ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={approveAllRemaining}
              disabled={isPending}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve all remaining ({remainingCount})
            </button>
            <HelpTip label="About Approve all remaining">
              Approves and embeds every chunk that isn&apos;t approved or rejected yet, in order. Use it when you&apos;ve skimmed the
              document and it&apos;s all good to search. To leave a section out, reject that chunk first.
            </HelpTip>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2 rounded border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900">
            <span>
              All chunks reviewed -- {approvedCount} searchable{rejectedCount > 0 ? `, ${rejectedCount} left out` : ''}.
            </span>
            {document.processing_status === 'review' && allDecided && (
              <span className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => run(() => submitDocumentAction(document.id), { done: (r) => (r.ok ? 'Sent to a platform admin for sign-off.' : null) })}
                  disabled={isPending}
                  className="rounded border border-green-700 bg-white px-3 py-1.5 text-xs font-medium text-green-800 disabled:opacity-50"
                >
                  Send to admin for sign-off (optional)
                </button>
                <HelpTip label="About admin sign-off">
                  Optional. Approved chunks are already searchable -- this doesn&apos;t change that. It only marks the whole
                  document as reviewed so a platform admin can give it a final check on the Admin page.
                </HelpTip>
              </span>
            )}
            {document.processing_status === 'submitted' && <span className="ml-auto text-xs">Sent to admin for sign-off.</span>}
          </div>
        )}
      </div>

      {busyMessage && (
        <p role="status" aria-live="polite" className="flex items-center gap-2 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-amber-300 border-t-amber-800" />
          {busyMessage}
        </p>
      )}
      {notice && !busyMessage && <p className="text-sm text-green-800">{notice}</p>}
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-col gap-3 rounded border border-zinc-200 bg-zinc-50 p-4">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0 || isPending}
            className="text-sm underline disabled:opacity-40"
          >
            ← Previous
          </button>
          <div className="flex flex-col items-center gap-1">
            <span className="text-sm font-medium">
              Chunk {Math.min(index, visible.length - 1) + 1} of {visible.length}
              {chunk.source_page ? ` · page ${chunk.source_page}` : ''}
            </span>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.style}`}>{status.label}</span>
          </div>
          <button
            onClick={() => setIndex((i) => Math.min(visible.length - 1, i + 1))}
            disabled={index >= visible.length - 1 || isPending}
            className="text-sm underline disabled:opacity-40"
          >
            Next →
          </button>
        </div>

        <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded border border-zinc-200 bg-white p-4 text-sm">{chunk.chunk_text}</div>

        {chunk.enrichment_error && <p className="text-sm text-red-600">Metadata generation failed: {chunk.enrichment_error.message}</p>}

        {chunk.ai_metadata ? (
          <div className="rounded border border-zinc-200 bg-white p-4 text-sm">
            <p><span className="font-medium">Topic:</span> {chunk.ai_metadata.topic}</p>
            {chunk.ai_metadata.subtopic && <p><span className="font-medium">Subtopic:</span> {chunk.ai_metadata.subtopic}</p>}
            {chunk.ai_metadata.relevance_score !== undefined && (
              <p><span className="font-medium">Relevance:</span> {chunk.ai_metadata.relevance_score}</p>
            )}
            {!!chunk.ai_metadata.key_concepts?.length && (
              <p className="mt-1"><span className="font-medium">Key concepts:</span> {chunk.ai_metadata.key_concepts.join(', ')}</p>
            )}
            {!!chunk.ai_metadata.use_cases?.length && (
              <p className="mt-1"><span className="font-medium">Use cases:</span> {chunk.ai_metadata.use_cases.join(', ')}</p>
            )}
          </div>
        ) : (
          !isDecided(chunk) && (
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  run(() => enrichMoreChunks(document.id, document.doc_type), {
                    busy: 'Asking AI for metadata on up to 10 chunks…',
                  })
                }
                disabled={isPending}
                className="rounded border border-zinc-300 bg-white px-3 py-1.5 text-sm disabled:opacity-50"
              >
                Suggest metadata with AI (optional)
              </button>
              <HelpTip label="About AI metadata">
                Optional. Asks AI for a topic, key concepts and use cases for up to 10 chunks that aren&apos;t reviewed yet, to
                help organise and filter knowledge. You don&apos;t need it to approve a chunk.
              </HelpTip>
            </div>
          )
        )}

        <div>
          <label className="mb-1 flex items-center gap-2 text-sm font-medium" htmlFor="notes">
            Note (optional)
            <HelpTip label="About notes">Saved with your decision on this chunk, for other curators to see.</HelpTip>
          </label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm"
          />
        </div>

        {chunk.review_status === 'approved' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-green-800">This chunk is approved and searchable.</span>
            <button
              onClick={() => run(() => rejectChunkAction(chunk.id, document.id, notes || null), { advance: true })}
              disabled={isPending}
              className="rounded border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 disabled:opacity-50"
            >
              Reject instead (remove from search)
            </button>
          </div>
        ) : chunk.review_status === 'rejected' ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-red-800">This chunk is rejected and not searchable.</span>
            <button
              onClick={() => run(() => approveChunkAction(chunk.id, document.id, notes || null), { advance: true })}
              disabled={isPending}
              className="rounded border border-green-700 px-3 py-1.5 text-xs font-medium text-green-800 disabled:opacity-50"
            >
              Approve instead
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => run(() => approveChunkAction(chunk.id, document.id, notes || null), { advance: true, busy: 'Approving -- embedding this chunk…' })}
              disabled={isPending}
              className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Approve this chunk
            </button>
            <button
              onClick={() => run(() => rejectChunkAction(chunk.id, document.id, notes || null), { advance: true })}
              disabled={isPending}
              className="rounded bg-red-700 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              Reject this chunk
            </button>
            <button
              onClick={() => run(() => saveChunkDraftAction(chunk.id, document.id, notes || null), { done: (r) => (r.ok ? 'Note saved.' : null) })}
              disabled={isPending || !notes.trim()}
              className="rounded border border-zinc-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Save note, decide later
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
