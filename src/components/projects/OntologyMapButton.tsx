'use client'

import { useEffect, useRef } from 'react'
import type { OntologyMapLayout } from '@/lib/projects/ontology-map'
import { OntologyMapDiagram } from './OntologyMapDiagram'

// The project page's Ontology Map, opened on demand from the page header
// instead of taking up a full section further down. A native <dialog>
// (showModal) gives focus trapping, Esc-to-close and a backdrop for free --
// no modal library exists in this codebase. Links to /projects/[id]#ontology-map
// (the Assistant's project ontology tool emits these) open it directly.
export function OntologyMapButton({ layout, projectId, projectName }: { layout: OntologyMapLayout; projectId: string; projectName: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (window.location.hash === '#ontology-map') dialogRef.current?.showModal()
  }, [])

  function close() {
    dialogRef.current?.close()
    if (window.location.hash === '#ontology-map') {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Ontology map
      </button>
      <dialog
        ref={dialogRef}
        id="ontology-map"
        aria-labelledby="ontology-map-title"
        onClick={(e) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (e.target === dialogRef.current) close()
        }}
        onClose={close}
        className="m-auto w-[min(96vw,1200px)] max-h-[90vh] rounded-lg bg-zinc-50 p-0 backdrop:bg-black/40"
      >
        <div className="flex max-h-[90vh] flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="ontology-map-title" className="text-base font-semibold">
                Ontology map
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                This project&apos;s domain objects and workstreams -- their nesting, pipeline order, and which objects each
                workstream reads, writes, or creates.
              </p>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close ontology map"
              className="rounded px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-200"
            >
              ×
            </button>
          </div>
          <div className="min-h-0 overflow-auto">
            <OntologyMapDiagram layout={layout} projectId={projectId} projectName={projectName} />
          </div>
        </div>
      </dialog>
    </>
  )
}
