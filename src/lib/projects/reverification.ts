import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import { createProjectNote } from '@/lib/projects/notes'
import { RequirementValidationError } from '@/lib/projects/requirements'
import type { ScopedRequirement } from '@/lib/projects/reverification-scope'
import type { Database, ReverificationEventKind, SolutionReverificationEvent } from '@/types/database'

// Solution conformance and acceptance evaluation, Stage 4 (docs/dev-request-
// solution-conformance-and-acceptance-evaluation.md): re-verification
// triggers. The database (20261021100001_solution_reverification.sql) holds
// the one definition of "re-verification due" (project_reverification_due);
// creates events automatically for new source versions and operational
// measures outside their threshold; and blocks production-change approvals
// while anything in the baseline is due. These functions read that, record
// changes the team reports, and resolve events with a note.

export interface ReverificationDue {
  openEventIds: string[]
  reviewDue: boolean
}

// Every open requirement in the Project that needs re-verification, and why.
export async function listReverificationDue(supabase: SupabaseClient<Database>, projectId: string): Promise<Map<string, ReverificationDue>> {
  const { data, error } = await supabase.rpc('project_reverification_due', { p_project_id: projectId })
  if (error) throw error
  return new Map((data ?? []).map((d) => [d.requirement_id, { openEventIds: d.open_event_ids ?? [], reviewDue: d.review_due }]))
}

// 'closed': the requirement was withdrawn or superseded before it was
// re-verified.
export type LinkState = 'open' | 'reverified' | 'resolved' | 'closed'

export interface ReverificationEventView extends SolutionReverificationEvent {
  recordedByEmail: string | null
  objectName: string | null
  workstreamName: string | null
  requirements: {
    linkId: string
    requirementId: string
    code: string
    title: string
    state: LinkState
    resolutionNote: string | null
    resolvedByEmail: string | null
  }[]
}

// The Project's change history, newest first -- optionally only the events
// touching one requirement. A link is open while the requirement is still
// due because of it, re-verified once results were recorded after it,
// resolved by a curator with a note, or closed with its requirement.
export async function listReverificationEvents(
  supabase: SupabaseClient<Database>,
  projectId: string,
  options: { requirementId?: string; due?: Map<string, ReverificationDue> } = {}
): Promise<ReverificationEventView[]> {
  let linkQuery = supabase.from('solution_reverification_event_requirements').select('*').eq('project_id', projectId)
  if (options.requirementId) linkQuery = linkQuery.eq('requirement_id', options.requirementId)
  const [{ data: links, error }, due] = await Promise.all([linkQuery, options.due ? Promise.resolve(options.due) : listReverificationDue(supabase, projectId)])
  if (error) throw error
  const eventIds = [...new Set((links ?? []).map((l) => l.event_id))]
  if (eventIds.length === 0) return []

  const requirementIds = [...new Set((links ?? []).map((l) => l.requirement_id))]
  const [{ data: events }, { data: requirements }, { data: objects }, { data: workstreams }] = await Promise.all([
    supabase.from('solution_reverification_events').select('*').in('id', eventIds).order('created_at', { ascending: false }),
    supabase.from('solution_requirements').select('id, code, title, status').in('id', requirementIds),
    supabase.from('project_objects').select('id, name').eq('project_id', projectId),
    supabase.from('project_workstreams').select('id, name').eq('project_id', projectId),
  ])
  const requirementById = new Map((requirements ?? []).map((r) => [r.id, r]))
  const objectName = new Map((objects ?? []).map((o) => [o.id, o.name]))
  const workstreamName = new Map((workstreams ?? []).map((w) => [w.id, w.name]))

  // Emails are for display only (same narrow admin-client pattern as the
  // Project page); the rows were read under RLS above.
  const peopleIds = [
    ...new Set([...(events ?? []).map((e) => e.recorded_by), ...(links ?? []).map((l) => l.resolved_by)].filter((x): x is string => !!x)),
  ]
  const { data: people } = peopleIds.length ? await createAdminClient().from('profiles').select('id, email').in('id', peopleIds) : { data: [] }
  const email = new Map((people ?? []).map((p) => [p.id, p.email]))

  return (events ?? []).map((e) => ({
    ...e,
    recordedByEmail: e.recorded_by ? (email.get(e.recorded_by) ?? null) : null,
    objectName: e.project_object_id ? (objectName.get(e.project_object_id) ?? null) : null,
    workstreamName: e.workstream_id ? (workstreamName.get(e.workstream_id) ?? null) : null,
    requirements: (links ?? [])
      .filter((l) => l.event_id === e.id)
      .map((l) => {
        const requirement = requirementById.get(l.requirement_id)
        const state: LinkState = l.resolved_at
          ? 'resolved'
          : due.get(l.requirement_id)?.openEventIds.includes(e.id)
            ? 'open'
            : requirement && requirement.status !== 'draft' && requirement.status !== 'baselined'
              ? 'closed'
              : 'reverified'
        return {
          linkId: l.id,
          requirementId: l.requirement_id,
          code: requirement?.code ?? 'Requirement',
          title: requirement?.title ?? '',
          state,
          resolutionNote: l.resolution_note,
          resolvedByEmail: l.resolved_by ? (email.get(l.resolved_by) ?? null) : null,
        }
      })
      .sort((a, b) => a.code.localeCompare(b.code)),
  }))
}

// What the change form needs: open requirements with their scope, and the
// Project's components (objects) and workstreams.
export async function getChangeFormOptions(supabase: SupabaseClient<Database>, projectId: string) {
  const [{ data: requirements }, { data: links }, { data: objects }, { data: workstreams }] = await Promise.all([
    supabase.from('solution_requirements').select('id, code, title').eq('project_id', projectId).in('status', ['draft', 'baselined']).order('code'),
    supabase.from('solution_requirement_scope_links').select('requirement_id, workstream_id, project_object_id').eq('project_id', projectId),
    supabase.from('project_objects').select('id, name, parent_object_id').eq('project_id', projectId).order('name'),
    supabase.from('project_workstreams').select('id, name').eq('project_id', projectId).order('name'),
  ])
  const scoped: (ScopedRequirement & { code: string; title: string })[] = (requirements ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    title: r.title,
    objectIds: (links ?? []).filter((l) => l.requirement_id === r.id && l.project_object_id).map((l) => l.project_object_id!),
    workstreamIds: (links ?? []).filter((l) => l.requirement_id === r.id && l.workstream_id).map((l) => l.workstream_id!),
  }))
  return {
    requirements: scoped,
    objects: (objects ?? []).map((o) => ({ id: o.id, name: o.name, parentId: o.parent_object_id })),
    workstreams: workstreams ?? [],
  }
}

// --- Writing -------------------------------------------------------------------------

function clean(value: string | undefined | null, max = 4000): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

const FUNCTION_PREFIX = /^(record_solution_reverification_event|resolve_solution_reverification): ([\s\S]+)$/

function rethrow(err: unknown): never {
  const match = FUNCTION_PREFIX.exec((err as { message?: string } | null)?.message ?? '')
  if (match) {
    const text = match[2].replace(/''/g, '’').replace(/'/g, '’')
    throw new RequirementValidationError(text.charAt(0).toUpperCase() + text.slice(1))
  }
  throw err
}

export interface ChangeInput {
  kind: Extract<ReverificationEventKind, 'component_change' | 'other'>
  summary: string
  changeReference?: string
  detail?: string
  objectId?: string | null
  workstreamId?: string | null
  requirementIds: string[]
}

export async function recordChange(ctx: WorkbenchCallerContext, projectId: string, input: ChangeInput): Promise<{ projectId: string; eventId: string }> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator' && role !== 'consultant') {
      throw new AuthError("Requires this project's owner, curator or consultant role (or platform admin) to record a change")
    }
  }
  if (input.kind !== 'component_change' && input.kind !== 'other') throw new RequirementValidationError('Choose the kind of change')
  const summary = clean(input.summary, 300)
  if (!summary) throw new RequirementValidationError('Describe the change')
  const requirementIds = [...new Set(input.requirementIds.filter(Boolean))]
  if (requirementIds.length === 0) throw new RequirementValidationError('Choose at least one affected requirement')

  const { data: eventId, error } = await ctx.supabase.rpc('record_solution_reverification_event', {
    p_project_id: projectId,
    p_kind: input.kind,
    p_summary: summary,
    p_requirement_ids: requirementIds,
    p_change_reference: clean(input.changeReference, 300),
    p_detail: clean(input.detail),
    p_project_object_id: input.objectId || null,
    p_workstream_id: input.workstreamId || null,
  })
  if (error || !eventId) rethrow(error ?? new Error('Could not record the change'))

  // Tell the Project's owners and curators (best effort).
  const { data: curators } = await ctx.supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .in('role', ['owner', 'curator'])
  for (const recipientUserId of new Set((curators ?? []).map((c) => c.user_id))) {
    if (recipientUserId === ctx.user.id) continue
    try {
      await createProjectNote(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
        projectId,
        recipientType: 'user',
        recipientUserId,
        subject: 'Requirements need re-verification',
        body: `A change was recorded: ${summary}${input.changeReference ? ` (${clean(input.changeReference, 300)})` : ''}. ${requirementIds.length} requirement${requirementIds.length === 1 ? '' : 's'} now need re-verification. See the Project's requirement changes.`,
        contextType: 'solution_reverification',
        contextId: eventId,
      })
    } catch (err) {
      console.error(`Failed to notify ${recipientUserId} about change ${eventId}:`, err)
    }
  }
  return { projectId, eventId }
}

export async function resolveReverification(ctx: WorkbenchCallerContext, linkId: string, note: string): Promise<{ projectId: string }> {
  const { data: link } = await ctx.supabase.from('solution_reverification_event_requirements').select('project_id').eq('id', linkId).maybeSingle()
  if (!link) throw new RequirementValidationError('That could not be found')
  if (!clean(note)) throw new RequirementValidationError('Say why no re-verification is needed')
  const { error } = await ctx.supabase.rpc('resolve_solution_reverification', { p_link_id: linkId, p_note: clean(note)! })
  if (error) rethrow(error)
  return { projectId: link.project_id }
}

// The review schedule is operational, so a curator can set it on a draft or
// baselined requirement (it is not part of the frozen content).
export async function setReviewInterval(ctx: WorkbenchCallerContext, requirementId: string, months: number | null): Promise<{ projectId: string }> {
  const { data: requirement } = await ctx.supabase.from('solution_requirements').select('project_id, status').eq('id', requirementId).maybeSingle()
  if (!requirement) throw new RequirementValidationError('That requirement could not be found')
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, requirement.project_id)
    if (role !== 'owner' && role !== 'curator') throw new AuthError("Requires this project's owner or curator role (or platform admin) to set a review schedule")
  }
  if (requirement.status !== 'draft' && requirement.status !== 'baselined') throw new RequirementValidationError('This requirement is closed')
  if (months !== null && (!Number.isInteger(months) || months < 1 || months > 120)) throw new RequirementValidationError('Choose between 1 and 120 months')
  const { error } = await ctx.supabase.from('solution_requirements').update({ review_interval_months: months }).eq('id', requirementId)
  if (error) throw error
  return { projectId: requirement.project_id }
}
