import 'server-only'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import { requireActiveKnowledgeBase } from '@/lib/knowledge-bases'
import type { WorkstreamKnowledgeBase } from '@/types/database'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Builder Ontology, Part D (docs/kbs-ontology-dev-req-3.md): a Workstream's
// own scoped KB, distinct from its Project's -- e.g. a client-specific
// reference set that shouldn't be visible to every other workstream in the
// same builder-agency Project. Same requireCuratorForWorkstream write-guard
// shape as workstream-relationships.ts/methods.ts's own local copies (this
// codebase's own convention, not a shared helper).

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

// Same visibility_scope defense-in-depth check as attachKnowledgeBase
// (workbench/projects.ts, OR-036) -- a project_private/selected_projects KB
// must never be attachable through this self-serve path either, since
// kb_vectors_select_scoped grants retrieval purely through KB-junction
// membership (project- or, now, workstream-level).
export async function attachWorkstreamKnowledgeBase(
  ctx: WorkbenchCallerContext,
  workstreamId: string,
  knowledgeBaseId: string,
  purpose?: string
): Promise<{ projectId: string }> {
  const projectId = await requireCuratorForWorkstream(ctx, workstreamId, 'attach a knowledge base to this workstream')
  await requireActiveKnowledgeBase(ctx.supabase, knowledgeBaseId)

  const { data: kb, error: kbError } = await ctx.supabase.from('knowledge_bases').select('visibility_scope, status').eq('id', knowledgeBaseId).maybeSingle()
  if (kbError) throw kbError
  if (!kb || (kb.visibility_scope !== 'platform' && kb.visibility_scope !== 'public')) {
    throw new ProjectValidationError('This knowledge base is scoped to a specific project and cannot be attached here')
  }
  // Pending (awaiting admin review) is fine -- see listAttachableKnowledgeBases.
  if (kb.status === 'rejected') throw new ProjectValidationError('An admin rejected this knowledge base, so it cannot be attached')

  const { error } = await ctx.supabase
    .from('workstream_knowledge_bases')
    .insert({ workstream_id: workstreamId, knowledge_base_id: knowledgeBaseId, purpose: purpose || null, attached_by: ctx.user.id })
  if (error) throw error
  return { projectId }
}

export async function detachWorkstreamKnowledgeBase(
  ctx: WorkbenchCallerContext,
  workstreamId: string,
  knowledgeBaseId: string
): Promise<{ projectId: string }> {
  const projectId = await requireCuratorForWorkstream(ctx, workstreamId, 'remove this knowledge base')
  const { error } = await ctx.supabase
    .from('workstream_knowledge_bases')
    .delete()
    .eq('workstream_id', workstreamId)
    .eq('knowledge_base_id', knowledgeBaseId)
  if (error) throw error
  return { projectId }
}

export async function listWorkstreamKnowledgeBases(ctx: WorkbenchCallerContext, workstreamId: string): Promise<WorkstreamKnowledgeBase[]> {
  const { data, error } = await ctx.supabase.from('workstream_knowledge_bases').select('*').eq('workstream_id', workstreamId)
  if (error) throw error
  return data ?? []
}
