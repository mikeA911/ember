'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { KnowledgeBase } from '@/types/database'
import { uploadAndProcessDocument } from '@/app/actions/curator'
import { createKnowledgeBase } from '@/app/actions/admin'
import { HelpTip } from '@/components/wiki/HelpTip'
import { BusyOverlay } from '@/components/shared/BusyOverlay'

const ALLOWED_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]
const MAX_SIZE = 50 * 1024 * 1024
const NEW_KB_OPTION = '__new__'

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kb'
  )
}

export function DocumentUploader({
  knowledgeBases,
  defaultKb,
  defaultSourceUrl,
}: {
  knowledgeBases: KnowledgeBase[]
  defaultKb?: string
  defaultSourceUrl?: string
}) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [docType, setDocType] = useState(defaultKb ?? knowledgeBases[0]?.id ?? '')
  const [sourceUrl, setSourceUrl] = useState(defaultSourceUrl ?? '')
  const [newKbName, setNewKbName] = useState('')
  const [newKbDescription, setNewKbDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [stage, setStage] = useState<string | null>(null)

  function validateFile(f: File): string | null {
    if (f.size > MAX_SIZE) return 'File exceeds 50MB limit'
    if (!ALLOWED_TYPES.includes(f.type)) return 'Unsupported file type (pdf, docx, txt only)'
    return null
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!file) {
      setError('Please choose a file')
      return
    }
    const validationError = validateFile(file)
    if (validationError) {
      setError(validationError)
      return
    }
    if (!docType) {
      setError('Please select a knowledge base')
      return
    }
    if (docType === NEW_KB_OPTION && !newKbName.trim()) {
      setError('Please name the new knowledge base')
      return
    }

    setSubmitting(true)
    try {
      let targetKbId = docType
      if (docType === NEW_KB_OPTION) {
        setStage('Creating knowledge base…')
        const baseId = slugify(newKbName)
        try {
          await createKnowledgeBase(baseId, newKbName.trim(), newKbDescription.trim())
          targetKbId = baseId
        } catch (err) {
          // Postgres unique_violation on the id -- retry once with a short
          // disambiguating suffix rather than pre-checking for a clash.
          if (err && typeof err === 'object' && 'code' in err && err.code === '23505') {
            targetKbId = `${baseId}-${Date.now().toString(36).slice(-4)}`
            await createKnowledgeBase(targetKbId, newKbName.trim(), newKbDescription.trim())
          } else {
            throw err
          }
        }
      }

      setStage('Uploading and parsing…')
      const formData = new FormData()
      formData.set('file', file)
      formData.set('docType', targetKbId)
      if (sourceUrl) formData.set('sourceUrl', sourceUrl)

      const result = await uploadAndProcessDocument(formData)
      router.push(`/review/${result.documentId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed')
      setSubmitting(false)
      setStage(null)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {/* Stays up through router.push to the review page on success. */}
      <BusyOverlay active={submitting} message={stage ?? 'Processing…'} />
      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="kb">Knowledge base</label>
        <select
          id="kb"
          value={docType}
          onChange={(e) => setDocType(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        >
          {knowledgeBases.map((kb) => (
            <option key={kb.id} value={kb.id}>
              {kb.name}
              {kb.status === 'pending' ? ' (pending review)' : ''}
            </option>
          ))}
          <option value={NEW_KB_OPTION}>+ Create a new knowledge base</option>
        </select>
        {docType === NEW_KB_OPTION && (
          <div className="mt-2 flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3">
            <p className="text-xs text-zinc-500">
              New knowledge bases start as pending until an admin reviews them -- you can still upload into it right away.
            </p>
            <input
              placeholder="Name"
              value={newKbName}
              onChange={(e) => setNewKbName(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Description (optional)"
              value={newKbDescription}
              onChange={(e) => setNewKbDescription(e.target.value)}
              className="w-full rounded border border-zinc-300 px-2 py-1.5 text-sm"
            />
          </div>
        )}
      </div>

      <div>
        <label className="mb-1 flex items-center gap-1.5 text-sm font-medium" htmlFor="file">
          File (pdf, docx, txt — max 50MB)
          <HelpTip slug="chunking-strategies" />
        </label>
        <input
          id="file"
          type="file"
          accept=".pdf,.docx,.txt"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className="w-full text-sm"
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1" htmlFor="sourceUrl">Source URL (optional)</label>
        <input
          id="sourceUrl"
          type="url"
          value={sourceUrl}
          onChange={(e) => setSourceUrl(e.target.value)}
          className="w-full rounded border border-zinc-300 px-3 py-2"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {stage && <p className="text-sm text-zinc-600">{stage}</p>}

      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {submitting ? 'Processing…' : 'Upload and process'}
      </button>
    </form>
  )
}
