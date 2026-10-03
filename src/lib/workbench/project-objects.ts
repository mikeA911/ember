import 'server-only'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { TableUpdate } from '@/types/database'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md): a per-project
// domain-object ontology -- a self-referencing tree of the domain object
// TYPES that matter for this specific builder's business (e.g. Plane/Route
// for an airline client, Sensor/AnomalyEvent for a riverbank-monitoring
// client), not instances of those types. Same 3-step write-guard shape as
// createWorkstream (workstreams.ts's own OL-002 comment): reject anonymous,
// explicit curator-or-admin check with a friendly error naming the caller's
// actual role, then the real write via ctx.supabase (RLS --
// project_objects_manage_curator -- is the actual enforcement).

async function requireCuratorForProject(ctx: WorkbenchCallerContext, projectId: string, actionLabel: string) {
  const { profile } = ctx
  if (profile.role === 'anonymous') throw new AuthError(`Create an account to ${actionLabel}`)
  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, projectId)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `To ${actionLabel} you need this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }.`
      )
    }
  }
}

// Friendly pre-check mirroring the DB trigger (prevent_project_object_cycle)
// -- the trigger is the real enforcement; this turns a raw trigger exception
// into an actionable message before the round trip.
async function assertNoProjectObjectCycle(ctx: WorkbenchCallerContext, candidateParentId: string, objectId: string | null) {
  let cursorId: string | null = candidateParentId
  const seen = new Set<string>()
  while (cursorId) {
    if (objectId && cursorId === objectId) throw new ProjectValidationError('That parent would create a cycle in the object tree')
    if (seen.has(cursorId)) break
    seen.add(cursorId)
    const { data }: { data: { parent_object_id: string | null } | null } = await ctx.supabase
      .from('project_objects')
      .select('parent_object_id')
      .eq('id', cursorId)
      .maybeSingle()
    cursorId = data?.parent_object_id ?? null
  }
}

export async function createProjectObject(
  ctx: WorkbenchCallerContext,
  input: { projectId: string; parentObjectId?: string | null; name: string; slug: string; description?: string }
) {
  await requireCuratorForProject(ctx, input.projectId, 'define a project object')
  if (input.parentObjectId) await assertNoProjectObjectCycle(ctx, input.parentObjectId, null)

  const { data, error } = await ctx.supabase
    .from('project_objects')
    .insert({
      project_id: input.projectId,
      parent_object_id: input.parentObjectId || null,
      name: input.name,
      slug: input.slug,
      description: input.description || null,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new ProjectValidationError('Failed to create project object')
  return { objectId: data.id, projectId: input.projectId }
}

export async function updateProjectObject(
  ctx: WorkbenchCallerContext,
  objectId: string,
  patch: { name?: string; description?: string | null; parentObjectId?: string | null }
) {
  const { data: existing, error: fetchError } = await ctx.supabase
    .from('project_objects')
    .select('id, project_id')
    .eq('id', objectId)
    .single()
  if (fetchError || !existing) throw fetchError ?? new ProjectValidationError('Project object not found')

  if (patch.parentObjectId) await assertNoProjectObjectCycle(ctx, patch.parentObjectId, objectId)

  const update: TableUpdate<'project_objects'> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description || null
  if (patch.parentObjectId !== undefined) update.parent_object_id = patch.parentObjectId || null

  const { data, error } = await ctx.supabase.from('project_objects').update(update).eq('id', objectId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to update this project object')
  return { projectId: existing.project_id }
}

// Deleting a node deletes its subtree (parent_object_id ... on delete
// cascade) -- same cascade convention used throughout this schema, not a
// soft-delete.
export async function deleteProjectObject(ctx: WorkbenchCallerContext, objectId: string) {
  const { data, error } = await ctx.supabase.from('project_objects').delete().eq('id', objectId).select('id, project_id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to delete this project object')
  return { projectId: data[0].project_id }
}

export async function listProjectObjects(ctx: WorkbenchCallerContext, projectId: string) {
  const { data, error } = await ctx.supabase
    .from('project_objects')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}
