'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  createRequirementAction,
  updateRequirementAction,
  addRequirementSourceAction,
  removeRequirementSourceAction,
  setRequirementScopeAction,
  addVerificationMethodAction,
  updateVerificationMethodAction,
  removeVerificationMethodAction,
  withdrawRequirementAction,
  deleteDraftRequirementAction,
  acceptDraftedRequirementAction,
} from '@/app/actions/requirements'
import type {
  RequirementAppliesFrom,
  RequirementCategory,
  RequirementPriority,
  RequirementSourceKind,
  VerificationMethodKind,
  VerificationPerformer,
} from '@/types/database'
import { criterionText, parseCriteria } from '@/lib/projects/criteria'
import {
  APPLIES_FROM_LABELS,
  CATEGORY_LABELS,
  METHOD_LABELS,
  PERFORMER_LABELS,
  PRIORITY_LABELS,
  SOURCE_KIND_LABELS,
  options,
} from './requirement-labels'

// Solution conformance, Stage 1: forms for the requirements register.
// Project owners/curators and platform admins only; the server checks again
// and RLS allows changes only while a requirement is a draft.

export interface RequirementPickerOptions {
  sources: { id: string; title: string; context: string | null }[]
  articles: { id: string; title: string }[]
  workstreams: { id: string; name: string }[]
  objects: { id: string; name: string }[]
}

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

// --- Fields ----------------------------------------------------------------------------

export interface FieldsState {
  code: string
  title: string
  statement: string
  rationale: string
  category: RequirementCategory
  priority: RequirementPriority
  appliesFrom: RequirementAppliesFrom
}

function FieldsInputs({ value, onChange, codePlaceholder }: { value: FieldsState; onChange: (v: FieldsState) => void; codePlaceholder?: string }) {
  const set = <K extends keyof FieldsState>(key: K, v: FieldsState[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Code</span>
          <input value={value.code} onChange={(e) => set('code', e.target.value)} maxLength={60} placeholder={codePlaceholder} className={input} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Title</span>
          <input required value={value.title} onChange={(e) => set('title', e.target.value)} maxLength={200} className={input} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Requirement</span>
        <textarea
          required
          rows={3}
          value={value.statement}
          onChange={(e) => set('statement', e.target.value)}
          placeholder="The system shall pass caller location to K-Dispatch for every 911 call, per NENA i3."
          className={input}
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Rationale (optional)</span>
        <textarea rows={2} value={value.rationale} onChange={(e) => set('rationale', e.target.value)} className={input} />
      </label>
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Category</span>
          <select value={value.category} onChange={(e) => set('category', e.target.value as RequirementCategory)} className={input}>
            {options(CATEGORY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Priority</span>
          <select value={value.priority} onChange={(e) => set('priority', e.target.value as RequirementPriority)} className={input}>
            {options(PRIORITY_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Verify from</span>
          <select value={value.appliesFrom} onChange={(e) => set('appliesFrom', e.target.value as RequirementAppliesFrom)} className={input}>
            {options(APPLIES_FROM_LABELS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  )
}

// --- Sources ---------------------------------------------------------------------------

export interface SourceState {
  kind: RequirementSourceKind
  knowledgeSourceId: string
  wikiArticleId: string
  locator: string
  requester: string
  note: string
}

const emptySource = (): SourceState => ({ kind: 'standard', knowledgeSourceId: '', wikiArticleId: '', locator: '', requester: '', note: '' })

function SourceInputs({ value, onChange, picker }: { value: SourceState; onChange: (v: SourceState) => void; picker: RequirementPickerOptions }) {
  const set = <K extends keyof SourceState>(key: K, v: SourceState[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="flex flex-col gap-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={value.kind} onChange={(e) => set('kind', e.target.value as RequirementSourceKind)} className={input} aria-label="Where it comes from">
          {options(SOURCE_KIND_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        {value.kind === 'customer_need' ? (
          <input value={value.requester} onChange={(e) => set('requester', e.target.value)} maxLength={300} placeholder="Who asked (required)" className={input} />
        ) : (
          <input
            value={value.locator}
            onChange={(e) => set('locator', e.target.value)}
            maxLength={500}
            placeholder="Clause, section, table or page (e.g. NENA-STA-010 §4.2)"
            className={input}
          />
        )}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={value.knowledgeSourceId} onChange={(e) => set('knowledgeSourceId', e.target.value)} className={input} aria-label="Knowledge source">
          <option value="">Linked source in the knowledge base (optional)</option>
          {picker.sources.map((src) => (
            <option key={src.id} value={src.id}>
              {src.title}
              {src.context ? ` — ${src.context}` : ''}
            </option>
          ))}
        </select>
        <select value={value.wikiArticleId} onChange={(e) => set('wikiArticleId', e.target.value)} className={input} aria-label="Wiki article">
          <option value="">Linked Wiki article (optional)</option>
          {picker.articles.map((a) => (
            <option key={a.id} value={a.id}>
              {a.title}
            </option>
          ))}
        </select>
      </div>
      {value.kind === 'customer_need' && (
        <input value={value.locator} onChange={(e) => set('locator', e.target.value)} maxLength={500} placeholder="Where it was stated (meeting, email) — optional" className={input} />
      )}
      <input value={value.note} onChange={(e) => set('note', e.target.value)} maxLength={4000} placeholder="Note (optional)" className={input} />
    </div>
  )
}

const toSourceInput = (s: SourceState) => ({
  kind: s.kind,
  knowledgeSourceId: s.knowledgeSourceId || null,
  wikiArticleId: s.wikiArticleId || null,
  locator: s.locator,
  requester: s.requester,
  note: s.note,
})

function ScopeChecklist({
  picker,
  workstreamIds,
  objectIds,
  onChange,
}: {
  picker: RequirementPickerOptions
  workstreamIds: string[]
  objectIds: string[]
  onChange: (next: { workstreamIds: string[]; objectIds: string[] }) => void
}) {
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id])
  if (picker.workstreams.length === 0 && picker.objects.length === 0) {
    return <p className="text-xs text-zinc-500">This Project has no workstreams or objects to scope to yet.</p>
  }
  return (
    <div className="grid gap-2 text-sm sm:grid-cols-2">
      {picker.workstreams.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-600">Workstreams</legend>
          {picker.workstreams.map((w) => (
            <label key={w.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={workstreamIds.includes(w.id)} onChange={() => onChange({ workstreamIds: toggle(workstreamIds, w.id), objectIds })} />
              {w.name}
            </label>
          ))}
        </fieldset>
      )}
      {picker.objects.length > 0 && (
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-zinc-600">Project objects</legend>
          {picker.objects.map((o) => (
            <label key={o.id} className="flex items-center gap-1.5">
              <input type="checkbox" checked={objectIds.includes(o.id)} onChange={() => onChange({ workstreamIds, objectIds: toggle(objectIds, o.id) })} />
              {o.name}
            </label>
          ))}
        </fieldset>
      )}
    </div>
  )
}

// --- Create ----------------------------------------------------------------------------

export function RequirementCreateForm({ projectId, picker, suggestedCode }: { projectId: string; picker: RequirementPickerOptions; suggestedCode: string }) {
  const router = useRouter()
  const [fields, setFields] = useState<FieldsState>({
    code: '',
    title: '',
    statement: '',
    rationale: '',
    category: 'functional',
    priority: 'must',
    appliesFrom: 'deployment',
  })
  const [sources, setSources] = useState<SourceState[]>([emptySource()])
  const [scope, setScope] = useState<{ workstreamIds: string[]; objectIds: string[] }>({ workstreamIds: [], objectIds: [] })
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await createRequirementAction(projectId, { ...fields, sources: sources.map(toSourceInput), ...scope })
          if (result.error || !result.requirementId) {
            setError(result.error ?? 'Could not create the requirement')
            return
          }
          router.push(`/projects/${projectId}/requirements/${result.requirementId}`)
        })
      }}
      className="flex flex-col gap-5"
    >
      <FieldsInputs value={fields} onChange={setFields} codePlaceholder={`${suggestedCode} (leave blank to use this)`} />

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Where it comes from</h2>
        <p className="text-xs text-zinc-600">
          Every requirement needs at least one origin. A vendor claim is recorded as something to verify, never as a met requirement.
        </p>
        {sources.map((src, i) => (
          <div key={i} className="rounded border border-zinc-200 bg-zinc-50 p-2">
            <SourceInputs value={src} onChange={(v) => setSources(sources.map((s, j) => (j === i ? v : s)))} picker={picker} />
            {sources.length > 1 && (
              <button type="button" onClick={() => setSources(sources.filter((_, j) => j !== i))} className="mt-1 text-xs underline">
                Remove
              </button>
            )}
          </div>
        ))}
        <button type="button" onClick={() => setSources([...sources, emptySource()])} className="self-start text-sm text-blue-700 underline">
          + Add another source
        </button>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">What it concerns (optional)</h2>
        <ScopeChecklist picker={picker} workstreamIds={scope.workstreamIds} objectIds={scope.objectIds} onChange={setScope} />
      </section>

      <p className="text-xs text-zinc-600">Add verification methods on the next page.</p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={isPending} className={`${button} self-start`}>
        {isPending ? 'Creating…' : 'Create draft requirement'}
      </button>
    </form>
  )
}

// --- Edit (draft only) -----------------------------------------------------------------

export function RequirementFieldsEditor({ requirementId, initial }: { requirementId: string; initial: FieldsState }) {
  const [open, setOpen] = useState(false)
  const [fields, setFields] = useState(initial)
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm text-blue-700 underline">
        Edit
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => updateRequirementAction(requirementId, fields), () => setOpen(false))
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"
    >
      <FieldsInputs value={fields} onChange={setFields} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className={button}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function AddSourceForm({ requirementId, picker }: { requirementId: string; picker: RequirementPickerOptions }) {
  const [open, setOpen] = useState(false)
  const [source, setSource] = useState(emptySource())
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        + Add a source
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => addRequirementSourceAction(requirementId, toSourceInput(source)),
          () => {
            setOpen(false)
            setSource(emptySource())
          }
        )
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"
    >
      <SourceInputs value={source} onChange={setSource} picker={picker} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className={button}>
          Add
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function RemoveSourceButton({ requirementId, sourceId }: { requirementId: string; sourceId: string }) {
  const { error, isPending, run } = useAction()
  return (
    <span>
      <button type="button" disabled={isPending} onClick={() => run(() => removeRequirementSourceAction(requirementId, sourceId))} className="text-xs underline">
        Remove
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  )
}

export function ScopeEditor({
  requirementId,
  picker,
  initialWorkstreamIds,
  initialObjectIds,
}: {
  requirementId: string
  picker: RequirementPickerOptions
  initialWorkstreamIds: string[]
  initialObjectIds: string[]
}) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState({ workstreamIds: initialWorkstreamIds, objectIds: initialObjectIds })
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        Change scope
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3">
      <ScopeChecklist picker={picker} workstreamIds={scope.workstreamIds} objectIds={scope.objectIds} onChange={setScope} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={() => run(() => setRequirementScopeAction(requirementId, scope), () => setOpen(false))} className={button}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

// --- Verification methods --------------------------------------------------------------

export interface MethodState {
  method: VerificationMethodKind
  procedure: string
  passCriteria: string
  threshold: string
  measureWindow: string
  performedBy: VerificationPerformer
}

const emptyMethod = (): MethodState => ({ method: 'test', procedure: '', passCriteria: '', threshold: '', measureWindow: '', performedBy: 'integrator' })

// Several criteria drafted as one paragraph ("AC1: ... AC2: ...") open one
// per line, so each is easy to find and edit.
function criteriaOnePerLine(passCriteria: string): string {
  if (passCriteria.includes('\n')) return passCriteria
  const items = parseCriteria(passCriteria)
  return items.length > 1 ? items.map(criterionText).join('\n') : passCriteria
}

// Tall enough to show long criteria without scrolling a three-line box.
function rowsFor(text: string): number {
  const lines = text.split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / 80)), 0)
  return Math.min(16, Math.max(3, lines))
}

export function VerificationMethodForm({ requirementId, methodId, initial }: { requirementId: string; methodId?: string; initial?: MethodState }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState<MethodState>(initial ?? emptyMethod())
  const { error, isPending, run } = useAction()
  const set = <K extends keyof MethodState>(key: K, v: MethodState[K]) => setValue({ ...value, [key]: v })
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue({ ...value, passCriteria: criteriaOnePerLine(value.passCriteria) })
          setOpen(true)
        }}
        className={methodId ? 'text-xs underline' : 'self-start text-sm text-blue-700 underline'}
      >
        {methodId ? 'Edit' : '+ Add a verification method'}
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => (methodId ? updateVerificationMethodAction(requirementId, methodId, value) : addVerificationMethodAction(requirementId, value)),
          () => {
            setOpen(false)
            if (!methodId) setValue(emptyMethod())
          }
        )
      }}
      className="flex w-full flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <select value={value.method} onChange={(e) => set('method', e.target.value as VerificationMethodKind)} className={input} aria-label="Method">
          {options(METHOD_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <select value={value.performedBy} onChange={(e) => set('performedBy', e.target.value as VerificationPerformer)} className={input} aria-label="Performed by">
          {options(PERFORMER_LABELS).map(([k, label]) => (
            <option key={k} value={k}>
              Performed by: {label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        required
        rows={rowsFor(value.passCriteria)}
        value={value.passCriteria}
        onChange={(e) => set('passCriteria', e.target.value)}
        placeholder="Pass criteria — explicit and checkable (e.g. location shown in K-Dispatch within 2 s for 20 of 20 test calls). Several criteria: one per line; each gets its own checkbox when a result is recorded."
        className={input}
      />
      {value.method === 'operational_measure' && (
        <div className="grid gap-2 sm:grid-cols-2">
          <input required value={value.threshold} onChange={(e) => set('threshold', e.target.value)} placeholder="Threshold (from the standard or contract)" className={input} />
          <input required value={value.measureWindow} onChange={(e) => set('measureWindow', e.target.value)} placeholder="Measured over (e.g. monthly)" className={input} />
        </div>
      )}
      <textarea rows={2} value={value.procedure} onChange={(e) => set('procedure', e.target.value)} placeholder="Procedure, preconditions, environment (optional)" className={input} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className={button}>
          {methodId ? 'Save' : 'Add'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function RemoveMethodButton({ requirementId, methodId }: { requirementId: string; methodId: string }) {
  const { error, isPending, run } = useAction()
  return (
    <span>
      <button type="button" disabled={isPending} onClick={() => run(() => removeVerificationMethodAction(requirementId, methodId))} className="text-xs underline">
        Remove
      </button>
      {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
    </span>
  )
}

// --- Lifecycle -------------------------------------------------------------------------

export function RequirementLifecycleActions({ projectId, requirementId, isDraft, isOpen }: { projectId: string; requirementId: string; isDraft: boolean; isOpen: boolean }) {
  const router = useRouter()
  const { error, isPending, run } = useAction()
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {isOpen && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (confirm('Withdraw this requirement? It stays in the register as withdrawn and cannot be reopened.')) run(() => withdrawRequirementAction(requirementId))
          }}
          className="underline disabled:opacity-50"
        >
          Withdraw
        </button>
      )}
      {isDraft && (
        <button
          type="button"
          disabled={isPending}
          onClick={() => {
            if (confirm('Delete this draft requirement permanently?')) {
              run(() => deleteDraftRequirementAction(requirementId), () => router.push(`/projects/${projectId}/requirements`))
            }
          }}
          className="text-red-700 underline disabled:opacity-50"
        >
          Delete draft
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  )
}

// Stage 5: accepting a requirement Ember drafted, after reviewing it.
export function AcceptDraftButton({ requirementId }: { requirementId: string }) {
  const { error, isPending, run } = useAction()
  return (
    <span className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={isPending}
        onClick={() => {
          if (confirm('Accept this requirement as reviewed? It can then be added to a baseline. You can still edit it while it is a draft.')) {
            run(() => acceptDraftedRequirementAction(requirementId))
          }
        }}
        className={button}
      >
        Accept draft
      </button>
      {error && <span className="text-sm text-red-600">{error}</span>}
    </span>
  )
}
