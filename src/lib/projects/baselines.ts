import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import { createProjectNote } from '@/lib/projects/notes'
import { RequirementValidationError } from '@/lib/projects/requirements'
import { rollUpVerification } from '@/lib/projects/verification'
import type {
  ConformanceApprovalType,
  ConformanceDecisionType,
  ConformanceSnapshot,
  Database,
  RequirementAppliesFrom,
  RequirementStatus,
  RequirementVerificationStatus,
  SolutionConformanceDecision,
  SolutionConformanceDecisionApproval,
  SolutionEvaluationBaseline,
  SolutionVerificationRecord,
  SolutionWaiver,
  WaiverKind,
} from '@/types/database'

// Solution conformance and acceptance evaluation, Stage 3 (docs/dev-request-
// solution-conformance-and-acceptance-evaluation.md): evaluation baselines,
// waivers and conformance decisions. The database
// (20261020100001_solution_baselines_and_decisions.sql) enforces every rule:
// draft-only baseline edits, activation, who may approve (the Project's
// approval policies and authority assignments), self-approval, and the
// snapshot a decision keeps. These functions add the roll-up, clear
// messages and notifications.

const DECISION_TYPES: ConformanceDecisionType[] = [
  'presales_claim_validation',
  'factory_acceptance',
  'site_acceptance',
  'customer_acceptance',
  'go_live',
  'post_change_reverification',
]
const APPROVAL_TYPES: ConformanceApprovalType[] = ['technical', 'security_compliance', 'customer_acceptance', 'production_change']
const STAGES: RequirementAppliesFrom[] = ['presales', 'deployment', 'management_maintenance']

// --- Roll-up (pure) ------------------------------------------------------------------

// A requirement's standing in a baseline: its verification status, or
// 'waived' when an approved waiver covers it and it has not passed.
export type BaselineRequirementStatus = RequirementVerificationStatus | 'waived'

export interface BaselineRollUp {
  statuses: Map<string, BaselineRequirementStatus>
  counts: { total: number; passed: number; failed: number; conditional: number; waived: number; notApplicable: number; notVerified: number }
}

type RollUpRecord = Pick<SolutionVerificationRecord, 'id' | 'method_id' | 'result' | 'performed_on' | 'recorded_at' | 'supersedes_id'>

export function rollUpBaseline(
  requirements: { requirementId: string; methodIds: string[]; records: RollUpRecord[]; waived: boolean }[]
): BaselineRollUp {
  const statuses = new Map<string, BaselineRequirementStatus>()
  for (const r of requirements) {
    const verification = rollUpVerification(r.methodIds, r.records)
    statuses.set(r.requirementId, r.waived && verification !== 'passed' ? 'waived' : verification)
  }
  const values = [...statuses.values()]
  const count = (...s: BaselineRequirementStatus[]) => values.filter((v) => s.includes(v)).length
  return {
    statuses,
    counts: {
      total: values.length,
      passed: count('passed'),
      failed: count('failed'),
      conditional: count('conditional'),
      waived: count('waived'),
      notApplicable: count('not_applicable'),
      notVerified: count('not_verified', 'partial', 'no_method'),
    },
  }
}

// The roll-up a decision rested on, rebuilt from its snapshot: the records
// it names are immutable, so this reads the same forever.
export function rollUpSnapshot(snapshot: ConformanceSnapshot, recordsById: Map<string, RollUpRecord>): BaselineRollUp {
  return rollUpBaseline(
    snapshot.requirements.map((r) => ({
      requirementId: r.requirement_id,
      methodIds: r.method_ids,
      records: r.record_ids.map((id) => recordsById.get(id)).filter((x): x is RollUpRecord => !!x),
      waived: !!r.waiver_id,
    }))
  )
}

// --- Reading -------------------------------------------------------------------------

export interface BaselineListRow extends SolutionEvaluationBaseline {
  itemCount: number
  latestDecision: Pick<SolutionConformanceDecision, 'decision_type' | 'status'> | null
}

export async function listBaselines(supabase: SupabaseClient<Database>, projectId: string): Promise<BaselineListRow[]> {
  const [{ data: baselines, error }, { data: items }, { data: decisions }] = await Promise.all([
    supabase.from('solution_evaluation_baselines').select('*').eq('project_id', projectId).order('name').order('version', { ascending: false }),
    supabase.from('solution_evaluation_baseline_items').select('baseline_id').eq('project_id', projectId),
    supabase
      .from('solution_conformance_decisions')
      .select('baseline_id, decision_type, status, requested_at')
      .eq('project_id', projectId)
      .order('requested_at', { ascending: false }),
  ])
  if (error) throw error
  return (baselines ?? []).map((b) => {
    const latest = (decisions ?? []).find((d) => d.baseline_id === b.id)
    return {
      ...b,
      itemCount: (items ?? []).filter((i) => i.baseline_id === b.id).length,
      latestDecision: latest ? { decision_type: latest.decision_type, status: latest.status } : null,
    }
  })
}

export interface BaselineRequirementRow {
  id: string
  code: string
  title: string
  status: RequirementStatus
  supersededBy: string | null
}

export interface DecisionView extends SolutionConformanceDecision {
  approvals: (SolutionConformanceDecisionApproval & { approverEmail: string | null })[]
  requestedByEmail: string | null
  // Rebuilt from the snapshot once decided.
  decidedRollUp: BaselineRollUp | null
}

export interface WaiverView extends SolutionWaiver {
  requirementCode: string
  requestedByEmail: string | null
  decidedByEmail: string | null
}

export interface BaselineDetail {
  baseline: SolutionEvaluationBaseline
  versions: Pick<SolutionEvaluationBaseline, 'id' | 'version' | 'status'>[]
  requirements: BaselineRequirementRow[]
  rollUp: BaselineRollUp
  waivers: WaiverView[]
  decisions: DecisionView[]
}

export async function getBaseline(supabase: SupabaseClient<Database>, projectId: string, baselineId: string): Promise<BaselineDetail | null> {
  const { data: baseline, error } = await supabase
    .from('solution_evaluation_baselines')
    .select('*')
    .eq('id', baselineId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!baseline) return null

  const [{ data: versions }, { data: items }, { data: waivers }, { data: decisions }] = await Promise.all([
    supabase
      .from('solution_evaluation_baselines')
      .select('id, version, status')
      .eq('project_id', projectId)
      .eq('name', baseline.name)
      .order('version', { ascending: false }),
    supabase.from('solution_evaluation_baseline_items').select('requirement_id').eq('baseline_id', baselineId),
    supabase.from('solution_waivers').select('*').eq('baseline_id', baselineId).order('requested_at', { ascending: false }),
    supabase.from('solution_conformance_decisions').select('*').eq('baseline_id', baselineId).order('requested_at', { ascending: false }),
  ])
  const requirementIds = (items ?? []).map((i) => i.requirement_id)
  const decisionIds = (decisions ?? []).map((d) => d.id)
  const snapshotRecordIds = [...new Set((decisions ?? []).flatMap((d) => d.snapshot?.requirements.flatMap((r) => r.record_ids) ?? []))]

  const [{ data: requirements }, { data: methods }, { data: records }, { data: snapshotRecords }, { data: approvals }] = await Promise.all([
    requirementIds.length
      ? supabase.from('solution_requirements').select('id, code, title, status, superseded_by').in('id', requirementIds).order('code')
      : Promise.resolve({ data: [] }),
    requirementIds.length
      ? supabase.from('solution_verification_methods').select('id, requirement_id').in('requirement_id', requirementIds)
      : Promise.resolve({ data: [] }),
    requirementIds.length
      ? supabase
          .from('solution_verification_records')
          .select('id, requirement_id, method_id, result, performed_on, recorded_at, supersedes_id')
          .in('requirement_id', requirementIds)
      : Promise.resolve({ data: [] }),
    snapshotRecordIds.length
      ? supabase.from('solution_verification_records').select('id, method_id, result, performed_on, recorded_at, supersedes_id').in('id', snapshotRecordIds)
      : Promise.resolve({ data: [] }),
    decisionIds.length
      ? supabase.from('solution_conformance_decision_approvals').select('*').in('decision_id', decisionIds).order('created_at')
      : Promise.resolve({ data: [] }),
  ])

  const approvedWaivers = new Set((waivers ?? []).filter((w) => w.status === 'approved').map((w) => w.requirement_id))
  const rollUp = rollUpBaseline(
    requirementIds.map((id) => ({
      requirementId: id,
      methodIds: (methods ?? []).filter((m: { requirement_id: string }) => m.requirement_id === id).map((m: { id: string }) => m.id),
      records: ((records ?? []) as (RollUpRecord & { requirement_id: string })[]).filter((r) => r.requirement_id === id),
      waived: approvedWaivers.has(id),
    }))
  )
  const snapshotRecordById = new Map(((snapshotRecords ?? []) as RollUpRecord[]).map((r) => [r.id, r]))

  // Emails are for display only (same narrow admin-client pattern as the
  // Project page); every row was read under RLS above.
  const peopleIds = [
    ...new Set(
      [
        ...(waivers ?? []).flatMap((w) => [w.requested_by, w.decided_by]),
        ...(decisions ?? []).map((d) => d.requested_by),
        ...((approvals ?? []) as SolutionConformanceDecisionApproval[]).map((a) => a.approver_id),
      ].filter((x): x is string => !!x)
    ),
  ]
  const { data: people } = peopleIds.length ? await createAdminClient().from('profiles').select('id, email').in('id', peopleIds) : { data: [] }
  const email = new Map((people ?? []).map((p) => [p.id, p.email]))
  const emailOf = (id: string | null) => (id ? (email.get(id) ?? null) : null)
  const requirementRows = (requirements ?? []) as { id: string; code: string; title: string; status: RequirementStatus; superseded_by: string | null }[]
  const codeOf = new Map(requirementRows.map((r) => [r.id, r.code]))

  return {
    baseline,
    versions: versions ?? [],
    requirements: requirementRows.map((r) => ({
      id: r.id,
      code: r.code,
      title: r.title,
      status: r.status,
      supersededBy: r.superseded_by,
    })),
    rollUp,
    waivers: (waivers ?? []).map((w) => ({
      ...w,
      requirementCode: codeOf.get(w.requirement_id) ?? 'Requirement',
      requestedByEmail: emailOf(w.requested_by),
      decidedByEmail: emailOf(w.decided_by),
    })),
    decisions: (decisions ?? []).map((d) => ({
      ...d,
      approvals: ((approvals ?? []) as SolutionConformanceDecisionApproval[])
        .filter((a) => a.decision_id === d.id)
        .map((a) => ({ ...a, approverEmail: emailOf(a.approver_id) })),
      requestedByEmail: emailOf(d.requested_by),
      decidedRollUp: d.snapshot ? rollUpSnapshot(d.snapshot, snapshotRecordById) : null,
    })),
  }
}

// Open requirements of the Project, for adding to a draft baseline.
export async function listBaselineCandidates(supabase: SupabaseClient<Database>, projectId: string) {
  const [{ data: requirements }, { data: methods }] = await Promise.all([
    supabase.from('solution_requirements').select('id, code, title, status').eq('project_id', projectId).in('status', ['draft', 'baselined']).order('code'),
    supabase.from('solution_verification_methods').select('requirement_id').eq('project_id', projectId),
  ])
  const withMethod = new Set((methods ?? []).map((m) => m.requirement_id))
  return (requirements ?? []).map((r) => ({ ...r, hasMethod: withMethod.has(r.id) }))
}

// The approval types the viewer currently holds in this Project (active,
// in date) -- which Approve buttons to show. The database checks again.
export async function listMyAuthorities(supabase: SupabaseClient<Database>, projectId: string, userId: string): Promise<Set<ConformanceApprovalType>> {
  const { data } = await supabase
    .from('project_authority_assignments')
    .select('approval_type, status, effective_from, expires_at')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('status', 'active')
  const now = Date.now()
  return new Set(
    (data ?? [])
      .filter((a) => new Date(a.effective_from).getTime() <= now && (!a.expires_at || new Date(a.expires_at).getTime() > now))
      .map((a) => a.approval_type)
      .filter((t): t is ConformanceApprovalType => (APPROVAL_TYPES as string[]).includes(t))
  )
}

// Which baselines a requirement is in, for the requirement page.
export async function listBaselinesForRequirement(supabase: SupabaseClient<Database>, requirementId: string) {
  const { data: items } = await supabase.from('solution_evaluation_baseline_items').select('baseline_id').eq('requirement_id', requirementId)
  const ids = (items ?? []).map((i) => i.baseline_id)
  if (ids.length === 0) return []
  const { data } = await supabase.from('solution_evaluation_baselines').select('id, name, version, status').in('id', ids).order('name')
  return data ?? []
}

// --- Writing -------------------------------------------------------------------------

function clean(value: string | undefined | null, max = 4000): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

const FUNCTION_PREFIX =
  /^(activate_solution_baseline|new_solution_baseline_version|request_solution_waiver|decide_solution_waiver|withdraw_solution_waiver|request_solution_conformance_decision|decide_solution_conformance_decision|withdraw_solution_conformance_decision|solution_evaluation_baselines|solution_evaluation_baseline_items): ([\s\S]+)$/

// The database's refusals are written to be read; show them without the
// function name.
function rethrow(err: unknown): never {
  const e = err as { code?: string; message?: string } | null
  const match = FUNCTION_PREFIX.exec(e?.message ?? '')
  if (match) {
    const text = match[2].replace(/''/g, '’').replace(/'/g, '’')
    throw new RequirementValidationError(text.charAt(0).toUpperCase() + text.slice(1))
  }
  if (e?.code === '23505') throw new RequirementValidationError('A baseline with that name already exists in this Project')
  if (e?.code === '42501') throw new RequirementValidationError('Only a draft baseline can be changed, by this Project’s owner or curators')
  throw err
}

async function requireCurator(ctx: WorkbenchCallerContext, projectId: string) {
  if (ctx.profile.role === 'admin') return
  const role = await getActiveProjectRole(ctx, projectId)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError("Requires this project's owner or curator role (or platform admin) to manage baselines and request decisions")
  }
}

async function loadBaseline(ctx: WorkbenchCallerContext, baselineId: string): Promise<SolutionEvaluationBaseline> {
  const { data, error } = await ctx.supabase.from('solution_evaluation_baselines').select('*').eq('id', baselineId).maybeSingle()
  if (error) throw error
  if (!data) throw new RequirementValidationError('That baseline could not be found')
  return data
}

export interface BaselineFieldsInput {
  name: string
  purpose: ConformanceDecisionType
  lifecycleStage: RequirementAppliesFrom
  description?: string
}

function validateBaselineFields(input: BaselineFieldsInput) {
  const name = clean(input.name, 200)
  if (!name) throw new RequirementValidationError('A name is required')
  if (!DECISION_TYPES.includes(input.purpose)) throw new RequirementValidationError('Choose what the baseline is for')
  if (!STAGES.includes(input.lifecycleStage)) throw new RequirementValidationError('Choose the lifecycle stage')
  return { name, description: clean(input.description) }
}

export async function createBaseline(ctx: WorkbenchCallerContext, projectId: string, input: BaselineFieldsInput & { requirementIds?: string[] }) {
  await requireCurator(ctx, projectId)
  const fields = validateBaselineFields(input)
  const { data, error } = await ctx.supabase
    .from('solution_evaluation_baselines')
    .insert({ project_id: projectId, name: fields.name, purpose: input.purpose, lifecycle_stage: input.lifecycleStage, description: fields.description, created_by: ctx.user.id })
    .select('id')
    .single()
  if (error || !data) rethrow(error ?? new Error('Could not create the baseline'))
  if (input.requirementIds?.length) await setBaselineItems(ctx, data.id, input.requirementIds)
  return { projectId, baselineId: data.id }
}

export async function updateBaseline(ctx: WorkbenchCallerContext, baselineId: string, input: BaselineFieldsInput) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  const fields = validateBaselineFields(input)
  const { error } = await ctx.supabase
    .from('solution_evaluation_baselines')
    .update({ name: fields.name, purpose: input.purpose, lifecycle_stage: input.lifecycleStage, description: fields.description })
    .eq('id', baselineId)
  if (error) rethrow(error)
  return { projectId: baseline.project_id }
}

export async function deleteDraftBaseline(ctx: WorkbenchCallerContext, baselineId: string) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  if (baseline.status !== 'draft') throw new RequirementValidationError('Only a draft baseline can be deleted')
  const { error } = await ctx.supabase.from('solution_evaluation_baselines').delete().eq('id', baselineId)
  if (error) rethrow(error)
  return { projectId: baseline.project_id }
}

// Replaces a draft baseline's requirements with this set.
export async function setBaselineItems(ctx: WorkbenchCallerContext, baselineId: string, requirementIds: string[]) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  if (baseline.status !== 'draft') throw new RequirementValidationError('An active baseline is frozen. Create a new version to change it.')
  const { data: existing } = await ctx.supabase.from('solution_evaluation_baseline_items').select('requirement_id').eq('baseline_id', baselineId)
  const current = new Set((existing ?? []).map((i) => i.requirement_id))
  const wanted = new Set(requirementIds.filter(Boolean))
  const toRemove = [...current].filter((id) => !wanted.has(id))
  const toAdd = [...wanted].filter((id) => !current.has(id))
  if (toRemove.length) {
    const { error } = await ctx.supabase.from('solution_evaluation_baseline_items').delete().eq('baseline_id', baselineId).in('requirement_id', toRemove)
    if (error) rethrow(error)
  }
  if (toAdd.length) {
    const { error } = await ctx.supabase
      .from('solution_evaluation_baseline_items')
      .insert(toAdd.map((requirementId) => ({ baseline_id: baselineId, project_id: baseline.project_id, requirement_id: requirementId, added_by: ctx.user.id })))
    if (error) rethrow(error)
  }
  return { projectId: baseline.project_id }
}

export async function activateBaseline(ctx: WorkbenchCallerContext, baselineId: string) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  const { error } = await ctx.supabase.rpc('activate_solution_baseline', { p_baseline_id: baselineId })
  if (error) rethrow(error)
  return { projectId: baseline.project_id }
}

export async function newBaselineVersion(ctx: WorkbenchCallerContext, baselineId: string) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  const { data, error } = await ctx.supabase.rpc('new_solution_baseline_version', { p_baseline_id: baselineId })
  if (error || !data) rethrow(error ?? new Error('Could not create the new version'))
  return { projectId: baseline.project_id, baselineId: data }
}

// Notifies the current holders of an approval type (best effort: a failed
// note never undoes the request).
async function notifyAuthorities(
  ctx: WorkbenchCallerContext,
  projectId: string,
  approvalType: ConformanceApprovalType,
  contextType: string,
  contextId: string,
  subject: string,
  body: string
) {
  const { data: holders } = await ctx.supabase
    .from('project_authority_assignments')
    .select('user_id, effective_from, expires_at')
    .eq('project_id', projectId)
    .eq('approval_type', approvalType)
    .eq('status', 'active')
  const now = Date.now()
  const recipients = new Set(
    (holders ?? [])
      .filter((h) => new Date(h.effective_from).getTime() <= now && (!h.expires_at || new Date(h.expires_at).getTime() > now))
      .map((h) => h.user_id)
  )
  for (const recipientUserId of recipients) {
    if (recipientUserId === ctx.user.id) continue
    try {
      await createProjectNote(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
        projectId,
        recipientType: 'user',
        recipientUserId,
        subject,
        body,
        contextType,
        contextId,
      })
    } catch (err) {
      console.error(`Failed to notify ${recipientUserId} about ${contextType} ${contextId}:`, err)
    }
  }
}

export interface WaiverInput {
  requirementId: string
  kind: WaiverKind
  rationale: string
  conditions?: string
  approvalType: ConformanceApprovalType
}

export async function requestWaiver(ctx: WorkbenchCallerContext, baselineId: string, input: WaiverInput) {
  const baseline = await loadBaseline(ctx, baselineId)
  if (input.kind !== 'waiver' && input.kind !== 'deviation') throw new RequirementValidationError('Choose waiver or deviation')
  if (!APPROVAL_TYPES.includes(input.approvalType)) throw new RequirementValidationError('Choose who must approve it')
  const rationale = clean(input.rationale)
  if (!rationale) throw new RequirementValidationError('A waiver needs a rationale')
  const { data: waiverId, error } = await ctx.supabase.rpc('request_solution_waiver', {
    p_baseline_id: baselineId,
    p_requirement_id: input.requirementId,
    p_kind: input.kind,
    p_rationale: rationale,
    p_approval_type: input.approvalType,
    p_conditions: clean(input.conditions),
  })
  if (error || !waiverId) rethrow(error ?? new Error('Could not request the waiver'))
  await notifyAuthorities(
    ctx,
    baseline.project_id,
    input.approvalType,
    'solution_waiver',
    waiverId,
    `A ${input.kind} needs your approval`,
    `A ${input.kind} was requested in the baseline "${baseline.name}" (v${baseline.version}): ${rationale.slice(0, 300)}. Review it on the baseline page.`
  )
  return { projectId: baseline.project_id }
}

export async function decideWaiver(ctx: WorkbenchCallerContext, waiverId: string, approve: boolean, note?: string) {
  const { data: waiver } = await ctx.supabase.from('solution_waivers').select('project_id').eq('id', waiverId).maybeSingle()
  if (!waiver) throw new RequirementValidationError('That waiver could not be found')
  const { error } = await ctx.supabase.rpc('decide_solution_waiver', { p_waiver_id: waiverId, p_approve: approve, p_note: clean(note) })
  if (error) rethrow(error)
  return { projectId: waiver.project_id }
}

export async function withdrawWaiver(ctx: WorkbenchCallerContext, waiverId: string) {
  const { data: waiver } = await ctx.supabase.from('solution_waivers').select('project_id').eq('id', waiverId).maybeSingle()
  if (!waiver) throw new RequirementValidationError('That waiver could not be found')
  const { error } = await ctx.supabase.rpc('withdraw_solution_waiver', { p_waiver_id: waiverId })
  if (error) rethrow(error)
  return { projectId: waiver.project_id }
}

export interface DecisionRequestInput {
  decisionType: ConformanceDecisionType
  approvalType: ConformanceApprovalType
  note?: string
}

export async function requestDecision(ctx: WorkbenchCallerContext, baselineId: string, input: DecisionRequestInput) {
  const baseline = await loadBaseline(ctx, baselineId)
  await requireCurator(ctx, baseline.project_id)
  if (!DECISION_TYPES.includes(input.decisionType)) throw new RequirementValidationError('Choose the kind of decision')
  if (!APPROVAL_TYPES.includes(input.approvalType)) throw new RequirementValidationError('Choose who must approve it')
  const { data: decisionId, error } = await ctx.supabase.rpc('request_solution_conformance_decision', {
    p_baseline_id: baselineId,
    p_decision_type: input.decisionType,
    p_approval_type: input.approvalType,
    p_note: clean(input.note),
  })
  if (error || !decisionId) rethrow(error ?? new Error('Could not request the decision'))
  await notifyAuthorities(
    ctx,
    baseline.project_id,
    input.approvalType,
    'solution_decision',
    decisionId,
    'A conformance decision needs your approval',
    `A decision was requested over the baseline "${baseline.name}" (v${baseline.version}). Review the verification roll-up and give your verdict on the baseline page.`
  )
  return { projectId: baseline.project_id }
}

export async function decideDecision(ctx: WorkbenchCallerContext, decisionId: string, input: { approve: boolean; note?: string; conditions?: string }) {
  const { data: decision } = await ctx.supabase.from('solution_conformance_decisions').select('project_id').eq('id', decisionId).maybeSingle()
  if (!decision) throw new RequirementValidationError('That decision could not be found')
  if (!input.approve && !clean(input.note)) throw new RequirementValidationError('Say why you are rejecting it')
  const { error } = await ctx.supabase.rpc('decide_solution_conformance_decision', {
    p_decision_id: decisionId,
    p_approve: input.approve,
    p_note: clean(input.note),
    p_conditions: clean(input.conditions),
  })
  if (error) rethrow(error)
  return { projectId: decision.project_id }
}

export async function withdrawDecision(ctx: WorkbenchCallerContext, decisionId: string) {
  const { data: decision } = await ctx.supabase.from('solution_conformance_decisions').select('project_id').eq('id', decisionId).maybeSingle()
  if (!decision) throw new RequirementValidationError('That decision could not be found')
  const { error } = await ctx.supabase.rpc('withdraw_solution_conformance_decision', { p_decision_id: decisionId })
  if (error) rethrow(error)
  return { projectId: decision.project_id }
}
