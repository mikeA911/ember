import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { WorkbenchCallerContext } from './context'
import { workspaceIdsOf } from './workstream-limits'

// Knowledge bases the platform admin assigns to a builder
// (20261030100001_builder_assigned_knowledge_bases.sql). The assignment is
// recorded in profiles.assigned_kbs and carried out by attaching each one
// to the builder's workspace, marked 'assigned_by_platform' -- so the
// existing project-membership rules let the builder, and Ember in their
// workspace, see its sources and articles. Only attachments this made are
// ever removed here; anything the builder attached themselves is left alone.
export const ASSIGNED_PURPOSE = 'assigned_by_platform'

export async function setBuilderKnowledgeBases(ctx: WorkbenchCallerContext, builderId: string, knowledgeBaseIds: string[]): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can assign knowledge bases to a builder')
  const kbIds = [...new Set(knowledgeBaseIds)]
  const admin = createAdminClient()

  const { data: builder, error: builderError } = await admin.from('profiles').select('id, role').eq('id', builderId).maybeSingle()
  if (builderError) throw builderError
  if (!builder || builder.role !== 'consultant') throw new ProjectValidationError('Knowledge bases can only be assigned to a builder')

  if (kbIds.length > 0) {
    const { data: kbs, error: kbError } = await admin.from('knowledge_bases').select('id').in('id', kbIds).eq('lifecycle_status', 'active')
    if (kbError) throw kbError
    const found = new Set((kbs ?? []).map((kb) => kb.id))
    const missing = kbIds.filter((id) => !found.has(id))
    if (missing.length > 0) throw new ProjectValidationError(`Not an active knowledge base: ${missing.join(', ')}`)
  }

  const { error: profileError } = await admin.from('profiles').update({ assigned_kbs: kbIds }).eq('id', builderId)
  if (profileError) throw profileError

  for (const projectId of await workspaceIdsOf(admin, builderId)) {
    const { data: links, error: linkError } = await admin
      .from('project_knowledge_bases')
      .select('id, knowledge_base_id, purpose')
      .eq('project_id', projectId)
    if (linkError) throw linkError

    const staleIds = (links ?? []).filter((l) => l.purpose === ASSIGNED_PURPOSE && !kbIds.includes(l.knowledge_base_id)).map((l) => l.id)
    if (staleIds.length > 0) {
      const { error } = await admin.from('project_knowledge_bases').delete().in('id', staleIds)
      if (error) throw error
    }

    const linked = new Set((links ?? []).map((l) => l.knowledge_base_id))
    const toAttach = kbIds.filter((id) => !linked.has(id))
    if (toAttach.length > 0) {
      const { error } = await admin
        .from('project_knowledge_bases')
        .insert(toAttach.map((knowledge_base_id) => ({ project_id: projectId, knowledge_base_id, purpose: ASSIGNED_PURPOSE, attached_by: ctx.user.id })))
      if (error) throw error
    }
  }
}
