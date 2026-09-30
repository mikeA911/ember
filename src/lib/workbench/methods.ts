import 'server-only'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { Method, TableUpdate } from '@/types/database'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Builder Ontology, Part C (docs/kbs-ontology-dev-req-3.md): a reusable
// Method a builder promotes from a Workstream that worked. Deliberately
// narrowed scope for this pass (see the migration's own header comment):
// ships the table, promotion-from-workstream, and instantiation. Ember
// checking published Methods before proposing a new workstream tree during
// the wizard's own step is a separate, deferred loop.ts change.

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

// Same curator-or-admin write-guard shape as workstream-relationships.ts's
// own private requireCuratorForWorkstream -- kept as its own local copy
// (this codebase's own convention, not a shared helper -- see project-
// objects.ts/project-cloning.ts's identical local copies) since promoting a
// Workstream to a Method is the same authorization bar as defining its
// structure.
async function requireCuratorForWorkstream(ctx: WorkbenchCallerContext, workstreamId: string, actionLabel: string): Promise<string> {
  const { profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError(`Create an account to ${actionLabel}`)
  const { data: workstream, error } = await supabase.from('project_workstreams').select('project_id').eq('id', workstreamId).single()
  if (error || !workstream) throw error ?? new ProjectValidationError('Workstream not found')
  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, workstream.project_id)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `To ${actionLabel} you need this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }.`
      )
    }
  }
  return workstream.project_id as string
}

export async function createMethodFromWorkstream(
  ctx: WorkbenchCallerContext,
  workstreamId: string,
  input: { name: string; description?: string; guardrails?: string }
): Promise<{ methodId: string }> {
  await requireCuratorForWorkstream(ctx, workstreamId, 'promote this workstream to a Method')

  const { data, error } = await ctx.supabase
    .from('methods')
    .insert({
      name: input.name,
      slug: slugify(input.name) || `method-${Date.now().toString(36)}`,
      description: input.description || null,
      derived_from_workstream_id: workstreamId,
      guardrails: input.guardrails || null,
      status: 'draft',
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error) {
    // methods.slug is globally unique -- two builders promoting similarly-
    // named workstreams the same day is a real, likely collision, not an
    // edge case.
    if (error.code === '23505') throw new ProjectValidationError('A Method with a similar name already exists -- try a more specific name')
    throw error
  }
  if (!data) throw new ProjectValidationError('Failed to create method')
  return { methodId: data.id }
}

// RLS (methods_manage_own_draft's own WITH CHECK, status = 'draft') is the
// real backstop against editing a published Method through this path -- the
// service layer here just does the write and reports zero-rows-updated as
// a permission error, same convention as toggleDeliverable/
// updateWorkstreamSummary (workstreams.ts).
export async function updateMethodDraft(
  ctx: WorkbenchCallerContext,
  methodId: string,
  patch: {
    name?: string
    description?: string | null
    requirements?: string | null
    evidence?: string | null
    deliverables?: string | null
    guardrails?: string | null
    reviewPoints?: string | null
  }
): Promise<{ methodId: string }> {
  const update: TableUpdate<'methods'> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.description !== undefined) update.description = patch.description || null
  if (patch.requirements !== undefined) update.requirements = patch.requirements || null
  if (patch.evidence !== undefined) update.evidence = patch.evidence || null
  if (patch.deliverables !== undefined) update.deliverables = patch.deliverables || null
  if (patch.guardrails !== undefined) update.guardrails = patch.guardrails || null
  if (patch.reviewPoints !== undefined) update.review_points = patch.reviewPoints || null

  const { data, error } = await ctx.supabase.from('methods').update(update).eq('id', methodId).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError('You do not have permission to edit this method (it may already be published)')
  }
  return { methodId }
}

// Platform curator/admin only -- same bar as decideCapabilityEvaluation
// (capability-evaluations.ts) and rejectWorkstreamPromotion's own staff-only
// decision policies. Deliberately a platform-role check, not
// can_curate_project -- a Method is meant to be reviewed by the operator
// before other builders can see it, not self-published by whoever curates
// the source workstream's own project.
export async function publishMethod(ctx: WorkbenchCallerContext, methodId: string): Promise<{ methodId: string }> {
  if (ctx.profile.role !== 'curator' && ctx.profile.role !== 'admin') {
    throw new AuthError('Only a platform curator or admin can publish a Method')
  }
  const { data, error } = await ctx.supabase
    .from('methods')
    .update({ status: 'published', published_by: ctx.user.id, published_at: new Date().toISOString() })
    .eq('id', methodId)
    .eq('status', 'draft')
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('Method not found, or it is not currently a draft')
  return { methodId }
}

// Any authenticated non-anonymous caller -- RLS (methods_select_published_
// or_own_draft's status = 'published' arm) already permits this for
// everyone; the .eq() below just matches this function's own name/intent
// (a public browse list), same as listPublishedMethods never accidentally
// returning someone's own visible draft alongside it.
export async function listPublishedMethods(ctx: WorkbenchCallerContext): Promise<Method[]> {
  const { data, error } = await ctx.supabase.from('methods').select('*').eq('status', 'published').order('published_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Platform-wide review queue, mirrors listPendingWorkstreamPromotions'
// (workstream-promotions.ts) own convention -- RLS already scopes this to
// every draft for a curator/admin caller, or just the caller's own
// originating drafts otherwise; an ungated fetch just returns less for
// anyone else.
export async function listPendingMethods(ctx: WorkbenchCallerContext): Promise<Method[]> {
  const { data, error } = await ctx.supabase.from('methods').select('*').eq('status', 'draft').order('created_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function getMethod(ctx: WorkbenchCallerContext, methodId: string): Promise<Method | null> {
  const { data, error } = await ctx.supabase.from('methods').select('*').eq('id', methodId).maybeSingle()
  if (error) throw error
  return data
}

// Method -> new Workstream in the caller's own Project. Only guardrails is
// pre-filled (editable, not locked) -- requirements/evidence/deliverables/
// review_points stay reference material on the Method's own page, not
// copied in (copying them by default risks stale boilerplate); guardrails
// is the one field with a direct, already-existing runtime home
// (project_workstreams.guardrail), so it alone gets carried over.
export async function instantiateMethodAsWorkstream(
  ctx: WorkbenchCallerContext,
  input: { methodId: string; projectId: string; name: string }
): Promise<{ workstreamId: string; projectId: string }> {
  const { user, profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError('Create an account to instantiate a method')
  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, input.projectId)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `Instantiating a Method needs this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }.`
      )
    }
  }

  const { data: method, error: methodError } = await supabase
    .from('methods')
    .select('guardrails')
    .eq('id', input.methodId)
    .eq('status', 'published')
    .maybeSingle()
  if (methodError) throw methodError
  if (!method) throw new ProjectValidationError('Method not found, or it is not currently published')

  const { data, error } = await supabase
    .from('project_workstreams')
    .insert({
      project_id: input.projectId,
      name: input.name,
      slug: slugify(input.name) || `workstream-${Date.now().toString(36)}`,
      status: 'draft',
      repository_scope: [],
      goal: null,
      guardrail: method.guardrails,
      deliverables: [],
      derived_from_method_id: input.methodId,
      created_by: user.id,
    })
    .select('id')
    .single()
  if (error) {
    if (error.code === '23505') throw new ProjectValidationError('A workstream with a similar name already exists in this project')
    throw error
  }
  if (!data) throw new ProjectValidationError('Failed to instantiate method')
  return { workstreamId: data.id, projectId: input.projectId }
}
