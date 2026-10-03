'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

export interface WorkstreamsDropdownItem {
  id: string
  name: string
  status: string
  deliverablesCompleted: number
  deliverablesTotal: number
  artifactsTotal: number
  artifactsAwaitingReview: number
}

// The project page's Workstreams list, moved from the bottom of the page into
// a header menu so it's reachable without scrolling. Same open/close
// behaviour as NavDropdown (outside click and Escape close it).
export function WorkstreamsDropdown({
  projectId,
  workstreams,
  canCreate,
}: {
  projectId: string
  workstreams: WorkstreamsDropdownItem[]
  canCreate: boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('click', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('click', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  const awaitingReview = workstreams.reduce((sum, w) => sum + w.artifactsAwaitingReview, 0)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1 whitespace-nowrap rounded border border-zinc-200 bg-white px-2 py-1 text-sm hover:bg-zinc-50"
      >
        Workstreams ({workstreams.length})
        {awaitingReview > 0 && (
          <span className="rounded-full bg-amber-100 px-1.5 text-xs font-medium text-amber-800">{awaitingReview} to review</span>
        )}
        <span aria-hidden className="text-xs">▾</span>
      </button>
      {open && (
        <div className="absolute left-0 top-full sm:left-auto sm:right-0 z-20 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded border border-zinc-200 bg-white py-1 shadow-md">
          {workstreams.length > 0 ? (
            <ul className="max-h-96 overflow-y-auto">
              {workstreams.map((w) => (
                <li key={w.id}>
                  <Link
                    href={`/projects/${projectId}/workstreams/${w.id}`}
                    onClick={() => setOpen(false)}
                    className="block px-3 py-1.5 text-sm hover:bg-zinc-50"
                  >
                    <span className="font-medium text-zinc-900">{w.name}</span>
                    <span className="block text-xs text-zinc-500">
                      {w.status} · {w.deliverablesCompleted}/{w.deliverablesTotal} deliverables
                      {w.artifactsTotal > 0 && ` · ${w.artifactsTotal} ${w.artifactsTotal === 1 ? 'artifact' : 'artifacts'}`}
                      {w.artifactsAwaitingReview > 0 && (
                        <span className="font-medium text-amber-700"> ({w.artifactsAwaitingReview} to review)</span>
                      )}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-1.5 text-sm text-zinc-500">No workstreams defined yet.</p>
          )}
          {canCreate && (
            <div className="mt-1 border-t border-zinc-100 pt-1">
              <Link
                href={`/projects/${projectId}/workstreams/new`}
                onClick={() => setOpen(false)}
                className="block px-3 py-1.5 text-sm font-medium text-zinc-900 hover:bg-zinc-50"
              >
                + New Workstream
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
