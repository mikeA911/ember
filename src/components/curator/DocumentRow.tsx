'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import type { Document } from '@/types/database'
import type { SourceReviewCounts } from '@/lib/projects/queries'
import { documentRowStatus } from '@/lib/curator/document-status'
import { deleteDocumentAction } from '@/app/actions/curator'

export function DocumentRow({ document, counts }: { document: Document; counts: SourceReviewCounts | undefined }) {
  const status = documentRowStatus(document, counts)
  const [isPending, startTransition] = useTransition()
  const [deleted, setDeleted] = useState(false)

  if (deleted) return null

  function handleDelete() {
    if (!confirm(`Delete "${document.original_filename}"? This cannot be undone.`)) return
    startTransition(async () => {
      await deleteDocumentAction(document.id)
      setDeleted(true)
    })
  }

  return (
    <tr className="border-b border-zinc-100 last:border-0">
      <td className="px-4 py-3">
        {(counts?.total ?? 0) > 0 ? (
          <Link href={`/review/${document.id}`} className="font-medium underline">
            {document.original_filename}
          </Link>
        ) : (
          <span className="font-medium">{document.original_filename}</span>
        )}
        {document.processing_status === 'failed' && document.processing_error && (
          <p className="mt-1 text-xs text-red-600">
            {document.processing_error.stage}: {document.processing_error.message}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-zinc-600">{document.doc_type}</td>
      <td className="px-4 py-3">
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${status.className}`}>{status.label}</span>
        {status.note && <p className="mt-1 text-xs text-zinc-500">{status.note}</p>}
      </td>
      <td className="px-4 py-3 text-zinc-600">
        {counts && counts.total > 0 ? (
          <>
            {counts.approved}/{counts.total} approved
            {counts.rejected > 0 && <span className="text-zinc-400"> · {counts.rejected} rejected</span>}
          </>
        ) : (
          '—'
        )}
      </td>
      <td className="px-4 py-3 text-right">
        <button
          onClick={handleDelete}
          disabled={isPending}
          className="text-sm text-red-600 underline disabled:opacity-50"
        >
          {isPending ? 'Deleting…' : 'Delete'}
        </button>
      </td>
    </tr>
  )
}
