'use client'

import { useId, useRef, useState } from 'react'
import { Markdown } from '@/components/shared/Markdown'

function slugForFilename(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'summary'
  )
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

// A summary Ember writes as Markdown, opened from a page header like the
// Ontology Map: a native <dialog> (showModal) with copy and download. The
// Markdown is built when the dialog opens, stamped in the viewer's own
// timezone, so a downloaded copy is obviously a point-in-time snapshot.
// Shared by the Project summary and the workstream Proposal summary.
export function SummaryDialogButton({
  buttonLabel,
  title,
  description,
  filenameBase,
  filenameSuffix,
  build,
  wordDownload = false,
}: {
  buttonLabel: string
  title: string
  description: string
  filenameBase: string
  filenameSuffix: string
  build: (generatedAt: string) => string
  wordDownload?: boolean
}) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [markdown, setMarkdown] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [wordError, setWordError] = useState<string | null>(null)

  function open() {
    const when = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
    setMarkdown(build(when))
    setWordError(null)
    dialogRef.current?.showModal()
  }

  function close() {
    dialogRef.current?.close()
  }

  function filename(ext: string) {
    const date = new Date().toLocaleDateString('en-CA') // YYYY-MM-DD
    return `${slugForFilename(filenameBase)}-${filenameSuffix}-${date}.${ext}`
  }

  async function handleCopy() {
    if (!markdown) return
    try {
      await navigator.clipboard.writeText(markdown)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard permission can be denied; Download is the fallback.
    }
  }

  function handleDownload() {
    if (!markdown) return
    downloadBlob(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }), filename('md'))
  }

  async function handleWordDownload() {
    if (!markdown) return
    try {
      // Loaded on demand -- docx is only needed for this one click.
      const { markdownToDocxBlob } = await import('@/lib/projects/markdown-docx')
      downloadBlob(await markdownToDocxBlob(markdown), filename('docx'))
    } catch (err) {
      setWordError(err instanceof Error ? err.message : 'Could not build the Word file')
    }
  }

  const actionClass = 'rounded border border-zinc-200 bg-white px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50'

  return (
    <>
      <button
        type="button"
        onClick={open}
        className="rounded border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50"
      >
        {buttonLabel}
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
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
              <h2 id={titleId} className="text-base font-semibold">
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" onClick={handleCopy} className={actionClass}>
                {copied ? 'Copied!' : 'Copy'}
              </button>
              <button type="button" onClick={handleDownload} className={actionClass}>
                Download .md
              </button>
              {wordDownload && (
                <button type="button" onClick={handleWordDownload} className={actionClass}>
                  Download Word
                </button>
              )}
              <button
                type="button"
                onClick={close}
                aria-label={`Close ${title.toLowerCase()}`}
                className="rounded px-2 py-1 text-lg leading-none text-zinc-500 hover:bg-zinc-200"
              >
                ×
              </button>
            </div>
          </div>
          {wordError && <p className="text-xs text-red-600">{wordError}</p>}
          <div className="min-h-0 overflow-auto rounded border border-zinc-200 bg-white p-4">{markdown && <Markdown text={markdown} />}</div>
        </div>
      </dialog>
    </>
  )
}
