'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { recordVerificationAction } from '@/app/actions/requirements'
import type { ArtifactType, VerificationEnvironment, VerificationMethodKind, VerificationResult } from '@/types/database'
import { ARTIFACT_TYPE_LABELS, ENVIRONMENT_LABELS, METHOD_LABELS, RESULT_LABELS, options } from './requirement-labels'

// Solution conformance, Stage 2: record one verification result against a
// requirement's method, with the solution state and evidence artifacts --
// or a correction that supersedes an earlier record. Records can't be
// edited; the server and the database check every rule again.

export interface RecordFormMethod {
  id: string
  method: VerificationMethodKind
  pass_criteria: string
  threshold: string | null
  measure_window: string | null
}

export interface RecordFormArtifact {
  id: string
  title: string
  artifactType: ArtifactType
  status: string
  workstreamName: string
  inScope: boolean
}

export interface RecordFormInitial {
  methodId: string
  environment: VerificationEnvironment
  solutionReference: string
  configurationReference: string
  artifactIds: string[]
}

const input = 'w-full rounded border border-zinc-300 px-2 py-1 text-sm'
const button = 'rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50'

const today = () => new Date().toISOString().slice(0, 10)

export function VerificationRecordForm({
  requirementId,
  methods,
  artifacts,
  methodId,
  supersedesId,
  initial,
  label,
}: {
  requirementId: string
  methods: RecordFormMethod[]
  artifacts: RecordFormArtifact[]
  // Preselects a method (the "Record result" button on a method).
  methodId?: string
  // A correction of this record; initial carries its solution state.
  supersedesId?: string
  initial?: RecordFormInitial
  label?: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [value, setValue] = useState(() => ({
    methodId: initial?.methodId ?? methodId ?? methods[0]?.id ?? '',
    result: 'pass' as VerificationResult,
    environment: initial?.environment ?? ('staging' as VerificationEnvironment),
    solutionReference: initial?.solutionReference ?? '',
    configurationReference: initial?.configurationReference ?? '',
    performedOn: today(),
    artifactIds: initial?.artifactIds ?? ([] as string[]),
    conditions: '',
    rationale: '',
    measuredValue: '',
    observations: '',
    defectReference: '',
  }))
  const set = <K extends keyof typeof value>(key: K, v: (typeof value)[K]) => setValue({ ...value, [key]: v })
  const method = methods.find((m) => m.id === value.methodId)
  const needsEvidence = value.result === 'pass' || value.result === 'conditional_pass'

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={supersedesId ? 'text-xs underline' : 'text-xs text-blue-700 underline'}>
        {label ?? (supersedesId ? 'Correct' : 'Record result')}
      </button>
    )
  }

  function toggleArtifact(id: string) {
    set('artifactIds', value.artifactIds.includes(id) ? value.artifactIds.filter((a) => a !== id) : [...value.artifactIds, id])
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        startTransition(async () => {
          const result = await recordVerificationAction(requirementId, { ...value, supersedesId: supersedesId ?? null })
          if (result.error) {
            setError(result.error)
            return
          }
          setOpen(false)
          router.refresh()
        })
      }}
      className="mt-2 flex w-full flex-col gap-2 rounded border border-zinc-200 bg-zinc-50 p-3 text-sm"
    >
      {supersedesId && (
        <p className="text-xs text-zinc-600">
          This records a correction. The earlier record stays in the history, marked as superseded.
        </p>
      )}
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="font-medium">Method</span>
          <select value={value.methodId} onChange={(e) => set('methodId', e.target.value)} className={input}>
            {methods.map((m) => (
              <option key={m.id} value={m.id}>
                {METHOD_LABELS[m.method]}: {m.pass_criteria.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-medium">Result</span>
          <select value={value.result} onChange={(e) => set('result', e.target.value as VerificationResult)} className={input}>
            {options(RESULT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      {method && (
        <p className="text-xs text-zinc-600">
          Pass criteria: {method.pass_criteria}
          {method.threshold && ` · threshold ${method.threshold}, measured ${method.measure_window}`}
        </p>
      )}
      {value.result === 'conditional_pass' && (
        <textarea required rows={2} value={value.conditions} onChange={(e) => set('conditions', e.target.value)} placeholder="Conditions (what must still be done, by when)" className={input} />
      )}
      {value.result === 'not_applicable' && (
        <textarea required rows={2} value={value.rationale} onChange={(e) => set('rationale', e.target.value)} placeholder="Why it doesn't apply" className={input} />
      )}
      {value.result === 'not_run' && (
        <input value={value.rationale} onChange={(e) => set('rationale', e.target.value)} placeholder="Why it wasn't run (optional)" className={input} />
      )}
      {method?.method === 'operational_measure' && value.result !== 'not_run' && value.result !== 'not_applicable' && (
        <input required value={value.measuredValue} onChange={(e) => set('measuredValue', e.target.value)} placeholder="Measured value (e.g. 93.4% within 15 s, September)" className={input} />
      )}

      <fieldset className="flex flex-col gap-2">
        <legend className="font-medium">Solution state</legend>
        <div className="grid gap-2 sm:grid-cols-[10rem_1fr_9rem]">
          <select value={value.environment} onChange={(e) => set('environment', e.target.value as VerificationEnvironment)} className={input} aria-label="Environment">
            {options(ENVIRONMENT_LABELS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <input
            required
            value={value.solutionReference}
            onChange={(e) => set('solutionReference', e.target.value)}
            placeholder="Build or component versions (e.g. K-Dispatch 4.2.1, Mitel MX-ONE 7.4)"
            className={input}
            aria-label="Build or component versions"
          />
          <input required type="date" value={value.performedOn} max={today()} onChange={(e) => set('performedOn', e.target.value)} className={input} aria-label="Performed on" />
        </div>
        <input
          value={value.configurationReference}
          onChange={(e) => set('configurationReference', e.target.value)}
          placeholder="Configuration reference (optional)"
          className={input}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Evidence {needsEvidence ? '(at least one artifact)' : '(optional)'}</legend>
        {artifacts.length === 0 ? (
          <p className="text-xs text-amber-800">
            No workstream artifacts to cite yet. Attach the test results, evidence map or findings to a workstream first.
          </p>
        ) : (
          <ul className="flex max-h-48 flex-col gap-1 overflow-y-auto rounded border border-zinc-200 bg-white p-2">
            {artifacts.map((a) => (
              <li key={a.id}>
                <label className="flex items-start gap-2 text-xs">
                  <input type="checkbox" checked={value.artifactIds.includes(a.id)} onChange={() => toggleArtifact(a.id)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{a.title}</span>{' '}
                    <span className="text-zinc-500">
                      · {ARTIFACT_TYPE_LABELS[a.artifactType]} · {a.workstreamName}
                      {a.status !== 'approved' && ` · ${a.status.replace(/_/g, ' ')}`}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <textarea rows={2} value={value.observations} onChange={(e) => set('observations', e.target.value)} placeholder="Observations and defects (optional)" className={input} />
      <input value={value.defectReference} onChange={(e) => set('defectReference', e.target.value)} placeholder="Issue reference (optional, e.g. JIRA-1234)" className={input} />

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button disabled={isPending || !value.methodId} className={button}>
          {supersedesId ? 'Record correction' : 'Record result'}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm underline">
          Cancel
        </button>
      </div>
    </form>
  )
}
