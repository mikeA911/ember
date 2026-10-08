'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { WorkstreamArtifactStatus } from '@/types/database'

type Filter = 'all' | 'ready_for_review' | 'approved'

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All',
  ready_for_review: 'Awaiting review',
  approved: 'Approved',
}

// Filters only once the list is long enough to need them.
const MIN_ARTIFACTS_FOR_FILTERS = 4

// The workstream page renders each artifact server-side (Markdown, review
// actions) and hands them in as nodes; this only decides which are shown.
export function WorkstreamArtifactList({ items }: { items: { id: string; status: WorkstreamArtifactStatus; node: ReactNode }[] }) {
  const [filter, setFilter] = useState<Filter>('all')
  const countFor = (f: Filter) => (f === 'all' ? items.length : items.filter((i) => i.status === f).length)
  const showFilters = items.length >= MIN_ARTIFACTS_FOR_FILTERS
  const visible = filter === 'all' || !showFilters ? items : items.filter((i) => i.status === filter)

  // A link to one artifact (#<artifact id>, e.g. Ember's Documents "Open →")
  // lands on a collapsed row, possibly hidden by a filter. Show it, open it
  // and bring it into view. Held until the artifact is actually listed: one
  // Ember just created only appears once the page's refresh comes back.
  const pendingRevealRef = useRef<string | null>(null)
  const checkedInitialHashRef = useRef(false)
  const itemIds = items.map((i) => i.id).join(',')
  useEffect(() => {
    function reveal() {
      const id = pendingRevealRef.current
      const el = id ? document.getElementById(id) : null
      if (!(el instanceof HTMLDetailsElement)) return
      pendingRevealRef.current = null
      el.open = true
      el.scrollIntoView({ block: 'start' })
    }
    function onHash(url: string) {
      const id = decodeURIComponent(new URL(url).hash.slice(1))
      if (!id || !itemIds.split(',').includes(id)) {
        // Not (yet) listed -- remember it for when a refresh adds it.
        if (id) pendingRevealRef.current = id
        return
      }
      pendingRevealRef.current = id
      setFilter('all')
      // After the filter change has rendered the row.
      requestAnimationFrame(reveal)
    }
    // The page's own #fragment only on first load -- not again on every
    // later list change (an approval re-sorting it) while it's still there.
    if (pendingRevealRef.current) onHash(`${window.location.origin}/#${pendingRevealRef.current}`)
    else if (!checkedInitialHashRef.current) onHash(window.location.href)
    checkedInitialHashRef.current = true
    const onHashChange = (e: HashChangeEvent) => onHash(e.newURL || window.location.href)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [itemIds])

  return (
    <div className="flex flex-col gap-3">
      {showFilters && (
        <div role="group" aria-label="Filter artifacts" className="flex flex-wrap gap-1.5">
          {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              aria-pressed={filter === f}
              className={`rounded-full border px-2.5 py-0.5 text-xs ${
                filter === f ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-300 text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {FILTER_LABELS[f]} ({countFor(f)})
            </button>
          ))}
        </div>
      )}
      {visible.map((i) => (
        <div key={i.id}>{i.node}</div>
      ))}
      {showFilters && visible.length === 0 && <p className="text-sm text-zinc-500">No artifacts match this filter.</p>}
    </div>
  )
}
