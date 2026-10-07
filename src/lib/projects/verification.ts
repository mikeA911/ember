import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import { RequirementValidationError } from '@/lib/projects/requirements'
import type { CriterionCheck } from '@/lib/projects/criteria'
import type {
  Database,
  RequirementVerificationStatus,
  SolutionVerificationMethod,
  SolutionVerificationRecord,
  VerificationEnvironment,
  VerificationResult,
  WorkstreamArtifact,
} from '@/types/database'

// Solution conformance and acceptance evaluation, Stage 2 (docs/dev-request-
// solution-conformance-and-acceptance-evaluation.md): verification records.
// Records are append-only and written only through the database function
// record_solution_verification() (20261019100001_solution_verification_
// records.sql), which saves a record with its evidence and enforces the
// rules; these functions add clear messages and the roll-up.

const RESULTS: VerificationResult[] = ['pass', 'fail', 'conditional_pass', 'not_run', 'not_applicable']
const ENVIRONMENTS: VerificationEnvironment[] = ['lab', 'factory', 'staging', 'site', 'production', 'vendor', 'other']

// --- Roll-up (pure) ------------------------------------------------------------------

export type { RequirementVerificationStatus }

// Where a requirement stands on its current verification methods:
//   no_method      -- nothing to verify against yet
//   not_verified   -- no current result on any method
//   failed         -- any method's current result is a fail
//   passed         -- every method passed (or is not applicable), at least one pass
//   conditional    -- every method passed, conditionally passed or is not applicable
//   not_applicable -- every method is not applicable
//   partial        -- some results, but not every method is settled
type RecordForRollUp = Pick<SolutionVerificationRecord, 'id' | 'method_id' | 'result' | 'performed_on' | 'recorded_at' | 'supersedes_id'>

// A record is in effect until a correction supersedes it.
export function effectiveRecords<T extends RecordForRollUp>(records: T[]): T[] {
  const superseded = new Set(records.map((r) => r.supersedes_id).filter((x): x is string => !!x))
  return records.filter((r) => !superseded.has(r.id))
}

const newestFirst = (a: RecordForRollUp, b: RecordForRollUp) =>
  b.performed_on.localeCompare(a.performed_on) || b.recorded_at.localeCompare(a.recorded_at)

// The latest result in effect for each method: by the date it was performed,
// then by when it was recorded.
export function currentResultByMethod<T extends RecordForRollUp>(records: T[]): Map<string, T> {
  const current = new Map<string, T>()
  for (const record of [...effectiveRecords(records)].sort(newestFirst)) {
    if (record.method_id && !current.has(record.method_id)) current.set(record.method_id, record)
  }
  return current
}

export function rollUpVerification(methodIds: string[], records: RecordForRollUp[]): RequirementVerificationStatus {
  if (methodIds.length === 0) return 'no_method'
  const current = currentResultByMethod(records)
  const results = methodIds.map((id) => current.get(id)?.result)
  if (results.every((r) => r === undefined)) return 'not_verified'
  if (results.includes('fail')) return 'failed'
  if (results.every((r) => r === 'not_applicable')) return 'not_applicable'
  if (results.every((r) => r === 'pass' || r === 'not_applicable')) return 'passed'
  if (results.every((r) => r === 'pass' || r === 'conditional_pass' || r === 'not_applicable')) return 'conditional'
  return 'partial'
}

// Verification status for every requirement in a Project, for the register.
export async function listVerificationStatuses(
  supabase: SupabaseClient<Database>,
  projectId: string
): Promise<Map<string, RequirementVerificationStatus>> {
  const [{ data: methods }, { data: records, error }] = await Promise.all([
    supabase.from('solution_verification_methods').select('id, requirement_id').eq('project_id', projectId),
    supabase
      .from('solution_verification_records')
      .select('id, requirement_id, method_id, result, performed_on, recorded_at, supersedes_id')
      .eq('project_id', projectId),
  ])
  if (error) throw error
  const methodsByRequirement = new Map<string, string[]>()
  for (const m of methods ?? []) methodsByRequirement.set(m.requirement_id, [...(methodsByRequirement.get(m.requirement_id) ?? []), m.id])
  const recordsByRequirement = new Map<string, RecordForRollUp[]>()
  for (const r of records ?? []) recordsByRequirement.set(r.requirement_id, [...(recordsByRequirement.get(r.requirement_id) ?? []), r])

  const statuses = new Map<string, RequirementVerificationStatus>()
  for (const requirementId of new Set([...methodsByRequirement.keys(), ...recordsByRequirement.keys()])) {
    statuses.set(requirementId, rollUpVerification(methodsByRequirement.get(requirementId) ?? [], recordsByRequirement.get(requirementId) ?? []))
  }
  return statuses
}

// --- Reading -------------------------------------------------------------------------

export interface VerificationEvidenceView {
  artifactId: string | null
  // Null when the artifact was removed, or is restricted and hidden from
  // this viewer (RLS hides the evidence row itself in that case).
  title: string | null
  artifactType: WorkstreamArtifact['artifact_type'] | null
  artifactStatus: WorkstreamArtifact['status'] | null
  workstreamId: string | null
  workstreamName: string | null
}

export interface VerificationRecordView extends SolutionVerificationRecord {
  evidence: VerificationEvidenceView[]
  supersededById: string | null
  recordedByEmail: string | null
}

export async function listVerificationRecords(
  supabase: SupabaseClient<Database>,
  requirementId: string
): Promise<VerificationRecordView[]> {
  const { data: records, error } = await supabase
    .from('solution_verification_records')
    .select('*')
    .eq('requirement_id', requirementId)
    .order('performed_on', { ascending: false })
    .order('recorded_at', { ascending: false })
  if (error) throw error
  if (!records || records.length === 0) return []

  const { data: evidence } = await supabase
    .from('solution_verification_evidence')
    .select('record_id, workstream_artifact_id')
    .in('record_id', records.map((r) => r.id))
  const artifactIds = [...new Set((evidence ?? []).map((e) => e.workstream_artifact_id).filter((x): x is string => !!x))]
  const { data: artifacts } = artifactIds.length
    ? await supabase.from('workstream_artifacts').select('id, title, artifact_type, status, workstream_id').in('id', artifactIds)
    : { data: [] }
  const workstreamIds = [...new Set((artifacts ?? []).map((a) => a.workstream_id))]
  const { data: workstreams } = workstreamIds.length
    ? await supabase.from('project_workstreams').select('id, name').in('id', workstreamIds)
    : { data: [] }
  const artifactById = new Map((artifacts ?? []).map((a) => [a.id, a]))
  const workstreamName = new Map((workstreams ?? []).map((w) => [w.id, w.name]))

  // Emails are for display only (same narrow admin-client pattern as the
  // Project page); the records themselves were read under RLS above.
  const recorderIds = [...new Set(records.map((r) => r.recorded_by).filter((x): x is string => !!x))]
  const { data: recorders } = recorderIds.length
    ? await createAdminClient().from('profiles').select('id, email').in('id', recorderIds)
    : { data: [] }
  const recorderEmail = new Map((recorders ?? []).map((p) => [p.id, p.email]))
  const supersededBy = new Map(records.filter((r) => r.supersedes_id).map((r) => [r.supersedes_id!, r.id]))

  return records.map((r) => ({
    ...r,
    evidence: (evidence ?? [])
      .filter((e) => e.record_id === r.id)
      .map((e) => {
        const artifact = e.workstream_artifact_id ? artifactById.get(e.workstream_artifact_id) : undefined
        return {
          artifactId: e.workstream_artifact_id,
          title: artifact?.title ?? null,
          artifactType: artifact?.artifact_type ?? null,
          artifactStatus: artifact?.status ?? null,
          workstreamId: artifact?.workstream_id ?? null,
          workstreamName: artifact ? (workstreamName.get(artifact.workstream_id) ?? null) : null,
        }
      }),
    supersededById: supersededBy.get(r.id) ?? null,
    recordedByEmail: r.recorded_by ? (recorderEmail.get(r.recorded_by) ?? null) : null,
  }))
}

// Artifacts that can evidence a result: those in the Project's workstreams
// the caller can see (RLS hides restricted ones), the requirement's own
// workstreams first.
export interface EvidenceArtifactOption {
  id: string
  title: string
  artifactType: WorkstreamArtifact['artifact_type']
  status: WorkstreamArtifact['status']
  workstreamName: string
  inScope: boolean
}

export async function listEvidenceArtifactOptions(
  supabase: SupabaseClient<Database>,
  projectId: string,
  scopedWorkstreamIds: string[]
): Promise<EvidenceArtifactOption[]> {
  const { data: workstreams } = await supabase.from('project_workstreams').select('id, name').eq('project_id', projectId)
  if (!workstreams || workstreams.length === 0) return []
  const { data: artifacts } = await supabase
    .from('workstream_artifacts')
    .select('id, title, artifact_type, status, workstream_id, created_at')
    .in('workstream_id', workstreams.map((w) => w.id))
    .order('created_at', { ascending: false })
  const name = new Map(workstreams.map((w) => [w.id, w.name]))
  const scoped = new Set(scopedWorkstreamIds)
  return (artifacts ?? [])
    .map((a) => ({
      id: a.id,
      title: a.title,
      artifactType: a.artifact_type,
      status: a.status,
      workstreamName: name.get(a.workstream_id) ?? 'Workstream',
      inScope: scoped.has(a.workstream_id),
    }))
    .sort((a, b) => Number(b.inScope) - Number(a.inScope))
}

// --- Recording -----------------------------------------------------------------------

export interface VerificationRecordInput {
  methodId: string
  result: VerificationResult
  environment: VerificationEnvironment
  solutionReference: string
  configurationReference?: string
  performedOn: string
  artifactIds: string[]
  conditions?: string
  rationale?: string
  measuredValue?: string
  observations?: string
  defectReference?: string
  // A correction: the record this one supersedes.
  supersedesId?: string | null
  // Each pass criterion ticked met or not (src/lib/projects/criteria.ts).
  criteriaChecks?: CriterionCheck[]
}

function clean(value: string | undefined | null, max = 4000): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

// The same bar as the database function (can_run_project_evals): the
// Project's owner, curators and consultants, and platform admins.
export async function canRecordVerification(ctx: WorkbenchCallerContext, projectId: string): Promise<boolean> {
  if (ctx.profile.role === 'admin') return true
  const role = await getActiveProjectRole(ctx, projectId)
  return role === 'owner' || role === 'curator' || role === 'consultant'
}

const FUNCTION_MESSAGES: [string, string][] = [
  ['a pass needs at least one evidence artifact', 'A pass needs at least one evidence artifact. A narrative assertion alone is not evidence.'],
  ['a pass needs every pass criterion met', 'A pass needs every pass criterion ticked as met. Record a conditional pass or a fail if some aren’t.'],
  ['each criteria check needs', 'Each pass criterion needs to be ticked met or not'],
  ['a conditional pass needs its conditions', 'A conditional pass needs its conditions'],
  ['not applicable needs a rationale', 'Not applicable needs a rationale'],
  ['an operational measure needs the measured value', 'An operational measure needs the measured value'],
  ['can\'t be in the future', 'The date it was performed can’t be in the future'],
  ['this requirement is closed', 'This requirement is withdrawn or superseded, so it no longer takes verification results'],
  ['choose one of this requirement', 'Choose one of this requirement’s verification methods'],
  ['already been corrected', 'That record has already been corrected. Correct the newer record instead.'],
  ['must supersede a record of the same requirement', 'A correction must replace a record of the same requirement'],
  ['evidence must be an artifact', 'Evidence must be an artifact in one of this Project’s workstreams that you can see'],
  ['only this Project\'s owner, curators and consultants', 'Only this Project’s owner, curators and consultants can record verification results'],
  ['identify the solution state', 'Identify the solution state: the build or component versions it was run against'],
  ['choose the environment', 'Choose the environment it was run in'],
]

function rethrow(err: unknown): never {
  const e = err as { code?: string; message?: string } | null
  const message = e?.message ?? ''
  for (const [needle, friendly] of FUNCTION_MESSAGES) {
    if (message.includes(needle)) throw new RequirementValidationError(friendly)
  }
  // The unique index: someone corrected the same record at the same time.
  if (e?.code === '23505') throw new RequirementValidationError('That record has already been corrected. Correct the newer record instead.')
  throw err
}

export async function recordVerification(
  ctx: WorkbenchCallerContext,
  requirementId: string,
  input: VerificationRecordInput
): Promise<{ projectId: string; recordId: string }> {
  const { data: requirement } = await ctx.supabase.from('solution_requirements').select('project_id').eq('id', requirementId).maybeSingle()
  if (!requirement) throw new RequirementValidationError('That requirement could not be found')
  if (!(await canRecordVerification(ctx, requirement.project_id))) {
    throw new AuthError("Requires this project's owner, curator or consultant role (or platform admin) to record verification results")
  }
  if (!RESULTS.includes(input.result)) throw new RequirementValidationError('Choose a result')
  if (!ENVIRONMENTS.includes(input.environment)) throw new RequirementValidationError('Choose the environment it was run in')
  const solutionReference = clean(input.solutionReference, 500)
  if (!solutionReference) throw new RequirementValidationError('Identify the solution state: the build or component versions it was run against')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.performedOn ?? '')) throw new RequirementValidationError('Give the date it was performed')
  const artifactIds = [...new Set(input.artifactIds.filter(Boolean))]
  if ((input.result === 'pass' || input.result === 'conditional_pass') && artifactIds.length === 0) {
    throw new RequirementValidationError('A pass needs at least one evidence artifact. A narrative assertion alone is not evidence.')
  }
  if (input.result === 'conditional_pass' && !clean(input.conditions)) throw new RequirementValidationError('A conditional pass needs its conditions')
  if (input.result === 'not_applicable' && !clean(input.rationale)) throw new RequirementValidationError('Not applicable needs a rationale')
  const criteriaChecks = (input.criteriaChecks ?? [])
    .map((c) => ({ criterion: clean(c?.criterion, 2000), met: c?.met === true }))
    .filter((c): c is CriterionCheck => !!c.criterion)
    .slice(0, 50)
  if (input.result === 'pass' && criteriaChecks.some((c) => !c.met)) {
    throw new RequirementValidationError('A pass needs every pass criterion ticked as met. Record a conditional pass or a fail if some aren’t.')
  }

  const { data: recordId, error } = await ctx.supabase.rpc('record_solution_verification', {
    p_requirement_id: requirementId,
    p_method_id: input.methodId,
    p_result: input.result,
    p_environment: input.environment,
    p_solution_reference: solutionReference,
    p_performed_on: input.performedOn,
    p_artifact_ids: artifactIds,
    p_configuration_reference: clean(input.configurationReference, 500),
    p_conditions: clean(input.conditions),
    p_rationale: clean(input.rationale),
    p_measured_value: clean(input.measuredValue, 300),
    p_observations: clean(input.observations),
    p_defect_reference: clean(input.defectReference, 300),
    p_supersedes_id: input.supersedesId || null,
    p_criteria_checks: criteriaChecks.length > 0 ? criteriaChecks : null,
  })
  if (error || !recordId) rethrow(error ?? new Error('Could not record the result'))
  return { projectId: requirement.project_id, recordId }
}

// The methods a result can be recorded against, for the form.
export type MethodOption = Pick<SolutionVerificationMethod, 'id' | 'method' | 'pass_criteria' | 'threshold' | 'measure_window'>
