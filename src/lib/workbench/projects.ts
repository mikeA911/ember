import 'server-only'
import { AuthError, hasRequiredRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import type {
  ApprovalType,
  ProjectRole,
  ProjectType,
  ProjectStatus,
  ProjectMemberStatus,
  PublicProjectProfile,
  PortfolioCategory,
  ProjectDiscoverability,
  WorkstreamLifecycleStage,
} from '@/types/database'
import { ProjectValidationError } from '@/lib/projects/errors'
import { requireActiveKnowledgeBase } from '@/lib/knowledge-bases'
import { env } from '@/lib/env'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md): a wizard-staged
// object/workstream tree has parent->child pointers the wizard only knows as
// client-generated tempIds -- nothing has a real DB id until it's inserted,
// so a single bulk insert can't satisfy a child's FK to a parent that
// doesn't exist yet. Inserts one "level" at a time -- every item whose
// parent is null or already resolved -- capturing Supabase's returned ids to
// map tempId -> real id for the next level. Throws if a level makes no
// progress (a cycle or a dangling parentTempId in the staged data).
// Exported for reuse by Part B's project-cloning.ts, which stages a deep
// copy of an existing tree the same way (tempId = the source row's own id).
export async function insertStagedTree<T extends { tempId: string; parentTempId: string | null }>(
  supabase: WorkbenchCallerContext['supabase'],
  table: string,
  items: T[],
  toRow: (item: T, resolvedParentId: string | null) => Record<string, unknown>
): Promise<Map<string, string>> {
  const idByTempId = new Map<string, string>()
  let pending = items
  while (pending.length > 0) {
    const ready = pending.filter((item) => item.parentTempId === null || idByTempId.has(item.parentTempId))
    if (ready.length === 0) {
      throw new ProjectValidationError(`Invalid ${table} hierarchy: a parent reference is missing or forms a cycle`)
    }
    const rows = ready.map((item) => toRow(item, item.parentTempId ? (idByTempId.get(item.parentTempId) ?? null) : null))
    const { data, error } = await supabase.from(table).insert(rows).select('id')
    if (error || !data) throw error ?? new ProjectValidationError(`Failed to create ${table}`)
    ready.forEach((item, i) => idByTempId.set(item.tempId, data[i].id))
    pending = pending.filter((item) => !ready.includes(item))
  }
  return idByTempId
}

// profiles RLS (profiles_select_own_or_staff) only lets a caller see their
// own row or staff see everyone -- a plain consultant creating/managing a
// project can't look up a teammate's id by email through the normal
// RLS-scoped client. This is the one deliberately narrow use of the
// service-role client in this module, and it only ever returns id+email --
// never role, is_active, or anything else off the profiles row.
async function resolveUserIdsByEmail(emails: string[]): Promise<Map<string, string>> {
  if (emails.length === 0) return new Map()
  const admin = createAdminClient()
  const { data, error } = await admin.from('profiles').select('id, email').in('email', emails)
  if (error) throw error
  return new Map((data ?? []).filter((p) => p.email).map((p) => [p.email as string, p.id]))
}

// A consultant-or-above session can start a project (OL-007: 'member' is
// deliberately excluded -- projects_insert_self's RLS now requires
// is_consultant_or_above too, see 20260831120001_member_role.sql). Beyond
// that floor there's no further platform-role gate, only a project-role one
// once it exists (see project_members RLS). This uses the caller's own RLS-scoped
// client throughout for the mutation itself; RLS is the real gate, this is
// just a friendlier error message than a raw policy violation. The DB
// trigger (create_owner_membership, 20260810120001) guarantees the creator
// gets an 'owner' project_members row before this function's second insert
// runs, which is what makes adding staged team members via the caller's own
// (RLS-checked, not admin) client work correctly.
export async function createProject(
  ctx: WorkbenchCallerContext,
  input: {
    name: string
    projectType: ProjectType
    objective: string
    details: Record<string, string>
    knowledgeBaseId: string | null
    evalDatasetId: string | null
    members: { email: string; role: ProjectRole }[]
    // Project Approval Authorities, Stage 1 (docs/dev-request-project-
    // approval-authorities.md): staged from the wizard's Governance &
    // Approvals step. assigneeEmail is '__self__' for the creator, a staged
    // member's email, or null for an intentionally unassigned "Authority
    // needed" gap -- never a fabricated identity.
    approvals?: { approvalType: ApprovalType; requirementStatus: 'required' | 'optional'; assigneeEmail: string | null }[]
    // Builder Ontology, Part A: staged from the wizard's "Domain objects &
    // workstreams" step, single-shot Ember-suggested or hand-entered, fully
    // editable before this call -- nothing is written until here. Items
    // reference each other by client-generated tempId (see insertStagedTree).
    projectObjects?: { tempId: string; parentTempId: string | null; name: string; slug: string; description?: string }[]
    workstreams?: {
      tempId: string
      parentTempId: string | null
      name: string
      slug: string
      goal?: string
      lifecycleStage?: WorkstreamLifecycleStage
    }[]
  }
) {
  const { user, profile, supabase } = ctx
  if (profile.role === 'anonymous') {
    throw new AuthError('Create an account to start a project')
  }
  if (!hasRequiredRole(profile.role, 'consultant')) {
    throw new AuthError('Your account needs to be a consultant or above to start a project')
  }
  // KB Sandbox Builder: a builder (consultant role) gets exactly one
  // Project, auto-provisioned at account creation (provisionBuilderProject)
  // -- each client proposal is a Workstream on it, not a new Project (see
  // that function's own comment). A client Project only comes from an
  // accepted proposal, via workstream promotion, never from here.
  // Curator/admin (operator staff) are unaffected -- they aren't builders
  // and may need several Projects for programme administration. 'member' role is already excluded by the role check
  // above in both modes, so no separate case is needed there.
  if (env.productMode() === 'builder' && profile.role === 'consultant') {
    const { data: existing } = await supabase.from('projects').select('id').eq('owner_id', user.id).limit(1).maybeSingle()
    if (existing) {
      throw new ProjectValidationError(
        'Builders work from one Project -- start a new Workstream there for each customer instead of creating another Project.'
      )
    }
  }
  if (input.knowledgeBaseId) await requireActiveKnowledgeBase(supabase, input.knowledgeBaseId)

  // Project creation approval (project-approval.ts): below curator, the
  // project starts 'pending' -- enforce_project_approval forces that in the
  // DB regardless, this just decides where wizard-picked members go. They
  // can't join until approval, so they're held on the project row instead.
  const needsApproval = !hasRequiredRole(profile.role, 'curator')
  const staged = input.members.filter((m) => m.email && m.email !== user.email)
  const approvals = input.approvals ?? []
  // One lookup covers both staged members and approval assignees (an
  // assignee is always either '__self__' or an email already staged as a
  // member -- the wizard's own UI only offers those two options).
  const emailsToResolve = [...new Set(staged.map((m) => m.email))]
  const idByEmail = emailsToResolve.length > 0 ? await resolveUserIdsByEmail(emailsToResolve) : new Map<string, string>()
  const memberRows = staged
    .map((m) => {
      const userId = idByEmail.get(m.email)
      return userId ? { user_id: userId, role: m.role } : null
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  const { data: project, error } = await supabase
    .from('projects')
    .insert({
      name: input.name,
      project_type: input.projectType,
      objective: input.objective || null,
      status: 'draft',
      notes: null,
      details: input.details,
      owner_id: user.id,
      approval_status: needsApproval ? 'pending' : 'approved',
      pending_members: needsApproval ? memberRows : [],
    })
    .select()
    .single()
  if (error || !project) throw error ?? new Error('Failed to create project')
  await logStatusChange(project.id, null, 'draft', user.id)

  // No separate role/cycle preflight needed here -- the caller is always the
  // brand-new project's owner (create_owner_membership's trigger already
  // fired on the projects insert immediately above), and both trees are
  // built fresh from null roots, so there's no pre-existing cycle to guard
  // against; insertStagedTree's own "no progress" check already catches a
  // malformed staged tree.
  if (input.projectObjects && input.projectObjects.length > 0) {
    await insertStagedTree(supabase, 'project_objects', input.projectObjects, (item, parentId) => ({
      project_id: project.id,
      parent_object_id: parentId,
      name: item.name,
      slug: item.slug,
      description: item.description || null,
      created_by: user.id,
    }))
  }
  if (input.workstreams && input.workstreams.length > 0) {
    await insertStagedTree(supabase, 'project_workstreams', input.workstreams, (item, parentId) => ({
      project_id: project.id,
      parent_workstream_id: parentId,
      name: item.name,
      slug: item.slug,
      status: 'draft',
      repository_scope: [],
      deliverables: [],
      goal: item.goal || null,
      lifecycle_stage: item.lifecycleStage || null,
      created_by: user.id,
    }))
  }

  if (input.knowledgeBaseId) {
    await supabase
      .from('project_knowledge_bases')
      .insert({ project_id: project.id, knowledge_base_id: input.knowledgeBaseId, attached_by: user.id })
  }
  if (input.evalDatasetId) {
    await supabase.from('eval_datasets').update({ project_id: project.id }).eq('id', input.evalDatasetId)
  }

  if (!needsApproval && memberRows.length > 0) {
    await supabase.from('project_members').insert(memberRows.map((m) => ({ ...m, project_id: project.id, status: 'active' as ProjectMemberStatus })))
  }

  if (approvals.length > 0) {
    const policyRows = approvals.map((a) => ({
      project_id: project.id,
      approval_type: a.approvalType,
      requirement_status: a.requirementStatus,
      sequence: null,
      minimum_approvals: 1,
      approval_mode: 'any_authorized' as const,
      allow_self_approval: false,
      monetary_trigger: null,
      discount_trigger_percent: null,
      visibility_scope: 'internal' as const,
      required_before_release: false,
      notes: null,
      created_by: user.id,
    }))
    await supabase.from('project_approval_policies').insert(policyRows)

    const assignmentRows = approvals
      .map((a) => {
        if (!a.assigneeEmail) return null
        const assigneeUserId = a.assigneeEmail === '__self__' ? user.id : idByEmail.get(a.assigneeEmail)
        if (!assigneeUserId) return null
        return {
          project_id: project.id,
          user_id: assigneeUserId,
          business_function: null,
          approval_type: a.approvalType,
          monetary_limit: null,
          discount_limit_percent: null,
          conditions: null,
          effective_from: new Date().toISOString(),
          expires_at: null,
          status: 'active' as const,
          allow_self_approval: false,
          granted_by: user.id,
          granted_at: new Date().toISOString(),
          revoked_by: null,
          revoked_at: null,
          revocation_reason: null,
        }
      })
      .filter((r): r is NonNullable<typeof r> => r !== null)
    if (assignmentRows.length > 0) {
      await supabase.from('project_authority_assignments').insert(assignmentRows)
    }
  }

  return { projectId: project.id, approvalStatus: project.approval_status }
}

// project_knowledge_bases is many-to-many, so attaching an already-active KB
// to a second project is a legitimate reuse, not an error -- kept curator+
// (same bar as authoring knowledge/evals generally), unlike project
// creation itself.
// Same bar as project_knowledge_bases' own RLS (can_curate_project): this
// project's owner/curator, or platform admin. The Server Actions used to
// demand *platform* curator instead, so a project owner who wasn't a
// platform curator saw the Attach button and then got an error.
async function requireProjectKnowledgeCurator(ctx: WorkbenchCallerContext, projectId: string): Promise<void> {
  if (ctx.profile.role === 'admin') return
  const role = await getActiveProjectRole(ctx, projectId)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError("Requires this project's owner or curator role (or platform admin) to manage its knowledge bases")
  }
}

export async function attachKnowledgeBase(ctx: WorkbenchCallerContext, projectId: string, knowledgeBaseId: string) {
  await requireProjectKnowledgeCurator(ctx, projectId)
  await requireActiveKnowledgeBase(ctx.supabase, knowledgeBaseId)

  // OR-036: the real gate, not just listAttachableKnowledgeBases' UI-level
  // filter -- a project_private/selected_projects KB (e.g. "Zadara / Sandz")
  // must never be attachable through this general self-serve path, since
  // kb_vectors_select_scoped grants retrieval purely through
  // project_knowledge_bases membership -- attaching it here would hand the
  // attaching project's own members real content access to a KB meant to
  // stay scoped elsewhere.
  const { data: kb, error: kbError } = await ctx.supabase.from('knowledge_bases').select('visibility_scope, status').eq('id', knowledgeBaseId).maybeSingle()
  if (kbError) throw kbError
  if (!kb || (kb.visibility_scope !== 'platform' && kb.visibility_scope !== 'public')) {
    throw new ProjectValidationError('This knowledge base is scoped to a specific project and cannot be attached here')
  }
  // Pending (awaiting admin review) is fine -- see listAttachableKnowledgeBases.
  if (kb.status === 'rejected') throw new ProjectValidationError('An admin rejected this knowledge base, so it cannot be attached')

  const { error } = await ctx.supabase
    .from('project_knowledge_bases')
    .insert({ project_id: projectId, knowledge_base_id: knowledgeBaseId, attached_by: ctx.user.id })
  if (error) throw error
}

// Project-Aware Knowledge and Assistant Context, Stage 1: the wizard could
// only ever set a KB's attachment at creation time -- there was no way to
// attach or fix one afterward. Detach removes just this project's link row
// (the KB may still be attached elsewhere); kept curator+ (can_curate_project's
// own RLS, via project_knowledge_bases_manage_curator), same bar as attaching.
// Project page's "Create a knowledge base": one step instead of creating it
// in Sources & Curation, waiting for an admin, then coming back to attach.
// Created exactly like the /upload flow's own (createKnowledgeBase in
// app/actions/admin.ts): status 'pending' for admin review, default
// 'platform' visibility. The insert uses the service-role client because a
// project owner/curator need not be a platform curator
// (kb_curator_insert_pending); the attach itself runs under the caller's own
// RLS. If the attach fails, the just-created KB is removed again.
export async function createAndAttachKnowledgeBase(
  ctx: WorkbenchCallerContext,
  projectId: string,
  input: { name: string; description?: string }
): Promise<{ knowledgeBaseId: string }> {
  await requireProjectKnowledgeCurator(ctx, projectId)
  const name = input.name.trim()
  if (!name) throw new ProjectValidationError('Name the knowledge base')

  const admin = createAdminClient()
  const baseId = knowledgeBaseIdFromName(name)
  let knowledgeBaseId = baseId
  let { error: insertError } = await admin
    .from('knowledge_bases')
    .insert({ id: knowledgeBaseId, name, description: input.description?.trim() || null, status: 'pending' })
  // Id (slug) already taken -- retry once with a short suffix, same as
  // DocumentUploader's own create-a-KB path.
  if (insertError?.code === '23505') {
    knowledgeBaseId = `${baseId}-${Date.now().toString(36).slice(-4)}`
    ;({ error: insertError } = await admin
      .from('knowledge_bases')
      .insert({ id: knowledgeBaseId, name, description: input.description?.trim() || null, status: 'pending' }))
  }
  if (insertError) throw insertError

  const { error: attachError } = await ctx.supabase
    .from('project_knowledge_bases')
    .insert({ project_id: projectId, knowledge_base_id: knowledgeBaseId, attached_by: ctx.user.id })
  if (attachError) {
    await admin.from('knowledge_bases').delete().eq('id', knowledgeBaseId)
    throw attachError
  }
  return { knowledgeBaseId }
}

export function knowledgeBaseIdFromName(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'kb'
  )
}

export async function detachKnowledgeBase(ctx: WorkbenchCallerContext, projectId: string, knowledgeBaseId: string) {
  await requireProjectKnowledgeCurator(ctx, projectId)
  const { error } = await ctx.supabase
    .from('project_knowledge_bases')
    .delete()
    .eq('project_id', projectId)
    .eq('knowledge_base_id', knowledgeBaseId)
  if (error) throw error
}

export async function attachEvalDataset(ctx: WorkbenchCallerContext, projectId: string, datasetId: string) {
  const { error } = await ctx.supabase.from('eval_datasets').update({ project_id: projectId }).eq('id', datasetId)
  if (error) throw error
}

export async function updateProjectNotes(ctx: WorkbenchCallerContext, projectId: string, notes: string) {
  const { error } = await ctx.supabase.from('projects').update({ notes: notes || null }).eq('id', projectId)
  if (error) throw error
}

// Draft -> completed, i.e. "not yet approved" -> "approved". Curator or
// admin, by either role system: platform role (curator/admin) OR project
// role (owner/curator for this specific project) -- same bar as
// canCurateWorkstreams on the project page. Uses the service-role client
// deliberately, not a new RLS policy: projects_update_managers (the
// existing UPDATE policy) is owner-or-admin only, and widening it to admit
// curators would let a project curator edit ANY column on the row (notes,
// goal, public_profile, ...), not just status -- RLS is row-level, not
// column-level. The permission check below is the real gate for this one
// narrow column.
export async function approveProject(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  const admin = createAdminClient()
  // Approve is intentionally unconditional (works from any pre-approved
  // status, not just 'review') -- read the current value first so the
  // history entry's from_status is accurate rather than assumed.
  const { data: before, error: readError } = await admin.from('projects').select('status').eq('id', projectId).single()
  if (readError || !before) throw readError ?? new Error('Project not found')
  if (before.status === 'completed' || before.status === 'live') throw new ProjectValidationError('This project is already approved')
  const { error } = await admin.from('projects').update({ status: 'completed' }).eq('id', projectId)
  if (error) throw error
  await logStatusChange(projectId, before.status, 'completed', ctx.user.id)
}

// Initial Draft -> Working on it -> For Approval -> Approved (or back to
// Working on it). Same permission bar as approveProject -- whoever can
// approve a project can also move it through the stages leading up to
// that. Each transition function only fires from its expected prior status
// -- the .eq(...) guard, checked via the returned row so a stale/raced
// click reports a clear error instead of silently logging a transition
// that didn't happen.
async function requireCanApprove(ctx: WorkbenchCallerContext, projectId: string) {
  const { user, profile, supabase } = ctx
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', user.id)
    .maybeSingle()
  const canApprove =
    profile.role === 'admin' || profile.role === 'curator' || membership?.role === 'owner' || membership?.role === 'curator'
  if (!canApprove) throw new AuthError('Only a curator or admin can update this project\'s status')
}

// Written only from here (the service layer), never a database trigger --
// see the migration comment for why actor_id needs the real acting user
// rather than auth.uid(). Best-effort: a logging failure must not turn a
// successful status change into a reported failure.
async function logStatusChange(projectId: string, fromStatus: ProjectStatus | null, toStatus: ProjectStatus, actorId: string) {
  try {
    const admin = createAdminClient()
    await admin.from('project_status_history').insert({ project_id: projectId, from_status: fromStatus, to_status: toStatus, actor_id: actorId })
  } catch (err) {
    console.error(`Failed to log project status change (${projectId}: ${fromStatus} -> ${toStatus}):`, err)
  }
}

async function transitionProjectStatus(projectId: string, from: ProjectStatus, to: ProjectStatus, actorId: string) {
  const admin = createAdminClient()
  const { data, error } = await admin.from('projects').update({ status: to }).eq('id', projectId).eq('status', from).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError(`Project is not currently "${from}" -- someone else may have already changed its status`)
  await logStatusChange(projectId, from, to, actorId)
}

export async function startWorkingOnProject(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  await transitionProjectStatus(projectId, 'draft', 'active', ctx.user.id)
}

export async function submitProjectForApproval(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  await transitionProjectStatus(projectId, 'active', 'review', ctx.user.id)
}

export async function sendProjectBackToWorking(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  await transitionProjectStatus(projectId, 'review', 'active', ctx.user.id)
}

// Approved -> Live: the client has approved the project (normally through
// its workstream presentation), so it's in production and in maintenance.
export async function markProjectLive(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  await transitionProjectStatus(projectId, 'completed', 'live', ctx.user.id)
}

// Approved -> Working on it, when the client asks for changes before
// go-live. A Live project is never reopened: bug fixes and new features
// are new workstreams inside it, and it stays Live meanwhile.
export async function reopenProject(ctx: WorkbenchCallerContext, projectId: string) {
  await requireCanApprove(ctx, projectId)
  await transitionProjectStatus(projectId, 'completed', 'active', ctx.user.id)
}

export async function listProjectStatusHistory(ctx: WorkbenchCallerContext, projectId: string) {
  const { data, error } = await ctx.supabase
    .from('project_status_history')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Shared method/approach, common to every workstream in the project -- see
// the `goal` column comment on the Project type. Same owner/admin-only gate
// as updateProjectNotes (projects_update_managers).
export async function updateProjectGoal(ctx: WorkbenchCallerContext, projectId: string, goal: string) {
  const { error } = await ctx.supabase.from('projects').update({ goal: goal.trim() || null }).eq('id', projectId)
  if (error) throw error
}

// A short, clickable prompt Ember offers when opened bound to this project
// (ChatPanel.tsx's project-bound empty state) -- the Sandz Pilot Meeting
// Brief's onboarding pattern explicitly calls for one per Q&A/feedback
// Project (e.g. "Ask anything about the Sandz pilot, suggest an
// improvement, or report a problem"). Deliberately owner/curator/admin, not
// projects_update_managers' owner-only RLS -- a project curator should be
// able to set this for their own team's Project, so this writes via the
// admin client after an explicit check, same pattern as
// createAndAddProjectMember/approveSourceSubmission.
export async function updateProjectStarterPrompt(ctx: WorkbenchCallerContext, projectId: string, starterPrompt: string): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator') {
      throw new AuthError('Requires this project\'s owner or curator role (or platform admin) to set its starter prompt')
    }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ starter_prompt: starterPrompt.trim() || null }).eq('id', projectId)
  if (error) throw error
}

// The one-line description under the project title (the `objective`
// column, set by ProjectWizard at creation). Same owner/curator/admin bar
// and admin-client-after-explicit-check pattern as
// updateProjectStarterPrompt above -- a curator should be able to fix their
// own team's Project description, not just its owner.
export async function updateProjectObjective(ctx: WorkbenchCallerContext, projectId: string, objective: string): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator') {
      throw new AuthError('Requires this project\'s owner or curator role (or platform admin) to edit its description')
    }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ objective: objective.trim() || null }).eq('id', projectId)
  if (error) throw error
}

// "My Projects" list grouping (2026-09-04) -- same owner/curator/admin bar
// and same admin-client-after-explicit-check pattern as
// updateProjectStarterPrompt above, for the same reason: a project curator
// should be able to (re)classify their own team's Project, not just its
// owner (projects_update_managers/can_manage_project is owner-only).
export async function updateProjectPortfolioCategory(
  ctx: WorkbenchCallerContext,
  projectId: string,
  category: PortfolioCategory
): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator') {
      throw new AuthError('Requires this project\'s owner or curator role (or platform admin) to set its category')
    }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ portfolio_category: category }).eq('id', projectId)
  if (error) throw error
}

// Project directory opt-in (OR-036) -- same owner/curator/admin bar and
// admin-client-after-explicit-check pattern as updateProjectStarterPrompt/
// updateProjectPortfolioCategory above.
export async function updateProjectDiscoverability(
  ctx: WorkbenchCallerContext,
  projectId: string,
  discoverability: ProjectDiscoverability
): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    const role = await getActiveProjectRole(ctx, projectId)
    if (role !== 'owner' && role !== 'curator') {
      throw new AuthError('Requires this project\'s owner or curator role (or platform admin) to change its discoverability')
    }
  }
  const admin = createAdminClient()
  const { error } = await admin.from('projects').update({ discoverability }).eq('id', projectId)
  if (error) throw error
}

// Permanent removal -- platform admins only. Owners/curators "archive"
// instead (portfolio_category = 'archived', via
// updateProjectPortfolioCategory), which is reversible. projects has no
// delete RLS policy at all, so this goes through the admin client after an
// explicit check, same pattern as updateProjectStarterPrompt. Every FK to
// projects is ON DELETE CASCADE (members, workstreams, notes, assessments,
// governance, ...) or SET NULL (conversations, knowledge_bases, clones'
// cloned_from_project_id, ...), so one delete removes the project's own
// data and unlinks everything else. confirmName must match the current
// name exactly -- a server-side guard against deleting the wrong one of two
// similarly named projects, not just a UI nicety.
export async function deleteProject(ctx: WorkbenchCallerContext, projectId: string, confirmName: string): Promise<void> {
  if (ctx.profile.role !== 'admin') {
    throw new AuthError('Only a platform admin can permanently delete a project -- archive it instead')
  }
  const admin = createAdminClient()
  const { data: project, error: readError } = await admin
    .from('projects')
    .select('name, is_organization_home')
    .eq('id', projectId)
    .maybeSingle()
  if (readError) throw readError
  if (!project) throw new ProjectValidationError('Project not found')
  if (project.is_organization_home) {
    throw new ProjectValidationError('The Organization Home project cannot be deleted')
  }
  if (confirmName.trim() !== project.name) {
    throw new ProjectValidationError('The name you typed does not match this project\'s name')
  }
  const { error } = await admin.from('projects').delete().eq('id', projectId)
  if (error) throw error
}

// Every newly created account is auto-enrolled in the Organization Home
// project (OR-036, Mike) -- makes it genuinely function as "everyone's home
// base" without relying on discovery + a manual join request for the one
// Project every user should always have. Called right after account
// creation from both createAndAddProjectMember (below) and createUserAction
// (src/app/actions/admin.ts). Takes an already-built admin client, not a
// WorkbenchCallerContext -- this is an internal step of account creation,
// not its own authorized action, and both call sites already have one.
// on conflict do nothing: safe no-op if the caller happened to be adding
// the user to the org-home project itself, and safe no-op (zero rows
// matched) if no project is currently flagged as the org home.
export async function enrollInOrganizationHome(admin: ReturnType<typeof createAdminClient>, userId: string): Promise<void> {
  const { data: homeProject, error: homeError } = await admin.from('projects').select('id').eq('is_organization_home', true).maybeSingle()
  if (homeError) throw homeError
  if (!homeProject) return

  const { error } = await admin
    .from('project_members')
    .upsert({ project_id: homeProject.id, user_id: userId, role: 'viewer', status: 'active' }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
  if (error) throw error
}

// KB Sandbox Builder (docs/dev-request-kb-sandbox-builder-product.md): each
// builder gets exactly one Project, auto-provisioned once at account
// creation -- not one Project per client/opportunity. A new client is a
// Workstream (the builder's proposal) on this same Project; once the client
// accepts it, workstream promotion (workstream-promotions.ts) creates the
// client Project, owned by the builder with the client as viewers. A
// Workstream already has status/goal/deliverables and its own
// workstream_artifacts evidence trail -- no new schema needed for that,
// and the builder's own free-form research/CRM notes are a Working
// Knowledge item on it. Called from createUserAction (app/actions/admin.ts)
// only when the deployment is in builder mode and the new account's
// platform role is 'consultant' -- gating lives at the call site, this
// function is unconditional (same separation as enrollInOrganizationHome
// above). The projects_create_owner_membership trigger handles adding the
// builder as 'owner' -- no separate project_members insert needed here.
export async function provisionBuilderProject(admin: ReturnType<typeof createAdminClient>, userId: string, email: string): Promise<void> {
  const label = email.split('@')[0] || 'Builder'
  const { error } = await admin.from('projects').insert({
    name: `${label} — Builder Workspace`,
    project_type: 'consulting',
    owner_id: userId,
    portfolio_category: 'builder_lab',
    discoverability: 'members_only',
  })
  if (error) throw error
}

// Builder AI Usage Metering + BYOLLM (src/lib/ai/metering.ts,
// src/lib/workbench/builder-llm-credentials.ts): both need to know "is this
// conversation's project genuinely this caller's own builder workspace"
// before metering/substituting a provider for it -- same portfolio_category
// check listBuilderOperationsRows already uses to enumerate builder
// workspaces, here scoped to one specific project and caller via the
// caller's own RLS-scoped client (a caller can always see their own owned
// project row, so no admin client is needed).
export async function isOwnBuilderLabProject(ctx: WorkbenchCallerContext, projectId: string): Promise<boolean> {
  const { data: project } = await ctx.supabase
    .from('projects')
    .select('owner_id, portfolio_category')
    .eq('id', projectId)
    .maybeSingle()
  return project?.owner_id === ctx.user.id && project?.portfolio_category === 'builder_lab'
}

// Backs the Ember search_projects tool (docs/dev-request-ember-onboarding-
// capability-gaps.md, item 1) -- lets Ember discover an existing project
// before proposing to create a new one, closing the gap where she had no
// way to find the existing Sandz-Zadara pilots even after being told about
// them. Uses the caller's own RLS-scoped client throughout, like every
// other read in this file (unlike searchProfilesByEmail below, which
// deliberately needs the admin client) -- results are automatically
// limited to whatever projects this caller can already see.
export async function searchProjects(
  ctx: WorkbenchCallerContext,
  query: string,
  limit = 10
): Promise<{ id: string; name: string; projectType: ProjectType; status: ProjectStatus; objective: string | null }[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []

  const { data, error } = await ctx.supabase
    .from('projects')
    .select('id, name, project_type, status, objective')
    .ilike('name', `%${trimmed}%`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []).map((p) => ({ id: p.id, name: p.name, projectType: p.project_type, status: p.status, objective: p.objective }))
}

// Minimal cross-user lookup backing the "add existing user" controls (the
// wizard's Team step and the Members page) -- returns only id+email, never
// role/is_active/anything else. See resolveUserIdsByEmail's comment for why
// this needs the service-role client at all.
export async function searchProfilesByEmail(ctx: WorkbenchCallerContext, query: string): Promise<{ id: string; email: string }[]> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to search for teammates')
  if (query.trim().length < 2) return []

  const admin = createAdminClient()
  const { data, error } = await admin.from('profiles').select('id, email').ilike('email', `%${query.trim()}%`).limit(10)
  if (error) throw error
  return (data ?? []).filter((p): p is { id: string; email: string } => Boolean(p.email))
}

// Project-member management. All four rely on RLS (can_manage_project --
// active 'owner' membership or platform admin) as the real gate; the
// anonymous check here just rejects anonymous sessions early with a clearer
// error than a raw policy violation.
export async function addProjectMember(ctx: WorkbenchCallerContext, projectId: string, email: string, role: ProjectRole) {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to manage project members')

  const idByEmail = await resolveUserIdsByEmail([email])
  const userId = idByEmail.get(email)
  if (!userId) throw new ProjectValidationError(`No account found for ${email}`)

  const { error } = await ctx.supabase.from('project_members').insert({ project_id: projectId, user_id: userId, role, status: 'active' })
  if (error) throw error
}

// Collapses the two-step "create the account on /admin, then go add them to
// the project" flow into one -- addProjectMember above throws "No account
// found" for anyone who hasn't been created yet, which was the real
// remaining gap in Project onboarding (self-serve /register is removed,
// see createUserAction's comment in app/actions/admin.ts). A platform admin
// can call this for anyone at any platform role; a project owner/curator
// (confirmed by Mike 2026-09-03 -- the curator is the department head who
// knows their own staff and needs to invite them directly, not bounce every
// invite through an admin) can also call it for their own project, but is
// capped to platformRole 'member'/'consultant' -- minting a new curator or
// admin account stays an admin-only escalation. This directly creates an
// auth user + profile via the service-role client (bypasses RLS entirely),
// so unlike addProjectMember's insert below, RLS is *not* the real gate
// here -- this explicit check is, same defense-in-depth spirit as every
// admin action in app/actions/admin.ts.
export async function createAndAddProjectMember(
  ctx: WorkbenchCallerContext,
  input: { projectId: string; email: string; password: string; projectRole: ProjectRole; platformRole: 'member' | 'consultant' | 'curator' | 'admin' }
) {
  if (ctx.profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, input.projectId)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError('Requires admin role, or an active owner/curator membership on this project')
    }
    if (input.platformRole === 'curator' || input.platformRole === 'admin') {
      throw new AuthError('Only a platform admin can create a curator or admin account')
    }
  }
  if (input.password.length < 8) throw new ProjectValidationError('Password must be at least 8 characters')

  const admin = createAdminClient()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  })
  if (createError) throw createError

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    email: input.email,
    full_name: null,
    role: input.platformRole,
    is_active: true,
    assigned_kbs: [],
  })
  if (profileError) throw profileError

  const { error: memberError } = await ctx.supabase
    .from('project_members')
    .insert({ project_id: input.projectId, user_id: created.user.id, role: input.projectRole, status: 'active' })
  if (memberError) throw memberError

  await enrollInOrganizationHome(admin, created.user.id)
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export interface BulkAddResultRow {
  email: string
  status: 'added' | 'created' | 'skipped' | 'failed'
  password?: string
  error?: string
}

// "Add all Sandz employees" (e.g. onboarding a whole department to a Sandz
// HR project) one email at a time is real friction -- this is the same
// batching a curator would otherwise do by hand, just sequential calls to
// addProjectMember/createAndAddProjectMember so authorization (including
// the non-admin platformRole cap on new accounts) stays byte-for-byte the
// same as the single-add path, never a second, drifting implementation.
// Duplicate/blank/malformed entries are reported per-row, not silently
// dropped, so the curator can see exactly what happened to every line they
// pasted or uploaded.
export async function bulkAddProjectMembers(
  ctx: WorkbenchCallerContext,
  input: {
    projectId: string
    emails: string[]
    projectRole: ProjectRole
    platformRoleForNew: 'member' | 'consultant' | 'curator' | 'admin'
  }
): Promise<BulkAddResultRow[]> {
  const results: BulkAddResultRow[] = []
  const seen = new Set<string>()

  for (const raw of input.emails) {
    const email = raw.trim()
    if (!email) continue
    if (seen.has(email)) {
      results.push({ email, status: 'skipped', error: 'Duplicate in this batch' })
      continue
    }
    seen.add(email)
    if (!EMAIL_LIKE.test(email)) {
      results.push({ email, status: 'failed', error: 'Not a valid email address' })
      continue
    }

    try {
      await addProjectMember(ctx, input.projectId, email, input.projectRole)
      results.push({ email, status: 'added' })
    } catch (err) {
      if (err instanceof ProjectValidationError && err.message === `No account found for ${email}`) {
        const password = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        try {
          await createAndAddProjectMember(ctx, {
            projectId: input.projectId,
            email,
            password,
            projectRole: input.projectRole,
            platformRole: input.platformRoleForNew,
          })
          results.push({ email, status: 'created', password })
        } catch (createErr) {
          results.push({ email, status: 'failed', error: createErr instanceof Error ? createErr.message : 'Failed to create account' })
        }
      } else {
        results.push({ email, status: 'failed', error: err instanceof Error ? err.message : 'Failed to add' })
      }
    }
  }

  return results
}

export async function updateProjectMemberRole(ctx: WorkbenchCallerContext, memberId: string, role: ProjectRole) {
  const { error } = await ctx.supabase.from('project_members').update({ role }).eq('id', memberId)
  if (error) throw error
}

export async function updateProjectMemberStatus(ctx: WorkbenchCallerContext, memberId: string, status: ProjectMemberStatus) {
  const { error } = await ctx.supabase.from('project_members').update({ status }).eq('id', memberId)
  if (error) throw error
}

// A project always has exactly one owner_id -- transferring ownership moves
// it, promotes the target membership to 'owner', and demotes whoever held it
// before to 'curator' rather than leaving a stale/conflicting owner row.
export async function transferOwnership(ctx: WorkbenchCallerContext, projectId: string, newOwnerMemberId: string) {
  const { supabase } = ctx

  const { data: newOwnerMember, error: memberError } = await supabase
    .from('project_members')
    .select('user_id')
    .eq('id', newOwnerMemberId)
    .single()
  if (memberError || !newOwnerMember) throw memberError ?? new ProjectValidationError('Member not found')

  const { data: project, error: projectError } = await supabase.from('projects').select('owner_id').eq('id', projectId).single()
  if (projectError || !project) throw projectError ?? new ProjectValidationError('Project not found')

  const { error: updateProjectError } = await supabase
    .from('projects')
    .update({ owner_id: newOwnerMember.user_id })
    .eq('id', projectId)
  if (updateProjectError) throw updateProjectError

  const { error: promoteError } = await supabase.from('project_members').update({ role: 'owner' }).eq('id', newOwnerMemberId)
  if (promoteError) throw promoteError

  if (project.owner_id && project.owner_id !== newOwnerMember.user_id) {
    await supabase.from('project_members').update({ role: 'curator' }).eq('project_id', projectId).eq('user_id', project.owner_id)
  }
}

// Publication. All three rely on RLS (can_manage_project -- active 'owner'
// membership or platform admin, via the existing projects_update_managers
// policy, which already covers these columns since they're on the same
// row) as the real gate -- the anonymous check here is the same
// defense-in-depth convention as every other function in this module. No
// curator-drafting tier: the design doc is explicit that owner/admin
// publishing is sufficient for this milestone, no approval workflow.
export async function savePublicProfileDraft(ctx: WorkbenchCallerContext, projectId: string, profile: PublicProjectProfile) {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to manage a project')

  const { error } = await ctx.supabase.from('projects').update({ public_profile: profile }).eq('id', projectId)
  if (error) throw error
}

export async function publishProject(ctx: WorkbenchCallerContext, projectId: string, publicSlug: string) {
  const { user, profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError('Create an account to manage a project')

  const { error } = await supabase
    .from('projects')
    .update({ visibility: 'public', published_at: new Date().toISOString(), published_by: user.id, public_slug: publicSlug })
    .eq('id', projectId)
  if (error) {
    if (error.code === '23505') throw new ProjectValidationError('That URL is already taken -- choose a different one')
    throw error
  }
}

// Stricter than the rest of the publish flow (which is owner-or-admin via
// can_manage_project RLS): "full data exposure" -- real workstreams,
// artifacts, and assessment responses, not just the curated public_profile
// summary -- is gated to platform admins only, enforced here at the
// application layer since RLS alone can't distinguish "admin-only" from
// "owner-or-admin" on the same projects_update_managers policy. Deliberately
// per-project (not global): every other published project keeps
// public_full_detail=false unless an admin opts it in individually.
export async function setPublicFullDetail(ctx: WorkbenchCallerContext, projectId: string, enabled: boolean) {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only a platform admin can enable full data exposure for a published project')

  const { error } = await ctx.supabase.from('projects').update({ public_full_detail: enabled }).eq('id', projectId)
  if (error) throw error
}

// Frees the slug (so it can be reused later) but preserves public_profile
// draft content -- unpublishing shouldn't lose the owner's work.
export async function unpublishProject(ctx: WorkbenchCallerContext, projectId: string) {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to manage a project')

  const { error } = await ctx.supabase
    .from('projects')
    .update({ visibility: 'private', published_at: null, published_by: null, public_slug: null })
    .eq('id', projectId)
  if (error) throw error
}
