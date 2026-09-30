'use client'

import { useRef, useState } from 'react'
import { buildProjectSummaryMarkdown, type ProjectSummaryInput } from '@/lib/projects/status-summary'
import { Markdown } from '@/components/shared/Markdown'

function slugForFilename(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

// The project page's status summary, opened from the page header next to
// the Ontology Map and built the same way: a native <dialog> (showModal),
// with a download for sharing outside Ember. The Markdown is built when the
// dialog opens, stamped in the viewer's own timezone, so a downloaded copy
// is obviously a point-in-time snapshot.
export function ProjectSummaryButton({ summary }: { summary: ProjectSummaryInput }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  function open() {
    const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    setMarkdown(buildProjectSummaryMarkdown(summary, when))
    dialogRef.current?.showModal()
  }

  function close() {
    dialogRef.current?.close()
  }

  async function handleCopy() {
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission can be denied; Download .md is the fallback.
    }
  }

  function handleDownload() {
    if (!markdown) return
    const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${slugForFilename(summary.name)}-summary-${date}.md`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        Project summary
      </button>
      <dialog
        ref={dialogRef}
        id="project-summary"
        aria-labelledby="project-summary-title"
        onClick={(e) => {
          // A click on the backdrop lands on the <dialog> element itself.
          if (e.target === dialogRef.current) close()
        }}
        onClose={close}
        className="m-auto w-[min(96vw,900px)] max-h-[90vh] rounded-lg bg-zinc-50 p-0 backdrop:bg-black/40"
      >
        <div className="flex max-h-[90vh] flex-col gap-3 p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="project-summary-title" className="text-base font-semibold">
                Project summary
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">
                Where this project stands right now -- workstreams, deliverables, artifacts, knowledge, governance and open notes.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleCopy}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button
                type="button"
                onClick={handleDownload}
                className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
              >
                Download .md
              </button>
              <button
                type="button"
                onClick={close}
                aria-label="Close project summary"
                className="rounded px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-200"
              >
                ×
              </button>
            </div>
          </div>
          <div className="min-h-0 overflow-auto rounded border border-zinc-200 bg-white p-4">{markdown && <Markdown text={markdown} />}</div>
        </div>
      </dialog>
    </>
  )
}
