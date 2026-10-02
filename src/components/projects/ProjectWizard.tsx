'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { ApprovalType, ProjectRole, ProjectType, WorkstreamLifecycleStage } from '@/types/database'
import { createProjectAction, suggestProjectOntologyAction } from '@/app/actions/projects'
import { UserPicker, type UserOption } from './UserPicker'

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const LIFECYCLE_STAGE_LABELS: Record<WorkstreamLifecycleStage, string> = {
  presales: 'Presales',
  deployment: 'Deployment',
  management_maintenance: 'Management & Maintenance',
}

const WIZARD_STEPS = [
  'What are you doing?',
  'Define the problem',
  'Domain objects & workstreams',
  'Knowledge scope',
  'Evaluation',
  'Team',
  'Governance & Approvals',
]

const TEAM_ROLES: ProjectRole[] = ['curator', 'consultant', 'viewer']

const PROJECT_TYPES: { value: ProjectType; label: string; description: string }[] = [
  { value: 'learning', label: 'Learning', description: 'Learn an AI technique through a guided experiment.' },
  { value: 'experiment', label: 'Experiment', description: 'Test a technical hypothesis or architecture choice.' },
  { value: 'consulting', label: 'Client / Consulting', description: 'Solve or evaluate an AI use case for a client or engagement.' },
  { value: 'transformation', label: 'Internal Transformation', description: 'Improve an internal workflow or business process.' },
  { value: 'knowledge', label: 'Knowledge', description: 'Build or maintain a curated knowledge base.' },
]

const APPROVAL_TYPE_LABELS: Record<ApprovalType, string> = {
  technical: 'Technical',
  pricing: 'Pricing',
  commercial: 'Commercial',
  security_compliance: 'Security / Compliance',
  support_commitment: 'Support commitment',
  proposal_release: 'Proposal release',
  customer_acceptance: 'Customer acceptance',
  knowledge_publication: 'Knowledge publication',
  production_change: 'Production change',
}

// Project Approval Authorities, Stage 1 (docs/dev-request-project-approval-
// authorities.md): static, project-type-keyed suggestions, per the dev
// request's own "project characteristic -> suggested approval requirements"
// table. Recommendations are editable, not hidden rules -- the creator can
// remove or add any of them in the wizard step below.
const SUGGESTED_APPROVALS: Record<ProjectType, { approvalType: ApprovalType; reason: string }[]> = {
  consulting: [
    { approvalType: 'proposal_release', reason: 'Client/consulting projects typically share a proposal before work begins.' },
    { approvalType: 'commercial', reason: 'Commercial terms with a client usually need a second set of eyes.' },
    { approvalType: 'customer_acceptance', reason: 'Delivered work for a client is usually formally accepted.' },
  ],
  transformation: [
    { approvalType: 'technical', reason: 'Changes to internal systems benefit from a technical review.' },
    { approvalType: 'production_change', reason: 'This project changes production systems or workflows.' },
  ],
  experiment: [{ approvalType: 'technical', reason: 'Experiments usually get a lightweight technical review before wider use.' }],
  learning: [],
  knowledge: [{ approvalType: 'knowledge_publication', reason: 'Curated knowledge from this project may be published for others.' }],
}

interface Option {
  id: string
  label: string
}

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md): staged items
// reference each other by a client-generated tempId, not a real DB id --
// nothing has one until createProject's own insertStagedTree resolves them
// on submit.
interface StagedNode {
  tempId: string
  parentTempId: string | null
  name: string
  description: string
}
interface StagedWorkstream {
  tempId: string
  parentTempId: string | null
  name: string
  goal: string
  lifecycleStage: WorkstreamLifecycleStage | ''
}

export function ProjectWizard({
  knowledgeBases,
  evalDatasets,
  selectableUsers,
}: {
  knowledgeBases: Option[]
  evalDatasets: Option[]
  selectableUsers: UserOption[]
}) {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [name, setName] = useState('')
  const [objective, setObjective] = useState('')
  const [details, setDetails] = useState<Record<string, string>>({})
  const [knowledgeBaseId, setKnowledgeBaseId] = useState('')
  const [evalDatasetId, setEvalDatasetId] = useState('')

  // Builder Ontology, Part A -- "Domain objects & workstreams" step (step 3).
  // Fully editable local state; nothing writes to project_objects/
  // project_workstreams until final submit (same "suggest then let the user
  // edit" shape as the approvals step below).
  const [projectObjects, setProjectObjects] = useState<StagedNode[]>([])
  const [stagedWorkstreams, setStagedWorkstreams] = useState<StagedWorkstream[]>([])
  const [objectName, setObjectName] = useState('')
  const [objectParentTempId, setObjectParentTempId] = useState('')
  const [objectDescription, setObjectDescription] = useState('')
  const [workstreamName, setWorkstreamName] = useState('')
  const [workstreamParentTempId, setWorkstreamParentTempId] = useState('')
  const [workstreamGoal, setWorkstreamGoal] = useState('')
  const [suggesting, setSuggesting] = useState(false)
  const [suggestError, setSuggestError] = useState<string | null>(null)
  const [members, setMembers] = useState<{ email: string; role: ProjectRole }[]>([])
  const [memberEmail, setMemberEmail] = useState('')
  const [memberRole, setMemberRole] = useState<ProjectRole>('consultant')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Governance & Approvals (step 6). Seeded from SUGGESTED_APPROVALS once the
  // creator reaches this step (see the useEffect-free lazy-init below), then
  // freely editable -- suggestions are starting points, not hidden rules.
  const [approvals, setApprovals] = useState<
    { approvalType: ApprovalType; requirementStatus: 'required' | 'optional'; assigneeEmail: string }[]
  >([])
  const [approvalsSeeded, setApprovalsSeeded] = useState(false)

  function addStagedMember() {
    if (!memberEmail.trim()) return
    setMembers((prev) => [...prev, { email: memberEmail.trim(), role: memberRole }])
    setMemberEmail('')
  }

  function seedApprovalsIfNeeded() {
    if (approvalsSeeded || !projectType) return
    setApprovals(
      SUGGESTED_APPROVALS[projectType].map((s) => ({ approvalType: s.approvalType, requirementStatus: 'required', assigneeEmail: '' }))
    )
    setApprovalsSeeded(true)
  }

  function addApproval(approvalType: ApprovalType) {
    if (approvals.some((a) => a.approvalType === approvalType)) return
    setApprovals((prev) => [...prev, { approvalType, requirementStatus: 'required', assigneeEmail: '' }])
  }

  function removeApproval(approvalType: ApprovalType) {
    setApprovals((prev) => prev.filter((a) => a.approvalType !== approvalType))
  }

  function updateApproval(approvalType: ApprovalType, patch: Partial<{ requirementStatus: 'required' | 'optional'; assigneeEmail: string }>) {
    setApprovals((prev) => prev.map((a) => (a.approvalType === approvalType ? { ...a, ...patch } : a)))
  }

  function setDetail(key: string, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }))
  }

  function addProjectObject() {
    if (!objectName.trim()) return
    setProjectObjects((prev) => [
      ...prev,
      { tempId: crypto.randomUUID(), parentTempId: objectParentTempId || null, name: objectName.trim(), description: objectDescription.trim() },
    ])
    setObjectName('')
    setObjectParentTempId('')
    setObjectDescription('')
  }

  // Removing a staged node also clears any staged children's parentTempId
  // back to null (top-level), rather than leaving a dangling reference.
  function removeProjectObject(tempId: string) {
    setProjectObjects((prev) => prev.filter((n) => n.tempId !== tempId).map((n) => (n.parentTempId === tempId ? { ...n, parentTempId: null } : n)))
  }

  function addStagedWorkstream() {
    if (!workstreamName.trim()) return
    setStagedWorkstreams((prev) => [
      ...prev,
      {
        tempId: crypto.randomUUID(),
        parentTempId: workstreamParentTempId || null,
        name: workstreamName.trim(),
        goal: workstreamGoal.trim(),
        lifecycleStage: '',
      },
    ])
    setWorkstreamName('')
    setWorkstreamParentTempId('')
    setWorkstreamGoal('')
  }

  function removeStagedWorkstream(tempId: string) {
    setStagedWorkstreams((prev) =>
      prev.filter((w) => w.tempId !== tempId).map((w) => (w.parentTempId === tempId ? { ...w, parentTempId: null } : w))
    )
  }

  // Single-shot suggestion, appended into the same editable state as the
  // manual add-forms above -- no separate "accept" step, nothing written to
  // the DB here. Deliberately skips iterative clarifying Q&A for v1; the
  // user resolves ambiguity by hand in this same list.
  async function askEmberToSuggest() {
    if (!projectType) return
    setSuggesting(true)
    setSuggestError(null)
    try {
      const result = await suggestProjectOntologyAction({ projectType, objective, details })
      setProjectObjects((prev) => [
        ...prev,
        ...result.objects.map((o) => ({ tempId: o.tempId, parentTempId: o.parentTempId ?? null, name: o.name, description: o.description })),
      ])
      setStagedWorkstreams((prev) => [
        ...prev,
        ...result.workstreams.map((w) => ({
          tempId: w.tempId,
          parentTempId: w.parentTempId ?? null,
          name: w.name,
          goal: w.goal,
          lifecycleStage: '' as const,
        })),
      ])
    } catch (err) {
      setSuggestError(err instanceof Error ? err.message : 'Failed to get suggestions')
    } finally {
      setSuggesting(false)
    }
  }

  async function handleSubmit() {
    if (!projectType || !name) return
    setSubmitting(true)
    setError(null)
    try {
      const result = await createProjectAction({
        name,
        projectType,
        objective,
        details,
        knowledgeBaseId: knowledgeBaseId || null,
        evalDatasetId: evalDatasetId || null,
        members,
        approvals: approvals.map((a) => ({
          approvalType: a.approvalType,
          requirementStatus: a.requirementStatus,
          assigneeEmail: a.assigneeEmail || null,
        })),
        projectObjects: projectObjects.map((o) => ({
          tempId: o.tempId,
          parentTempId: o.parentTempId,
          name: o.name,
          slug: slugify(o.name),
          description: o.description || undefined,
        })),
        workstreams: stagedWorkstreams.map((w) => ({
          tempId: w.tempId,
          parentTempId: w.parentTempId,
          name: w.name,
          slug: slugify(w.name),
          goal: w.goal || undefined,
          lifecycleStage: w.lifecycleStage || undefined,
        })),
      })
      router.push(`/projects/${result.projectId}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project')
      setSubmitting(false)
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div className="flex gap-1 text-xs text-zinc-500">
        {WIZARD_STEPS.map((label, i) => (
          <div key={label} className={`flex-1 border-b-2 pb-2 ${step === i + 1 ? 'border-zinc-900 font-medium text-zinc-900' : 'border-zinc-200'}`}>
            {i + 1}. {label}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="flex flex-col gap-2">
          {PROJECT_TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setProjectType(t.value)}
              className={`rounded border p-3 text-left ${projectType === t.value ? 'border-zinc-900 bg-zinc-50' : 'border-zinc-200 hover:border-zinc-400'}`}
            >
              <div className="font-medium">{t.label}</div>
              <div className="text-sm text-zinc-500">{t.description}</div>
            </button>
          ))}
          <button
            disabled={!projectType}
            onClick={() => setStep(2)}
            className="mt-2 self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Project name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Objective</span>
            <textarea rows={2} value={objective} onChange={(e) => setObjective(e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
          </label>

          {projectType === 'experiment' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">What is your hypothesis?</span>
                <input onChange={(e) => setDetail('hypothesis', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">What result would justify the change?</span>
                <input onChange={(e) => setDetail('success_criteria', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
            </>
          )}
          {projectType === 'consulting' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">What business problem are you solving?</span>
                <input onChange={(e) => setDetail('business_problem', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">What outcome matters?</span>
                <input onChange={(e) => setDetail('target_outcome', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
            </>
          )}
          {projectType === 'transformation' && (
            <>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Current pain point</span>
                <input onChange={(e) => setDetail('pain_point', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-sm font-medium">Baseline metric</span>
                <input onChange={(e) => setDetail('baseline_metric', e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm" />
              </label>
            </>
          )}

          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button disabled={!name} onClick={() => setStep(3)} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600">
            The domain object types and starting workstreams for this project -- e.g. &ldquo;Plane&rdquo;/&ldquo;Route&rdquo; for an
            airline client, or &ldquo;Sensor&rdquo;/&ldquo;AnomalyEvent&rdquo; for a monitoring client. Optional -- skip if it doesn&apos;t
            fit this project.
          </p>
          <button
            type="button"
            disabled={suggesting}
            onClick={askEmberToSuggest}
            className="self-start rounded border border-zinc-300 px-4 py-2 text-sm disabled:opacity-50"
          >
            {suggesting ? 'Asking Ember…' : 'Ask Ember to suggest'}
          </button>
          {suggestError && <p className="text-sm text-red-600">{suggestError}</p>}

          <div>
            <span className="text-sm font-medium">Objects</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                value={objectName}
                onChange={(e) => setObjectName(e.target.value)}
                placeholder="Name (e.g. Sensor)"
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <select value={objectParentTempId} onChange={(e) => setObjectParentTempId(e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
                <option value="">No parent (top-level)</option>
                {projectObjects.map((o) => (
                  <option key={o.tempId} value={o.tempId}>
                    {o.name}
                  </option>
                ))}
              </select>
              <input
                value={objectDescription}
                onChange={(e) => setObjectDescription(e.target.value)}
                placeholder="Description (optional)"
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <button type="button" onClick={addProjectObject} className="rounded border border-zinc-300 px-4 py-2 text-sm">
                Add
              </button>
            </div>
            {projectObjects.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {projectObjects.map((o) => (
                  <li key={o.tempId} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-1.5">
                    <span>
                      {o.parentTempId && <span className="text-zinc-400">↳ </span>}
                      {o.name}
                      {o.description && <span className="text-zinc-500"> — {o.description}</span>}
                    </span>
                    <button type="button" onClick={() => removeProjectObject(o.tempId)} className="text-xs text-red-600 underline">
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <span className="text-sm font-medium">Workstreams</span>
            <div className="mt-1 flex flex-wrap gap-2">
              <input
                value={workstreamName}
                onChange={(e) => setWorkstreamName(e.target.value)}
                placeholder="Name (e.g. Edge Inference)"
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <select
                value={workstreamParentTempId}
                onChange={(e) => setWorkstreamParentTempId(e.target.value)}
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              >
                <option value="">No parent (top-level)</option>
                {stagedWorkstreams.map((w) => (
                  <option key={w.tempId} value={w.tempId}>
                    {w.name}
                  </option>
                ))}
              </select>
              <input
                value={workstreamGoal}
                onChange={(e) => setWorkstreamGoal(e.target.value)}
                placeholder="Goal (optional)"
                className="rounded border border-zinc-300 px-3 py-2 text-sm"
              />
              <button type="button" onClick={addStagedWorkstream} className="rounded border border-zinc-300 px-4 py-2 text-sm">
                Add
              </button>
            </div>
            {stagedWorkstreams.length > 0 && (
              <ul className="mt-2 flex flex-col gap-1 text-sm">
                {stagedWorkstreams.map((w) => (
                  <li key={w.tempId} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-1.5">
                    <span>
                      {w.parentTempId && <span className="text-zinc-400">↳ </span>}
                      {w.name}
                      {w.goal && <span className="text-zinc-500"> — {w.goal}</span>}
                    </span>
                    <div className="flex items-center gap-2">
                      <select
                        value={w.lifecycleStage}
                        onChange={(e) =>
                          setStagedWorkstreams((prev) =>
                            prev.map((x) => (x.tempId === w.tempId ? { ...x, lifecycleStage: e.target.value as WorkstreamLifecycleStage | '' } : x))
                          )
                        }
                        className="rounded border border-zinc-300 px-1.5 py-1 text-xs"
                      >
                        <option value="">Lifecycle stage…</option>
                        {(Object.keys(LIFECYCLE_STAGE_LABELS) as WorkstreamLifecycleStage[]).map((s) => (
                          <option key={s} value={s}>
                            {LIFECYCLE_STAGE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                      <button type="button" onClick={() => removeStagedWorkstream(w.tempId)} className="text-xs text-red-600 underline">
                        Remove
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button onClick={() => setStep(4)} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Next</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="flex flex-col gap-4">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked readOnly />
            Use Platform Knowledge (AI Engineering Wiki)
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Attach an existing project knowledge base (optional)</span>
            <select value={knowledgeBaseId} onChange={(e) => setKnowledgeBaseId(e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
              <option value="">None</option>
              {knowledgeBases.map((kb) => (
                <option key={kb.id} value={kb.id}>{kb.label}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button onClick={() => setStep(5)} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Next</button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Benchmark (optional)</span>
            <select value={evalDatasetId} onChange={(e) => setEvalDatasetId(e.target.value)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
              <option value="">No benchmark yet</option>
              {evalDatasets.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          </label>
          <div className="flex gap-2">
            <button onClick={() => setStep(4)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button onClick={() => setStep(6)} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">Next</button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600">You become the project Owner automatically. Add anyone else who needs access.</p>
          <div className="flex gap-2">
            <UserPicker
              users={selectableUsers}
              value={memberEmail}
              onChange={setMemberEmail}
              excludeEmails={members.map((m) => m.email)}
              className="flex-1"
            />
            <select value={memberRole} onChange={(e) => setMemberRole(e.target.value as ProjectRole)} className="rounded border border-zinc-300 px-3 py-2 text-sm">
              {TEAM_ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <button type="button" onClick={addStagedMember} className="rounded border border-zinc-300 px-4 py-2 text-sm">
              Add
            </button>
          </div>
          {members.length > 0 && (
            <ul className="flex flex-col gap-1 text-sm">
              {members.map((m, i) => (
                <li key={`${m.email}-${i}`} className="flex items-center justify-between rounded border border-zinc-200 px-3 py-1.5">
                  <span>
                    {m.email} <span className="text-zinc-500">— {m.role}</span>
                  </span>
                  <button
                    type="button"
                    onClick={() => setMembers((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-600 underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(5)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button
              onClick={() => {
                seedApprovalsIfNeeded()
                setStep(7)
              }}
              className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {step === 7 && (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-zinc-600">
            Based on the project type, these approvals are likely relevant. Remove any that don&apos;t apply, or add more. Assigning an
            authority is optional here -- an unassigned requirement is saved as a visible <span className="font-medium">Authority needed</span> gap,
            not a blocker.
          </p>

          {approvals.length > 0 && (
            <ul className="flex flex-col gap-3">
              {approvals.map((a) => (
                <li key={a.approvalType} className="rounded border border-zinc-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{APPROVAL_TYPE_LABELS[a.approvalType]}</span>
                    <button type="button" onClick={() => removeApproval(a.approvalType)} className="text-xs text-red-600 underline">
                      Remove
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <select
                      value={a.requirementStatus}
                      onChange={(e) => updateApproval(a.approvalType, { requirementStatus: e.target.value as 'required' | 'optional' })}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                    >
                      <option value="required">Required</option>
                      <option value="optional">Optional</option>
                    </select>
                    <select
                      value={a.assigneeEmail}
                      onChange={(e) => updateApproval(a.approvalType, { assigneeEmail: e.target.value })}
                      className="rounded border border-zinc-300 px-2 py-1 text-sm"
                    >
                      <option value="">Authority needed (unassigned)</option>
                      <option value="__self__">Me (project owner)</option>
                      {members
                        .filter((m) => m.email)
                        .map((m) => (
                          <option key={m.email} value={m.email}>
                            {m.email}
                          </option>
                        ))}
                    </select>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium">Add another approval type</span>
            <select
              value=""
              onChange={(e) => {
                if (e.target.value) addApproval(e.target.value as ApprovalType)
              }}
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {(Object.keys(APPROVAL_TYPE_LABELS) as ApprovalType[])
                .filter((t) => !approvals.some((a) => a.approvalType === t))
                .map((t) => (
                  <option key={t} value={t}>
                    {APPROVAL_TYPE_LABELS[t]}
                  </option>
                ))}
            </select>
          </label>

          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button onClick={() => setStep(6)} className="rounded border border-zinc-300 px-4 py-2 text-sm">Back</button>
            <button disabled={submitting} onClick={handleSubmit} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create project'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
