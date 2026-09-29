'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Document, KnowledgeBase } from '@/types/database'
import { deleteKnowledgeBase, approveKnowledgeBaseAction, rejectKnowledgeBaseAction } from '@/app/actions/admin'
import { deleteDocumentAction } from '@/app/actions/curator'

const DOC_STATUS_STYLES: Record<Document['processing_status'], string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  parsing: 'bg-blue-100 text-blue-700',
  chunking: 'bg-blue-100 text-blue-700',
  review: 'bg-amber-100 text-amber-800',
  submitted: 'bg-purple-100 text-purple-800',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
}

function SourceRow({ document }: { document: Document }) {
  const [isPending, startTransition] = useTransition()
  const [deleted, setDeleted] = useState(false)

  if (deleted) return null

  function handleDelete() {
    if (!confirm(`Remove "${document.original_filename}" from this knowledge base? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteDocumentAction(document.id)
      setDeleted(true)
    })
  }

  return (
    <li className="flex items-center justify-between gap-3 border-b border-zinc-100 px-3 py-2 text-xs last:border-0">
      <span className="flex flex-wrap items-center gap-2">
        {document.processing_status === 'review' ? (
          <Link href={`/review/${document.id}`} className="underline">
            {document.original_filename}
          </Link>
        ) : (
          <span>{document.original_filename}</span>
        )}
        <span className={`rounded-full px-1.5 py-0.5 ${DOC_STATUS_STYLES[document.processing_status]}`}>
          {document.processing_status}
        </span>
        <span className="text-zinc-400">{document.approved_chunks}/{document.total_chunks ?? '—'} approved</span>
      </span>
      <button
        onClick={handleDelete}
        disabled={isPending}
        className="shrink-0 text-red-600 underline disabled:opacity-50"
      >
        {isPending ? 'Removing…' : 'Remove'}
      </button>
    </li>
  )
}

// Creation moved off this page and into the /upload flow (curators create,
// admins review) -- per Mike, 2026-08-28. This page's remaining job is
// review (Pending) and cleanup (Delete), not creation.
export function KBManagement({ knowledgeBases, documents }: { knowledgeBases: KnowledgeBase[]; documents: Document[] }) {
  const [isPending, startTransition] = useTransition()
  const pendingReview = knowledgeBases.filter((kb) => kb.status === 'pending')
  const active = knowledgeBases.filter(
    (kb) => kb.status !== 'pending' && kb.lifecycle_status !== 'reference' && kb.lifecycle_status !== 'archived'
  )
  const legacy = knowledgeBases.filter((kb) => kb.lifecycle_status === 'reference' || kb.lifecycle_status === 'archived')

  function renderKnowledgeBase(kb: KnowledgeBase, allowDelete: boolean) {
    const sources = documents.filter((d) => d.doc_type === kb.id)
    return (
      <li key={kb.id} className="flex flex-col gap-2 rounded border border-zinc-200 bg-white px-4 py-3 text-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{kb.name}</span>
              <span className="text-zinc-500">({kb.id})</span>
              {kb.classification && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{kb.classification}</span>}
              {kb.lifecycle_status && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600">{kb.lifecycle_status}</span>}
              {kb.status !== 'approved' && (
                <span
                  className={`rounded px-1.5 py-0.5 text-xs ${kb.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}
                >
                  {kb.status}
                </span>
              )}
            </div>
            {kb.description && <p className="mt-1 text-xs text-zinc-500">{kb.description}</p>}
            {kb.origin && <p className="mt-1 text-xs text-zinc-400">Origin: {kb.origin}</p>}
          </div>
          {allowDelete && (
            <button
              disabled={isPending}
              onClick={() => startTransition(() => deleteKnowledgeBase(kb.id))}
              className="shrink-0 text-xs text-red-600 underline disabled:opacity-50"
            >
              Delete
            </button>
          )}
        </div>
        {sources.length > 0 && (
          <details className="rounded border border-zinc-100">
            <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-zinc-600">
              Sources ({sources.length})
            </summary>
            <ul className="border-t border-zinc-100">
              {sources.map((doc) => (
                <SourceRow key={doc.id} document={doc} />
              ))}
            </ul>
          </details>
        )}
      </li>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge bases</h2>

      {pendingReview.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Pending review</h3>
          <p className="text-xs text-zinc-500">
            Already usable: curators can attach these to projects and add sources while they wait. Approving confirms them;
            rejecting stops new attachments.
          </p>
          <ul className="flex flex-col gap-2">
            {pendingReview.map((kb) => (
              <li key={kb.id} className="flex items-start justify-between gap-3 rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{kb.name}</span>
                    <span className="text-zinc-500">({kb.id})</span>
                  </div>
                  {kb.description && <p className="mt-1 text-xs text-zinc-500">{kb.description}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    disabled={isPending}
                    onClick={() => startTransition(() => approveKnowledgeBaseAction(kb.id))}
                    className="rounded-full border border-green-300 bg-green-50 px-2 py-0.5 text-xs font-medium text-green-800 disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    disabled={isPending}
                    onClick={() => startTransition(() => rejectKnowledgeBaseAction(kb.id))}
                    className="rounded-full border border-red-300 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800 disabled:opacity-50"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <h3 className="text-sm font-medium">Active knowledge bases</h3>
      <ul className="flex flex-col gap-2">{active.map((kb) => renderKnowledgeBase(kb, true))}</ul>
      {legacy.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          <h3 className="text-sm font-medium">Legacy knowledge bases</h3>
          <p className="text-xs text-zinc-500">Retained for historical reference. They are unavailable for new uploads, projects, queues, or assignments.</p>
          <ul className="flex flex-col gap-2">{legacy.map((kb) => renderKnowledgeBase(kb, false))}</ul>
        </div>
      )}
    </section>
  )
}
