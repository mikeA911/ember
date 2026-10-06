'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordChangeAction, resolveReverificationAction, setReviewIntervalAction } from '@/app/actions/requirements'
import { requirementsAffectedBy, type ScopedRequirement } from '@/lib/projects/reverification-scope'

// Solution conformance, Stage 4: record a change that needs requirements
// re-verified, resolve one without re-verifying, and set a review schedule.
// The server and the database check every rule again.

const input = 'w-full rounded border border-zinc-300 px-2 py-1 text-sm'
const button = 'rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'

function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  function run(action: () => Promise<{ error?: string }>, onSuccess?: () => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setError(result.error)
        return
      }
      onSuccess?.()
      router.refresh()
    })
  }
  return { error, isPending, run }
}

export function RecordChangeForm({
  projectId,
  requirements,
  objects,
  workstreams,
}: {
  projectId: string
  requirements: (ScopedRequirement & { code: string; title: string })[]
  objects: { id: string; name: string; parentId: string | null }[]
  workstreams: { id: string; name: string }[]
}) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState({
    kind: 'component_change' as 'component_change' | 'other',
    summary: '',
    changeReference: '',
    detail: '',
    objectId: '',
    workstreamId: '',
  })
  const [selected, setSelected] = useState<string[]>([])
  const { error, isPending, run } = useAction()
  const suggested = useMemo(
    () => new Set(requirementsAffectedBy({ objectId: value.objectId, workstreamId: value.workstreamId }, requirements, objects)),
    [value.objectId, value.workstreamId, requirements, objects]
  )

  // Choosing a component or workstream preselects the requirements scoped to
  // it; the person recording the change confirms or adjusts the list.
  function choose(next: Partial<typeof value>) {
    const merged = { ...value, ...next }
    setValue(merged)
    setSelected(requirementsAffectedBy({ objectId: merged.objectId, workstreamId: merged.workstreamId }, requirements, objects))
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={`${button} self-start`}>
        Record a change
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => recordChangeAction(projectId, { ...value, objectId: value.objectId || null, workstreamId: value.workstreamId || null, requirementIds: selected }),
          () => {
            setOpen(false)
            setSelected([])
            setValue({ kind: 'component_change', summary: '', changeReference: '', detail: '', objectId: '', workstreamId: '' })
          }
        )
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm"
    >
      <div className="grid gap-2 sm:grid-cols-[12rem_1fr]">
        <select value={value.kind} onChange={(e) => setValue({ ...value, kind: e.target.value as 'component_change' | 'other' })} className={input} aria-label="Kind">
          <option value="component_change">Component change</option>
          <option value="other">Other change</option>
        </select>
        <input required value={value.summary} onChange={(e) => setValue({ ...value, summary: e.target.value })} maxLength={300} placeholder="What changed (e.g. K-Dispatch upgraded at the Cebu PSAP)" className={input} />
      </div>
      <input value={value.changeReference} onChange={(e) => setValue({ ...value, changeReference: e.target.value })} maxLength={300} placeholder="Versions or configuration (e.g. K-Dispatch 4.2.1 → 4.3.0, firmware 7.4.2)" className={input} />
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={value.objectId} onChange={(e) => choose({ objectId: e.target.value })} className={input} aria-label="Component">
          <option value="">Component (optional)</option>
          {objects.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        <select value={value.workstreamId} onChange={(e) => choose({ workstreamId: e.target.value })} className={input} aria-label="Workstream">
          <option value="">Workstream (optional)</option>
          {workstreams.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
      </div>
      <textarea rows={2} value={value.detail} onChange={(e) => setValue({ ...value, detail: e.target.value })} placeholder="Details (optional): change request, release notes" className={input} />
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Requirements to re-verify</legend>
        {requirements.length === 0 ? (
          <p className="text-xs text-zinc-500">No open requirements.</p>
        ) : (
          <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto rounded border border-zinc-200 bg-white p-2">
            {requirements.map((r) => (
              <li key={r.id}>
                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={selected.includes(r.id)}
                    onChange={() => setSelected(selected.includes(r.id) ? selected.filter((x) => x !== r.id) : [...selected, r.id])}
                  />
                  <span>
                    <span className="font-mono text-zinc-500">{r.code}</span> {r.title}
                    {suggested.has(r.id) && <span className="text-zinc-500"> · scoped to this change</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending || selected.length === 0} className={button}>
          Record change
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function ResolveReverificationForm({ linkId }: { linkId: string }) {
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs underline">
        Resolve without re-verifying
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why (e.g. revised clause doesn't affect us)" className={`${input} max-w-sm`} />
      <button type="button" disabled={isPending} onClick={() => run(() => resolveReverificationAction(linkId, note), () => setOpen(false))} className={button}>
        Resolve
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-xs underline">
        Cancel
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  )
}

export function ReviewIntervalForm({ requirementId, initial }: { requirementId: string; initial: number | null }) {
  const [open, setOpen] = useState(false)
  const [months, setMonths] = useState(initial ? String(initial) : '')
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs underline">
        {initial ? 'Change' : 'Set a review schedule'}
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2 text-xs">
      Re-verify every
      <input type="number" min={1} max={120} value={months} onChange={(e) => setMonths(e.target.value)} className={`${input} w-20`} aria-label="Months" />
      months (empty for none)
      <button
        type="button"
        disabled={isPending}
        onClick={() => run(() => setReviewIntervalAction(requirementId, months.trim() ? Number(months) : null), () => setOpen(false))}
        className={button}
      >
        Save
      </button>
      <button type="button" onClick={() => setOpen(false)} className="underline">
        Cancel
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  )
}
