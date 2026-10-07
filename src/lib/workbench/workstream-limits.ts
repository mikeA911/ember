import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { WorkbenchCallerContext } from './context'

// A builder's own workspace holds up to 20 workstreams; projects created by
// promotion don't count. The builder asks for more with a reason and the
// platform admin decides (20261029100001_client_source_and_workstream_
// limits.sql, whose trigger is the real gate -- this is for the UI).
export const DEFAULT_WORKSTREAM_LIMIT = 20

export interface WorkstreamAllowance {
  builderId: string
  used: number
  limit: number
  pendingRequest: { requestedLimit: number; createdAt: string } | null
}

// A builder's own workspaces: builder_lab Projects they own that no
// promotion created. Admin client: a narrow lookup, never their content.
export async function workspaceIdsOf(admin: ReturnType<typeof createAdminClient>, builderId: string): Promise<string[]> {
  const { data: projects, error } = await admin.from('projects').select('id').eq('owner_id', builderId).eq('portfolio_category', 'builder_lab')
  if (error) throw error
  const ids = (projects ?? []).map((p) => p.id)
  if (ids.length === 0) return []
  const { data: promoted, error: promotedError } = await admin
    .from('workstream_promotions')
    .select('created_project_id')
    .in('created_project_id', ids)
    .eq('status', 'approved')
  if (promotedError) throw promotedError
  const promotedIds = new Set((promoted ?? []).map((p) => p.created_project_id))
  return ids.filter((id) => !promotedIds.has(id))
}

// null when the project isn't a builder's workspace, or its owner is an
// admin -- no limit applies.
export async function getWorkstreamAllowanceForProject(projectId: string): Promise<WorkstreamAllowance | null> {
  const admin = createAdminClient()
  const { data: project, error } = await admin.from('projects').select('owner_id, portfolio_category').eq('id', projectId).maybeSingle()
  if (error) throw error
  if (!project?.owner_id || project.portfolio_category !== 'builder_lab') return null
  const { data: owner, error: ownerError } = await admin.from('profiles').select('role').eq('id', project.owner_id).maybeSingle()
  if (ownerError) throw ownerError
  if (owner?.role === 'admin') return null
  const workspaceIds = await workspaceIdsOf(admin, project.owner_id)
  if (!workspaceIds.includes(projectId)) return null
  return getWorkstreamAllowance(admin, project.owner_id, workspaceIds)
}

async function getWorkstreamAllowance(
  admin: ReturnType<typeof createAdminClient>,
  builderId: string,
  workspaceIds: string[]
): Promise<WorkstreamAllowance> {
  const [{ count, error: countError }, { data: limitRow, error: limitError }, { data: pending, error: pendingError }] = await Promise.all([
    admin.from('project_workstreams').select('id', { count: 'exact', head: true }).in('project_id', workspaceIds),
    admin.from('builder_workstream_limits').select('workstream_limit').eq('builder_id', builderId).maybeSingle(),
    admin
      .from('builder_workstream_limit_requests')
      .select('requested_limit, created_at')
      .eq('builder_id', builderId)
      .eq('status', 'pending')
      .maybeSingle(),
  ])
  if (countError) throw countError
  if (limitError) throw limitError
  if (pendingError) throw pendingError
  return {
    builderId,
    used: count ?? 0,
    limit: limitRow?.workstream_limit ?? DEFAULT_WORKSTREAM_LIMIT,
    pendingRequest: pending ? { requestedLimit: pending.requested_limit, createdAt: pending.created_at } : null,
  }
}

// The builder asks for a higher limit, with a reason.
export async function requestMoreWorkstreams(ctx: WorkbenchCallerContext, input: { requestedLimit: number; reason: string }): Promise<void> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Sign in to request more workstreams')
  const reason = input.reason.trim()
  if (!reason) throw new ProjectValidationError('Say why you need more workstreams')
  if (!Number.isInteger(input.requestedLimit) || input.requestedLimit <= 0) throw new ProjectValidationError('Enter how many workstreams you need in total')

  const { data: limitRow, error: limitError } = await ctx.supabase
    .from('builder_workstream_limits')
    .select('workstream_limit')
    .eq('builder_id', ctx.user.id)
    .maybeSingle()
  if (limitError) throw limitError
  const current = limitRow?.workstream_limit ?? DEFAULT_WORKSTREAM_LIMIT
  if (input.requestedLimit <= current) throw new ProjectValidationError(`Ask for more than your current limit of ${current}`)

  const { error } = await ctx.supabase
    .from('builder_workstream_limit_requests')
    .insert({ builder_id: ctx.user.id, requested_limit: input.requestedLimit, reason })
  if (error) {
    if (error.code === '23505') throw new ProjectValidationError('You already have a request waiting for a decision')
    throw error
  }
}

export interface WorkstreamLimitRequestRow {
  id: string
  builderId: string
  builderEmail: string | null
  currentLimit: number
  requestedLimit: number
  reason: string
  createdAt: string
}

// Platform admin only: every request waiting for a decision.
export async function listPendingWorkstreamLimitRequests(ctx: WorkbenchCallerContext): Promise<WorkstreamLimitRequestRow[]> {
  if (ctx.profile.role !== 'admin') return []
  const admin = createAdminClient()
  const { data: requests, error } = await admin
    .from('builder_workstream_limit_requests')
    .select('id, builder_id, requested_limit, reason, created_at')
    .eq('status', 'pending')
    .order('created_at')
  if (error) throw error
  if (!requests || requests.length === 0) return []
  const builderIds = [...new Set(requests.map((r) => r.builder_id))]
  const [{ data: profiles, error: profileError }, { data: limits, error: limitsError }] = await Promise.all([
    admin.from('profiles').select('id, email').in('id', builderIds),
    admin.from('builder_workstream_limits').select('builder_id, workstream_limit').in('builder_id', builderIds),
  ])
  if (profileError) throw profileError
  if (limitsError) throw limitsError
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))
  const limitById = new Map((limits ?? []).map((l) => [l.builder_id, l.workstream_limit]))
  return requests.map((r) => ({
    id: r.id,
    builderId: r.builder_id,
    builderEmail: emailById.get(r.builder_id) ?? null,
    currentLimit: limitById.get(r.builder_id) ?? DEFAULT_WORKSTREAM_LIMIT,
    requestedLimit: r.requested_limit,
    reason: r.reason,
    createdAt: r.created_at,
  }))
}

// Platform admin only. Approving raises the builder's limit to what they
// asked for.
export async function decideWorkstreamLimitRequest(
  ctx: WorkbenchCallerContext,
  requestId: string,
  approve: boolean,
  note?: string
): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can decide a workstream limit request')
  const { data: request, error } = await ctx.supabase
    .from('builder_workstream_limit_requests')
    .select('id, builder_id, requested_limit, status')
    .eq('id', requestId)
    .maybeSingle()
  if (error) throw error
  if (!request) throw new ProjectValidationError('Request not found')
  if (request.status !== 'pending') throw new ProjectValidationError('This request has already been decided')

  if (approve) {
    const { error: limitError } = await ctx.supabase
      .from('builder_workstream_limits')
      .upsert({ builder_id: request.builder_id, workstream_limit: request.requested_limit, set_by: ctx.user.id }, { onConflict: 'builder_id' })
    if (limitError) throw limitError
  }
  const { error: updateError } = await ctx.supabase
    .from('builder_workstream_limit_requests')
    .update({ status: approve ? 'approved' : 'declined', decided_by: ctx.user.id, decided_at: new Date().toISOString(), decision_note: note?.trim() || null })
    .eq('id', requestId)
    .eq('status', 'pending')
  if (updateError) throw updateError
}
