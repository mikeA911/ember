import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { PendingProjectMember, ProjectApprovalStatus, ProjectType } from '@/types/database'
import type { WorkbenchCallerContext } from './context'

// Project creation approval (20261004100001_project_creation_approval.sql).
// A project created by a consultant/builder is 'pending' until it's
// decided by a platform admin, or by a curator:
//   * a creator on an agency's roster (agency_builders) -- only their own
//     agency curator decides, so agencies sharing a deployment never
//     decide each other's builders' projects;
//   * a creator on no roster -- any curator decides (a single-organization
//     deployment, where the curators are that organization's own staff).
// Curators' and admins' own projects never need approval.
// The creator keeps working on it meanwhile; it just stays theirs alone --
// the DB triggers keep it private and refuse other active members.
//
// Every write here goes through the admin client: the decider is never a
// member of the pending project, and the DB only accepts approval_*
// changes from the service role -- so the explicit checks below are the
// real gate, same pattern as workstream-promotions.ts.

type Admin = ReturnType<typeof createAdminClient>

export interface ProjectAwaitingApprovalRow {
  id: string
  name: string
  projectType: ProjectType
  objective: string | null
  creatorEmail: string | null
  pendingMemberCount: number
  createdAt: string
}

// Admin: every pending project. Curator: their own builders' projects,
// plus those of creators on no agency's roster.
export async function listProjectsAwaitingApproval(ctx: WorkbenchCallerContext): Promise<ProjectAwaitingApprovalRow[]> {
  const { profile, user } = ctx
  if (profile.role !== 'admin' && profile.role !== 'curator') return []
  const admin = createAdminClient()

  const { data: allPending, error } = await admin
    .from('projects')
    .select('id, name, project_type, objective, owner_id, pending_members, created_at')
    .eq('approval_status', 'pending')
    .order('created_at', { ascending: true })
  if (error) throw error
  let projects = allPending ?? []
  if (profile.role === 'curator' && projects.length > 0) {
    const creatorIds = [...new Set(projects.map((p) => p.owner_id).filter((id): id is string => !!id))]
    const { data: links, error: linksError } =
      creatorIds.length > 0
        ? await admin.from('agency_builders').select('builder_id, agency_id').in('builder_id', creatorIds)
        : { data: [], error: null }
    if (linksError) throw linksError
    const agencyByBuilder = new Map((links ?? []).map((l) => [l.builder_id, l.agency_id]))
    projects = projects.filter((p) => {
      const agencyId = p.owner_id ? agencyByBuilder.get(p.owner_id) : undefined
      return agencyId === undefined || agencyId === user.id
    })
  }
  if (projects.length === 0) return []

  const ownerIds = [...new Set(projects.map((p) => p.owner_id).filter((id): id is string => !!id))]
  const { data: owners } = ownerIds.length > 0 ? await admin.from('profiles').select('id, email').in('id', ownerIds) : { data: [] }
  const emailById = new Map((owners ?? []).map((o) => [o.id, o.email]))

  return projects.map((p) => ({
    id: p.id,
    name: p.name,
    projectType: p.project_type,
    objective: p.objective,
    creatorEmail: p.owner_id ? (emailById.get(p.owner_id) ?? null) : null,
    pendingMemberCount: (p.pending_members ?? []).length,
    createdAt: p.created_at,
  }))
}

async function loadProject(admin: Admin, projectId: string) {
  const { data, error } = await admin
    .from('projects')
    .select('id, name, owner_id, approval_status, pending_members')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new ProjectValidationError('Project not found')
  return data
}

async function requireApprovalDecider(ctx: WorkbenchCallerContext, admin: Admin, ownerId: string | null): Promise<void> {
  if (ownerId === ctx.user.id) throw new AuthError('You cannot approve a project you created yourself')
  if (ctx.profile.role === 'admin') return
  if (ctx.profile.role !== 'curator') throw new AuthError('Only a curator or platform admin can decide this project')
  if (!ownerId) return
  const { data: link, error } = await admin.from('agency_builders').select('agency_id').eq('builder_id', ownerId).maybeSingle()
  if (error) throw error
  if (link && link.agency_id !== ctx.user.id) {
    throw new AuthError('Only the creator\'s agency curator or a platform admin can decide this project')
  }
}

// Best-effort, like presentation-notifications.ts: the decision already
// stuck, so a failed note mustn't report it as failed. The creator is the
// project's owner, so the note opens normally from "Notes for you".
async function notifyCreator(admin: Admin, ctx: WorkbenchCallerContext, projectId: string, creatorId: string | null, subject: string, body: string) {
  if (!creatorId) return
  try {
    await admin.from('project_notes').insert({
      project_id: projectId,
      author_id: ctx.user.id,
      recipient_type: 'user',
      recipient_user_id: creatorId,
      subject,
      body,
      context_type: 'project_approval',
      context_id: projectId,
    })
  } catch {
    // see comment above
  }
}

export async function approveProjectCreation(ctx: WorkbenchCallerContext, projectId: string): Promise<void> {
  const admin = createAdminClient()
  const project = await loadProject(admin, projectId)
  await requireApprovalDecider(ctx, admin, project.owner_id)
  if (project.approval_status !== 'pending') throw new ProjectValidationError('This project has already been decided')

  // Status first: project_members_enforce_approval refuses the held
  // members until the project is approved. The .eq guard turns a raced
  // double-decision into a clear error instead of a second approval.
  const { data: updated, error } = await admin
    .from('projects')
    .update({
      approval_status: 'approved',
      approval_decided_by: ctx.user.id,
      approval_decided_at: new Date().toISOString(),
      approval_decision_reason: null,
      pending_members: [],
    })
    .eq('id', projectId)
    .eq('approval_status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!updated) throw new ProjectValidationError('This project has already been decided')

  const held = (project.pending_members ?? []) as PendingProjectMember[]
  if (held.length > 0) {
    const { error: memberError } = await admin
      .from('project_members')
      .upsert(
        held.map((m) => ({ project_id: projectId, user_id: m.user_id, role: m.role, status: 'active' as const })),
        { onConflict: 'project_id,user_id', ignoreDuplicates: true }
      )
    if (memberError) throw memberError
  }

  await notifyCreator(
    admin,
    ctx,
    projectId,
    project.owner_id,
    `Project approved: ${project.name}`,
    held.length > 0
      ? `${project.name} has been approved. The ${held.length} team member${held.length === 1 ? '' : 's'} you picked when creating it now have access.`
      : `${project.name} has been approved. You can now add members and share it.`
  )
}

export async function rejectProjectCreation(ctx: WorkbenchCallerContext, projectId: string, reason: string): Promise<void> {
  const trimmed = reason.trim()
  if (!trimmed) throw new ProjectValidationError('Give the creator a reason so they know what to change')
  const admin = createAdminClient()
  const project = await loadProject(admin, projectId)
  await requireApprovalDecider(ctx, admin, project.owner_id)
  if (project.approval_status !== 'pending') throw new ProjectValidationError('This project has already been decided')

  const { data: updated, error } = await admin
    .from('projects')
    .update({
      approval_status: 'rejected',
      approval_decided_by: ctx.user.id,
      approval_decided_at: new Date().toISOString(),
      approval_decision_reason: trimmed,
    })
    .eq('id', projectId)
    .eq('approval_status', 'pending')
    .select('id')
    .maybeSingle()
  if (error) throw error
  if (!updated) throw new ProjectValidationError('This project has already been decided')

  await notifyCreator(
    admin,
    ctx,
    projectId,
    project.owner_id,
    `Project not approved: ${project.name}`,
    `${project.name} was not approved.\n\nReason: ${trimmed}\n\nYou can keep working on it and resubmit it for approval from the project page.`
  )
}

// The creator, after a rejection. Keeps the held members and clears the
// old decision so the approver sees a fresh request.
export async function resubmitProjectForApproval(ctx: WorkbenchCallerContext, projectId: string): Promise<void> {
  const admin = createAdminClient()
  const project = await loadProject(admin, projectId)
  if (project.owner_id !== ctx.user.id) throw new AuthError('Only the project\'s creator can resubmit it for approval')
  if (project.approval_status !== 'rejected') throw new ProjectValidationError('Only a project that was not approved can be resubmitted')

  const { error } = await admin
    .from('projects')
    .update({ approval_status: 'pending', approval_decided_by: null, approval_decided_at: null, approval_decision_reason: null })
    .eq('id', projectId)
    .eq('approval_status', 'rejected')
  if (error) throw error
}

export interface ProjectApprovalState {
  status: ProjectApprovalStatus
  reason: string | null
  // Who can approve it besides a platform admin: the creator's agency
  // curator if they have one, otherwise any curator.
  approverLabel: string
  pendingMemberEmails: string[]
}

// For the creator's own banner on the project page. Narrow metadata only
// (agency email, held members' emails), same as listSelectableUsers.
export async function getProjectApprovalState(project: {
  owner_id: string | null
  approval_status: ProjectApprovalStatus
  approval_decision_reason: string | null
  pending_members: PendingProjectMember[] | null
}): Promise<ProjectApprovalState> {
  const admin = createAdminClient()
  const held = project.pending_members ?? []
  const [{ data: link }, { data: heldProfiles }] = await Promise.all([
    project.owner_id
      ? admin.from('agency_builders').select('agency_id').eq('builder_id', project.owner_id).maybeSingle()
      : Promise.resolve({ data: null }),
    held.length > 0 ? admin.from('profiles').select('email').in('id', held.map((m) => m.user_id)) : Promise.resolve({ data: [] }),
  ])
  const { data: agency } = link ? await admin.from('profiles').select('email').eq('id', link.agency_id).maybeSingle() : { data: null }
  return {
    status: project.approval_status,
    reason: project.approval_decision_reason,
    approverLabel: !link
      ? 'a curator or platform admin'
      : agency?.email
        ? `your agency (${agency.email}) or a platform admin`
        : 'a platform admin',
    pendingMemberEmails: (heldProfiles ?? []).map((p) => p.email).filter((e): e is string => !!e),
  }
}
