import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { WorkbenchCallerContext } from './context'
import { getFeeSplit } from './client-billing'

// A client Project Ember found (client_source 'ember') is built by a
// builder the platform admin picks (20261029100001). They become its
// builder of record and a curator, the Project follows the builder rules
// (builder_lab: they request its promotions, the agency decides), and its
// fee is re-split at their share for Ember-found clients.
export async function assignProjectBuilder(ctx: WorkbenchCallerContext, projectId: string, builderId: string): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can assign a builder to a project')
  const admin = createAdminClient()

  const { data: project, error: projectError } = await admin.from('projects').select('id, client_source').eq('id', projectId).maybeSingle()
  if (projectError) throw projectError
  if (!project) throw new ProjectValidationError('Project not found')
  if (project.client_source !== 'ember') throw new ProjectValidationError('Only a project whose client Ember found can be assigned a builder')

  const { data: builder, error: builderError } = await admin.from('profiles').select('id, role, is_active').eq('id', builderId).maybeSingle()
  if (builderError) throw builderError
  if (!builder || builder.role !== 'consultant' || !builder.is_active) throw new ProjectValidationError('Pick an active builder')

  const { error: updateError } = await admin.from('projects').update({ builder_id: builderId, portfolio_category: 'builder_lab' }).eq('id', projectId)
  if (updateError) throw updateError

  const { error: memberError } = await admin
    .from('project_members')
    .upsert({ project_id: projectId, user_id: builderId, role: 'curator', status: 'active' }, { onConflict: 'project_id,user_id' })
  if (memberError) throw memberError

  const { data: fee, error: feeError } = await admin.from('client_project_fees').select('project_id').eq('project_id', projectId).maybeSingle()
  if (feeError) throw feeError
  if (fee) {
    const split = await getFeeSplit(admin, builderId, 'ember')
    const { error } = await admin
      .from('client_project_fees')
      .update({ platform_rate_pct: split.platformRatePct, builder_share_pct: split.builderSharePct, set_by: ctx.user.id })
      .eq('project_id', projectId)
    if (error) throw error
  }
}
