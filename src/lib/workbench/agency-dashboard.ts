import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { BuilderProgressConfidence, ProjectStatus } from '@/types/database'
import type { WorkbenchCallerContext } from './context'

// Builder agency dashboard (/agency, 2026-10-01, Mike): the platform owner
// is the admin, each builder agency is a curator, each builder is a
// consultant, and each builder runs one Project per client. A curator sees
// their own builders (agency_builders roster); the admin sees every agency
// plus any builder not yet assigned to one, and assigns them.
//
// Same consent-based, metadata-only posture as Builder Operations
// (builder-progress-updates.ts, docs/dev-request-builder-operations-and-
// progress-updates.md): Project names, pipeline status, workstream counts,
// dates, and whatever progress update the builder chose to share. Never
// goal/details/objective, notebooks, conversations or artifacts. The admin
// client is the query engine only -- every query below is scoped to the
// builders the caller is entitled to see before anything is read.

export type AgencyAttention = 'blocked' | 'help_requested' | 'at_risk'

export interface AgencySharedUpdate {
  workstreamName: string
  currentStage: string
  progress: string
  nextStep: string
  helpRequested: string | null
  confidence: BuilderProgressConfidence
  updatedAt: string
}

export interface AgencyProjectRow {
  id: string
  name: string
  status: ProjectStatus
  workstreamCount: number
  activeWorkstreamCount: number
  lastActivityAt: string
  latestUpdate: AgencySharedUpdate | null
}

export interface AgencyBuilderRow {
  builderId: string
  email: string | null
  fullName: string | null
  isActive: boolean
  agencyId: string | null
  projects: AgencyProjectRow[]
  lastActivityAt: string | null
  attention: AgencyAttention | null
}

export interface AgencyGroup {
  agencyId: string
  email: string | null
  fullName: string | null
  builders: AgencyBuilderRow[]
}

export interface AgencyDashboard {
  viewerIsAdmin: boolean
  agencies: AgencyGroup[]
  // Admin only -- builders with no agency_builders row yet.
  unassigned: AgencyBuilderRow[]
}

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  is_active: boolean
}

export interface AgencyDashboardInput {
  viewerIsAdmin: boolean
  agencies: ProfileRow[]
  builders: ProfileRow[]
  roster: { builder_id: string; agency_id: string }[]
  projects: { id: string; name: string; status: ProjectStatus; owner_id: string | null; updated_at: string }[]
  workstreams: { id: string; project_id: string; name: string; status: string; updated_at: string }[]
  updates: {
    workstream_id: string
    current_stage: string
    progress: string
    next_step: string
    help_requested: string | null
    confidence: BuilderProgressConfidence
    updated_at: string
  }[]
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

function attentionFor(updates: AgencySharedUpdate[]): AgencyAttention | null {
  if (updates.some((u) => u.confidence === 'blocked')) return 'blocked'
  if (updates.some((u) => u.helpRequested)) return 'help_requested'
  if (updates.some((u) => u.confidence === 'at_risk')) return 'at_risk'
  return null
}

function byEmail(a: { email: string | null }, b: { email: string | null }) {
  return (a.email ?? '').localeCompare(b.email ?? '')
}

// Pure shaping, separate from the queries so it's testable on its own.
export function assembleAgencyDashboard(input: AgencyDashboardInput): AgencyDashboard {
  const updateByWorkstream = new Map(input.updates.map((u) => [u.workstream_id, u]))

  const workstreamsByProject = new Map<string, AgencyDashboardInput['workstreams']>()
  for (const w of input.workstreams) {
    const list = workstreamsByProject.get(w.project_id) ?? []
    list.push(w)
    workstreamsByProject.set(w.project_id, list)
  }

  const projectsByOwner = new Map<string, AgencyProjectRow[]>()
  for (const p of input.projects) {
    if (!p.owner_id) continue
    const workstreams = workstreamsByProject.get(p.id) ?? []
    let lastActivityAt = p.updated_at
    let latestUpdate: AgencySharedUpdate | null = null
    for (const w of workstreams) {
      lastActivityAt = laterOf(lastActivityAt, w.updated_at)!
      const u = updateByWorkstream.get(w.id)
      if (u && (!latestUpdate || u.updated_at > latestUpdate.updatedAt)) {
        latestUpdate = {
          workstreamName: w.name,
          currentStage: u.current_stage,
          progress: u.progress,
          nextStep: u.next_step,
          helpRequested: u.help_requested,
          confidence: u.confidence,
          updatedAt: u.updated_at,
        }
      }
    }
    const list = projectsByOwner.get(p.owner_id) ?? []
    list.push({
      id: p.id,
      name: p.name,
      status: p.status,
      workstreamCount: workstreams.length,
      activeWorkstreamCount: workstreams.filter((w) => w.status === 'active').length,
      lastActivityAt,
      latestUpdate,
    })
    projectsByOwner.set(p.owner_id, list)
  }

  const agencyByBuilder = new Map(input.roster.map((r) => [r.builder_id, r.agency_id]))

  const builderRows: AgencyBuilderRow[] = input.builders.map((b) => {
    const projects = (projectsByOwner.get(b.id) ?? []).sort((x, y) => y.lastActivityAt.localeCompare(x.lastActivityAt))
    return {
      builderId: b.id,
      email: b.email,
      fullName: b.full_name,
      isActive: b.is_active,
      agencyId: agencyByBuilder.get(b.id) ?? null,
      projects,
      lastActivityAt: projects.reduce<string | null>((latest, p) => laterOf(latest, p.lastActivityAt), null),
      attention: attentionFor(projects.flatMap((p) => (p.latestUpdate ? [p.latestUpdate] : []))),
    }
  })
  builderRows.sort(byEmail)

  const agencies: AgencyGroup[] = [...input.agencies].sort(byEmail).map((a) => ({
    agencyId: a.id,
    email: a.email,
    fullName: a.full_name,
    builders: builderRows.filter((b) => b.agencyId === a.id),
  }))

  return {
    viewerIsAdmin: input.viewerIsAdmin,
    agencies,
    unassigned: input.viewerIsAdmin ? builderRows.filter((b) => !b.agencyId) : [],
  }
}

export async function getAgencyDashboard(ctx: WorkbenchCallerContext): Promise<AgencyDashboard> {
  const viewerIsAdmin = ctx.profile.role === 'admin'
  if (!viewerIsAdmin && ctx.profile.role !== 'curator') {
    throw new AuthError('Requires curator or admin role to view the agency dashboard')
  }

  const admin = createAdminClient()
  const profileColumns = 'id, email, full_name, is_active'

  const rosterQuery = admin.from('agency_builders').select('builder_id, agency_id')
  const { data: roster, error: rosterError } = viewerIsAdmin ? await rosterQuery : await rosterQuery.eq('agency_id', ctx.user.id)
  if (rosterError) throw rosterError

  let agencies: ProfileRow[]
  let builders: ProfileRow[]
  if (viewerIsAdmin) {
    const [{ data: curatorRows, error: curatorError }, { data: builderRows, error: builderError }] = await Promise.all([
      admin.from('profiles').select(profileColumns).eq('role', 'curator'),
      admin.from('profiles').select(profileColumns).eq('role', 'consultant'),
    ])
    if (curatorError) throw curatorError
    if (builderError) throw builderError
    agencies = curatorRows ?? []
    builders = builderRows ?? []
  } else {
    agencies = [{ id: ctx.user.id, email: ctx.profile.email, full_name: ctx.profile.full_name, is_active: ctx.profile.is_active }]
    const builderIds = (roster ?? []).map((r) => r.builder_id)
    if (builderIds.length === 0) {
      builders = []
    } else {
      const { data, error } = await admin.from('profiles').select(profileColumns).eq('role', 'consultant').in('id', builderIds)
      if (error) throw error
      builders = data ?? []
    }
  }

  const builderIds = builders.map((b) => b.id)
  let projects: AgencyDashboardInput['projects'] = []
  if (builderIds.length > 0) {
    const { data, error } = await admin
      .from('projects')
      .select('id, name, status, owner_id, updated_at')
      .in('owner_id', builderIds)
      .neq('status', 'archived')
    if (error) throw error
    projects = data ?? []
  }

  const projectIds = projects.map((p) => p.id)
  let workstreams: AgencyDashboardInput['workstreams'] = []
  if (projectIds.length > 0) {
    const { data, error } = await admin.from('project_workstreams').select('id, project_id, name, status, updated_at').in('project_id', projectIds)
    if (error) throw error
    workstreams = data ?? []
  }

  const workstreamIds = workstreams.map((w) => w.id)
  let updates: AgencyDashboardInput['updates'] = []
  if (workstreamIds.length > 0) {
    const { data, error } = await admin
      .from('builder_progress_updates')
      .select('workstream_id, current_stage, progress, next_step, help_requested, confidence, updated_at')
      .in('workstream_id', workstreamIds)
      .eq('status', 'active')
    if (error) throw error
    updates = data ?? []
  }

  return assembleAgencyDashboard({ viewerIsAdmin, agencies, builders, roster: roster ?? [], projects, workstreams, updates })
}

// Admin only. agencyId null removes the builder from their agency.
export async function assignBuilderToAgency(ctx: WorkbenchCallerContext, builderId: string, agencyId: string | null): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can assign builders to agencies')

  if (agencyId === null) {
    const { error } = await ctx.supabase.from('agency_builders').delete().eq('builder_id', builderId)
    if (error) throw error
    return
  }

  const { data: people, error: peopleError } = await ctx.supabase.from('profiles').select('id, role').in('id', [builderId, agencyId])
  if (peopleError) throw peopleError
  const roleById = new Map((people ?? []).map((p) => [p.id, p.role]))
  if (roleById.get(builderId) !== 'consultant') throw new ProjectValidationError('Only a builder (consultant) account can join an agency')
  if (roleById.get(agencyId) !== 'curator') throw new ProjectValidationError('An agency must be a curator account')

  const { error } = await ctx.supabase
    .from('agency_builders')
    .upsert({ builder_id: builderId, agency_id: agencyId, assigned_by: ctx.user.id }, { onConflict: 'builder_id' })
  if (error) throw error
}
