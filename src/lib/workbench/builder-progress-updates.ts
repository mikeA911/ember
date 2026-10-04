import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'
import type { BuilderProgressConfidence } from '@/types/database'
import { getBuilderSpendSummary, type BuilderSpendSummary } from '@/lib/ai'

// Builder Operations and Progress Updates (docs/dev-request-builder-
// operations-and-progress-updates.md): a consent-based exception to
// Builder isolation. Never reads a private Working Knowledge notebook or
// Ember conversation -- only what a Builder explicitly shares via
// shareBuilderUpdate. Deliberately not generalized to Enterprise team
// Projects the way Workstream Promotion was -- see that migration's own
// comment for why this dashboard is a Builder-specific concern.

export interface ShareBuilderUpdateInput {
  currentStage: string
  opportunityLabel?: string | null
  progress: string
  nextStep: string
  helpRequested?: string | null
  confidence: BuilderProgressConfidence
}

async function requireWorkstreamProjectOwner(ctx: WorkbenchCallerContext, workstreamId: string): Promise<string> {
  const { data: workstream, error } = await ctx.supabase.from('project_workstreams').select('project_id').eq('id', workstreamId).single()
  if (error || !workstream) throw error ?? new ProjectValidationError('Workstream not found')
  const role = await getActiveProjectRole(ctx, workstream.project_id)
  if (role !== 'owner' && ctx.profile.role !== 'admin') {
    throw new AuthError('Only this workstream\'s own Project owner can share a progress update')
  }
  return workstream.project_id
}

// Upsert on workstream_id -- "a Builder may replace... their update until
// it becomes milestone evidence." Always leaves status 'active'; a
// previously withdrawn update is revived by sharing again.
export async function shareBuilderUpdate(ctx: WorkbenchCallerContext, workstreamId: string, input: ShareBuilderUpdateInput): Promise<void> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to share a progress update')
  await requireWorkstreamProjectOwner(ctx, workstreamId)

  const { data: existing, error: existingError } = await ctx.supabase
    .from('builder_progress_updates')
    .select('id')
    .eq('workstream_id', workstreamId)
    .maybeSingle()
  if (existingError) throw existingError

  const row = {
    current_stage: input.currentStage.trim(),
    opportunity_label: input.opportunityLabel?.trim() || null,
    progress: input.progress.trim(),
    next_step: input.nextStep.trim(),
    help_requested: input.helpRequested?.trim() || null,
    confidence: input.confidence,
    status: 'active' as const,
  }
  if (!row.current_stage) throw new ProjectValidationError('Current stage is required')
  if (!row.progress) throw new ProjectValidationError('Progress is required')
  if (!row.next_step) throw new ProjectValidationError('Next step is required')

  if (existing) {
    const { error } = await ctx.supabase.from('builder_progress_updates').update(row).eq('id', existing.id)
    if (error) throw error
  } else {
    const { error } = await ctx.supabase.from('builder_progress_updates').insert({ workstream_id: workstreamId, submitted_by: ctx.user.id, ...row })
    if (error) throw error
  }
}

export async function withdrawBuilderUpdate(ctx: WorkbenchCallerContext, workstreamId: string): Promise<void> {
  await requireWorkstreamProjectOwner(ctx, workstreamId)

  const { data: updated, error } = await ctx.supabase
    .from('builder_progress_updates')
    .update({ status: 'withdrawn' })
    .eq('workstream_id', workstreamId)
    .select('id')
  if (error) throw error
  if (!updated || updated.length === 0) throw new ProjectValidationError('No active update to withdraw')
}

export interface BuilderOperationsRow {
  builderId: string
  builderEmail: string | null
  isActive: boolean
  lastActivityAt: string | null
  activeWorkstreamCount: number
  latestUpdate: {
    workstreamName: string
    currentStage: string
    opportunityLabel: string | null
    progress: string
    nextStep: string
    helpRequested: string | null
    confidence: BuilderProgressConfidence
    updatedAt: string
  } | null
  spend: BuilderSpendSummary
}

// curator/admin only. Scoped to Projects tagged portfolio_category =
// 'builder_lab' (the tag on every Project a builder owns -- their
// provisioned workspace and each client Project, src/lib/workbench/
// projects.ts), one row per builder -- a precise signal. Admin client throughout: a platform curator/admin
// reviewing this is deliberately NOT expected to be a member of any
// individual Builder's private Project -- same "safe metadata query"
// posture as listPendingWorkstreamPromotions. `spend` (allowance/credits/
// spent/remaining) now comes from src/lib/ai/metering.ts's own
// getBuilderSpendSummary -- this is the field that used to be omitted here
// pending that infrastructure; milestone-evidence-status remains omitted
// (no milestone infrastructure exists yet).
export async function listBuilderOperationsRows(ctx: WorkbenchCallerContext): Promise<BuilderOperationsRow[]> {
  if (ctx.profile.role !== 'curator' && ctx.profile.role !== 'admin') {
    throw new AuthError('Requires curator or admin role to view Builder Operations')
  }

  const admin = createAdminClient()
  const { data: builderProjects } = await admin.from('projects').select('id, owner_id').eq('portfolio_category', 'builder_lab')
  if (!builderProjects || builderProjects.length === 0) return []

  const projectIds = builderProjects.map((p) => p.id)
  const builderIds = [...new Set(builderProjects.map((p) => p.owner_id).filter((id): id is string => !!id))]

  const { data: profiles } = builderIds.length > 0 ? await admin.from('profiles').select('id, email, is_active').in('id', builderIds) : { data: [] }
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  const { data: workstreams } = await admin.from('project_workstreams').select('id, project_id, name, status, updated_at').in('project_id', projectIds)
  const workstreamsByProject = new Map<string, NonNullable<typeof workstreams>>()
  for (const w of workstreams ?? []) {
    const list = workstreamsByProject.get(w.project_id) ?? []
    list.push(w)
    workstreamsByProject.set(w.project_id, list)
  }

  const allWorkstreamIds = (workstreams ?? []).map((w) => w.id)
  const { data: updates } =
    allWorkstreamIds.length > 0
      ? await admin.from('builder_progress_updates').select('*').in('workstream_id', allWorkstreamIds).eq('status', 'active')
      : { data: [] }
  const updateByWorkstreamId = new Map((updates ?? []).map((u) => [u.workstream_id, u]))

  // A builder owns one builder_lab Project per client (plus their
  // workspace), so roll every Project they own up into one row.
  const projectIdsByBuilder = new Map<string, string[]>()
  for (const p of builderProjects) {
    if (!p.owner_id) continue
    const list = projectIdsByBuilder.get(p.owner_id) ?? []
    list.push(p.id)
    projectIdsByBuilder.set(p.owner_id, list)
  }

  return Promise.all(
    [...projectIdsByBuilder].map(async ([builderId, ownedProjectIds]) => {
      const builderWorkstreams = ownedProjectIds.flatMap((id) => workstreamsByProject.get(id) ?? [])
      const activeWorkstreamCount = builderWorkstreams.filter((w) => w.status === 'active').length
      const lastActivityAt = builderWorkstreams.reduce<string | null>(
        (latest, w) => (!latest || w.updated_at > latest ? w.updated_at : latest),
        null
      )

      let latestUpdate: BuilderOperationsRow['latestUpdate'] = null
      for (const w of builderWorkstreams) {
        const u = updateByWorkstreamId.get(w.id)
        if (u && (!latestUpdate || u.updated_at > latestUpdate.updatedAt)) {
          latestUpdate = {
            workstreamName: w.name,
            currentStage: u.current_stage,
            opportunityLabel: u.opportunity_label,
            progress: u.progress,
            nextStep: u.next_step,
            helpRequested: u.help_requested,
            confidence: u.confidence,
            updatedAt: u.updated_at,
          }
        }
      }

      const profile = profileById.get(builderId)
      const spend = await getBuilderSpendSummary(admin, builderId)
      return {
        builderId,
        builderEmail: profile?.email ?? null,
        isActive: profile?.is_active ?? false,
        lastActivityAt,
        activeWorkstreamCount,
        latestUpdate,
        spend,
      }
    })
  )
}
