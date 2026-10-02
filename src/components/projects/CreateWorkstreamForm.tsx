'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createWorkstreamAction } from '@/app/actions/workstreams'
import type { WorkstreamLifecycleStage } from '@/types/database'

const LIFECYCLE_STAGES: { value: WorkstreamLifecycleStage; label: string }[] = [
  { value: 'presales', label: 'Presales' },
  { value: 'deployment', label: 'Deployment' },
  { value: 'management_maintenance', label: 'Management & Maintenance' },
]

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export function CreateWorkstreamForm({
  projectId,
  defaultLifecycleStage = '',
}: {
  projectId: string
  defaultLifecycleStage?: WorkstreamLifecycleStage | ''
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [lifecycleStage, setLifecycleStage] = useState<WorkstreamLifecycleStage | ''>(defaultLifecycleStage)
  const [repositoryScope, setRepositoryScope] = useState('')
  const [guardrail, setGuardrail] = useState('')
  const [deliverables, setDeliverables] = useState<string[]>([])
  const [deliverableInput, setDeliverableInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  function addDeliverable() {
    if (!deliverableInput.trim()) return
    setDeliverables((prev) => [...prev, deliverableInput.trim()])
    setDeliverableInput('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSubmitting(true)
    try {
      const result = await createWorkstreamAction({
        projectId,
        name,
        slug: slugify(name),
        repositoryScope: repositoryScope.split('\n'),
        guardrail: guardrail || undefined,
        deliverables,
        lifecycleStage: lifecycleStage || null,
      })
      router.push(`/projects/${projectId}/workstreams/${result.workstreamId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workstream')
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Name</span>
        <input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Onboarding Modernization" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Lifecycle stage</span>
        <select
          value={lifecycleStage}
          onChange={(e) => setLifecycleStage(e.target.value as WorkstreamLifecycleStage | '')}
          className="rounded border border-zinc-300 px-3 py-2 text-sm"
        >
          <option value="">Not set</option>
          {LIFECYCLE_STAGES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Repository scope</span>
        <textarea
          rows={3}
          value={repositoryScope}
          onChange={(e) => setRepositoryScope(e.target.value)}
          placeholder={'One glob pattern per line, e.g.\nsrc/onboarding/**\nsrc/identity/**'}
          className="rounded border border-zinc-300 px-3 py-2 font-mono text-sm"
        />
      </label>

      <p className="text-xs text-zinc-500">
        Goal is set once at the project level (every workstream shares it) — edit it from the project page.
      </p>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Guardrail</span>
        <input value={guardrail} onChange={(e) => setGuardrail(e.target.value)} placeholder="e.g. Safe Modernization" className="rounded border border-zinc-300 px-3 py-2 text-sm" />
      </label>

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Deliverables</span>
        {deliverables.length > 0 && (
          <ul className="flex flex-col gap-1">
            {deliverables.map((d, i) => (
              <li key={`${d}-${i}`} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-1.5 text-sm">
                <span>{d}</span>
                <button
                  type="button"
                  onClick={() => setDeliverables((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-xs text-red-600 underline"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input
            value={deliverableInput}
            onChange={(e) => setDeliverableInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                addDeliverable()
              }
            }}
            placeholder="e.g. capability inventory"
            className="flex-1 rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          <button type="button" onClick={addDeliverable} className="rounded border border-zinc-300 px-3 py-2 text-sm">
            + Add
          </button>
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <button disabled={submitting} className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {submitting ? 'Creating…' : 'Create Workstream'}
      </button>
    </form>
  )
}
