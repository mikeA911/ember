'use client'

import { useTransition } from 'react'
import type { Document } from '@/types/database'
import { approveDocument } from '@/app/actions/admin'

export function PendingApprovals({ documents }: { documents: Document[] }) {
  const [isPending, startTransition] = useTransition()

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Optional document sign-off</h2>
      <p className="text-xs text-zinc-500">
        These documents&apos; approved chunks are already searchable. Signing off only marks a document as finally checked -- nothing
        waits on it.
      </p>
      {documents.length === 0 ? (
        <p className="text-sm text-zinc-500">Nothing waiting.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {documents.map((doc) => (
            <li key={doc.id} className="flex items-center justify-between rounded border border-zinc-200 bg-white px-4 py-2 text-sm">
              <span>{doc.original_filename} <span className="text-zinc-500">({doc.doc_type})</span></span>
              <button
                disabled={isPending}
                onClick={() => startTransition(() => approveDocument(doc.id))}
                className="rounded bg-zinc-900 px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
              >
                Approve
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
