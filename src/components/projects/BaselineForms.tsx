'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  activateBaselineAction,
  createBaselineAction,
  decideDecisionAction,
  decideWaiverAction,
  deleteDraftBaselineAction,
  newBaselineVersionAction,
  requestDecisionAction,
  requestWaiverAction,
  setBaselineItemsAction,
  updateBaselineAction,
  withdrawDecisionAction,
  withdrawWaiverAction,
} from '@/app/actions/baselines'
import { supersedeRequirementAction } from '@/app/actions/requirements'
import type { ConformanceApprovalType, ConformanceDecisionType, RequirementAppliesFrom, RequirementStatus, WaiverKind } from '@/types/database'
import {
  APPLIES_FROM_LABELS,
  CONFORMANCE_APPROVAL_LABELS,
  DECISION_TYPE_LABELS,
  DEFAULT_APPROVAL_FOR_DECISION,
  STATUS_LABELS,
  WAIVER_KIND_LABELS,
  options,
} from './requirement-labels'

// Solution conformance, Stage 3: forms for evaluation baselines, waivers
// and conformance decisions. The server and the database check every rule
// again (curators manage baselines; only assigned authorities approve).

const input = 'w-full rounded border border-zinc-300 px-2 py-1 text-sm'
const button = 'rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'

function useAction() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  function run<T extends { error?: string }>(action: () => Promise<T>, onSuccess?: (result: T) => void) {
    setError(null)
    startTransition(async () => {
      const result = await action()
      if (result.error) {
        setError(result.error)
        return
      }
      onSuccess?.(result)
      router.refresh()
    })
  }
  return { error, isPending, run, router }
}

export interface CandidateRequirement {
  id: string
  code: string
  title: string
  status: RequirementStatus
  hasMethod: boolean
}

// --- Baseline fields -------------------------------------------------------------------

interface FieldsState {
  name: string
  purpose: ConformanceDecisionType
  lifecycleStage: RequirementAppliesFrom
  description: string
}

function FieldsInputs({ value, onChange }: { value: FieldsState; onChange: (v: FieldsState) => void }) {
  const set = <K extends keyof FieldsState>(key: K, v: FieldsState[K]) => onChange({ ...value, [key]: v })
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Name</span>
        <input required value={value.name} onChange={(e) => set('name', e.target.value)} maxLength={200} placeholder="Cebu NG911 Phase 1 Site Acceptance" className={input} />
      </label>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">For</span>
          <select value={value.purpose} onChange={(e) => set('purpose', e.target.value as ConformanceDecisionType)} className={input}>
            {options(DECISION_TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium">Lifecycle stage</span>
          <select value={value.lifecycleStage} onChange={(e) => set('lifecycleStage', e.target.value as RequirementAppliesFrom)} className={input}>
            {options(APPLIES_FROM_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">Description (optional)</span>
        <textarea rows={2} value={value.description} onChange={(e) => set('description', e.target.value)} className={input} />
      </label>
    </div>
  )
}

function RequirementChecklist({ candidates, selected, onChange }: { candidates: CandidateRequirement[]; selected: string[]; onChange: (ids: string[]) => void }) {
  if (candidates.length === 0) return <p className="text-sm text-zinc-500">No open requirements yet.</p>
  return (
    <ul className="flex max-h-72 flex-col gap-1 overflow-y-auto rounded border border-zinc-200 bg-white p-2">
      {candidates.map((r) => (
        <li key={r.id}>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(r.id)}
              onChange={() => onChange(selected.includes(r.id) ? selected.filter((x) => x !== r.id) : [...selected, r.id])}
            />
            <span>
              <span className="font-mono text-xs text-zinc-500">{r.code}</span> {r.title}{' '}
              <span className="text-xs text-zinc-500">· {STATUS_LABELS[r.status]}</span>
              {!r.hasMethod && <span className="text-xs text-amber-800"> · no verification method yet</span>}
            </span>
          </label>
        </li>
      ))}
    </ul>
  )
}

export function BaselineCreateForm({ projectId, candidates }: { projectId: string; candidates: CandidateRequirement[] }) {
  const [value, setValue] = useState<FieldsState>({ name: '', purpose: 'site_acceptance', lifecycleStage: 'deployment', description: '' })
  const [selected, setSelected] = useState<string[]>([])
  const { error, isPending, run, router } = useAction()
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(
          () => createBaselineAction(projectId, { ...value, requirementIds: selected }),
          (result) => result.baselineId && router.push(`/projects/${projectId}/requirements/baselines/${result.baselineId}`)
        )
      }}
      className="flex flex-col gap-4"
    >
      <FieldsInputs value={value} onChange={setValue} />
      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium">Requirements</span>
        <RequirementChecklist candidates={candidates} selected={selected} onChange={setSelected} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button disabled={isPending} className={`${button} self-start`}>
        Create draft baseline
      </button>
    </form>
  )
}

export function BaselineFieldsEditor({ baselineId, initial }: { baselineId: string; initial: FieldsState }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState(initial)
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-sm underline">
        Edit
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => updateBaselineAction(baselineId, value), () => setOpen(false))
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3"
    >
      <FieldsInputs value={value} onChange={setValue} />
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

export function BaselineItemsEditor({ baselineId, candidates, initial }: { baselineId: string; candidates: CandidateRequirement[]; initial: string[] }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(initial)
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        Change requirements
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3">
      <RequirementChecklist candidates={candidates} selected={selected} onChange={setSelected} />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={() => run(() => setBaselineItemsAction(baselineId, selected), () => setOpen(false))} className={button}>
          Save
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </div>
  )
}

export function BaselineLifecycleActions({ projectId, baselineId, status }: { projectId: string; baselineId: string; status: 'draft' | 'active' | 'superseded' }) {
  const { error, isPending, run, router } = useAction()
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      {status === 'draft' && (
        <>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm('Activate this baseline? Its requirements become baselined and can no longer be edited, and the baseline is frozen.')) {
                run(() => activateBaselineAction(baselineId))
              }
            }}
            className={button}
          >
            Activate
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              if (confirm('Delete this draft baseline?')) run(() => deleteDraftBaselineAction(baselineId), () => router.push(`/projects/${projectId}/requirements/baselines`))
            }}
            className="text-red-700 underline disabled:opacity-50"
          >
            Delete draft
          </button>
        </>
      )}
      {status !== 'draft' && (
        <button
          type="button"
          disabled={isPending}
          onClick={() =>
            run(
              () => newBaselineVersionAction(baselineId),
              (result) => result.baselineId && router.push(`/projects/${projectId}/requirements/baselines/${result.baselineId}`)
            )
          }
          className="underline disabled:opacity-50"
        >
          Create a new version
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
    </div>
  )
}

// --- Waivers ---------------------------------------------------------------------------

export function WaiverRequestForm({ baselineId, requirements }: { baselineId: string; requirements: { id: string; code: string; title: string }[] }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState({
    requirementId: requirements[0]?.id ?? '',
    kind: 'deviation' as WaiverKind,
    rationale: '',
    conditions: '',
    approvalType: 'customer_acceptance' as ConformanceApprovalType,
  })
  const { error, isPending, run } = useAction()
  const set = <K extends keyof typeof value>(key: K, v: (typeof value)[K]) => setValue({ ...value, [key]: v })
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        + Request a waiver or deviation
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => requestWaiverAction(baselineId, value), () => setOpen(false))
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm"
    >
      <div className="grid gap-2 sm:grid-cols-[1fr_9rem]">
        <select value={value.requirementId} onChange={(e) => set('requirementId', e.target.value)} className={input} aria-label="Requirement">
          {requirements.map((r) => (
            <option key={r.id} value={r.id}>
              {r.code} · {r.title}
            </option>
          ))}
        </select>
        <select value={value.kind} onChange={(e) => set('kind', e.target.value as WaiverKind)} className={input} aria-label="Kind">
          {options(WAIVER_KIND_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <textarea required rows={2} value={value.rationale} onChange={(e) => set('rationale', e.target.value)} placeholder="Rationale: why it can be accepted as is" className={input} />
      <input value={value.conditions} onChange={(e) => set('conditions', e.target.value)} placeholder="Conditions (optional, e.g. fixed in K-Dispatch 4.3 by March)" className={input} />
      <label className="flex flex-col gap-1">
        <span className="font-medium">Approved by a holder of</span>
        <select value={value.approvalType} onChange={(e) => set('approvalType', e.target.value as ConformanceApprovalType)} className={input}>
          {options(CONFORMANCE_APPROVAL_LABELS).map(([k, l]) => (
            <option key={k} value={k}>
              {l} authority
            </option>
          ))}
        </select>
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending || !value.requirementId} className={button}>
          Request
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function WaiverActions({ baselineId, waiverId, canDecide, canWithdraw }: { baselineId: string; waiverId: string; canDecide: boolean; canWithdraw: boolean }) {
  const [note, setNote] = useState('')
  const { error, isPending, run } = useAction()
  return (
    <div className="mt-2 flex flex-col gap-2">
      {canDecide && (
        <div className="flex flex-wrap items-center gap-2">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" className={`${input} max-w-xs`} />
          <button type="button" disabled={isPending} onClick={() => run(() => decideWaiverAction(baselineId, waiverId, true, note))} className={button}>
            Approve
          </button>
          <button type="button" disabled={isPending} onClick={() => run(() => decideWaiverAction(baselineId, waiverId, false, note))} className="text-sm text-red-700 underline">
            Reject
          </button>
        </div>
      )}
      {canWithdraw && (
        <button type="button" disabled={isPending} onClick={() => run(() => withdrawWaiverAction(baselineId, waiverId))} className="self-start text-xs underline">
          Withdraw
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

// --- Decisions -------------------------------------------------------------------------

export function DecisionRequestForm({ baselineId, purpose }: { baselineId: string; purpose: ConformanceDecisionType }) {
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState({ decisionType: purpose, approvalType: DEFAULT_APPROVAL_FOR_DECISION[purpose], note: '' })
  const { error, isPending, run } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="self-start text-sm text-blue-700 underline">
        + Request a decision
      </button>
    )
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        run(() => requestDecisionAction(baselineId, value), () => setOpen(false))
      }}
      className="flex flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm"
    >
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Decision</span>
          <select
            value={value.decisionType}
            onChange={(e) => {
              const decisionType = e.target.value as ConformanceDecisionType
              setValue({ ...value, decisionType, approvalType: DEFAULT_APPROVAL_FOR_DECISION[decisionType] })
            }}
            className={input}
          >
            {options(DECISION_TYPE_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Approved by a holder of</span>
          <select value={value.approvalType} onChange={(e) => setValue({ ...value, approvalType: e.target.value as ConformanceApprovalType })} className={input}>
            {options(CONFORMANCE_APPROVAL_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l} authority
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea rows={2} value={value.note} onChange={(e) => setValue({ ...value, note: e.target.value })} placeholder="Note for the approvers (optional)" className={input} />
      <p className="text-xs text-zinc-500">
        Approvers see the live roll-up. The number of approvals needed and whether self-approval is allowed come from this Project&rsquo;s approval policy.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending} className={button}>
          Request
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}

export function DecisionActions({ baselineId, decisionId, canDecide, canWithdraw }: { baselineId: string; decisionId: string; canDecide: boolean; canWithdraw: boolean }) {
  const [value, setValue] = useState({ note: '', conditions: '' })
  const { error, isPending, run } = useAction()
  return (
    <div className="mt-2 flex flex-col gap-2">
      {canDecide && (
        <div className="flex flex-col gap-2">
          <textarea rows={2} value={value.note} onChange={(e) => setValue({ ...value, note: e.target.value })} placeholder="Your note (required to reject)" className={input} />
          <input value={value.conditions} onChange={(e) => setValue({ ...value, conditions: e.target.value })} placeholder="Conditions of your approval (optional)" className={input} />
          <div className="flex gap-2">
            <button type="button" disabled={isPending} onClick={() => run(() => decideDecisionAction(baselineId, decisionId, { approve: true, ...value }))} className={button}>
              Approve
            </button>
            <button type="button" disabled={isPending} onClick={() => run(() => decideDecisionAction(baselineId, decisionId, { approve: false, ...value }))} className="text-sm text-red-700 underline">
              Reject
            </button>
          </div>
        </div>
      )}
      {canWithdraw && (
        <button type="button" disabled={isPending} onClick={() => run(() => withdrawDecisionAction(baselineId, decisionId))} className="self-start text-xs underline">
          Withdraw request
        </button>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}

// --- Superseding a requirement ---------------------------------------------------------

export function SupersedeRequirementButton({ projectId, requirementId, suggestedCode }: { projectId: string; requirementId: string; suggestedCode: string }) {
  const [open, setOpen] = useState(false)
  const [code, setCode] = useState(suggestedCode)
  const { error, isPending, run, router } = useAction()
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="underline">
        Supersede with a new version
      </button>
    )
  }
  return (
    <span className="flex flex-wrap items-center gap-2">
      <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={60} className={`${input} w-40`} aria-label="New code" />
      <button
        type="button"
        disabled={isPending}
        onClick={() =>
          run(
            () => supersedeRequirementAction(requirementId, { code }),
            (result) => result.requirementId && router.push(`/projects/${projectId}/requirements/${result.requirementId}`)
          )
        }
        className={button}
      >
        Create the new draft
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
        Cancel
      </button>
      {error && <span className="text-red-600">{error}</span>}
    </span>
  )
}
