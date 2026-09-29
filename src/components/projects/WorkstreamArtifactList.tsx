'use client'

import { useState, type ReactNode } from 'react'
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
