import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from './errors'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type {
  Database,
  WorkingKnowledgeItem,
  WorkingKnowledgeItemType,
  WorkingKnowledgeSource,
  WorkingKnowledgeVisibility,
  TableUpdate,
  UserRole,
} from '@/types/database'

// Working Knowledge & Research Notebooks, Stage 1+2
// (docs/dev-request-project-scoped-working-knowledge-and-research-notebooks.md).
// Mirrors src/lib/projects/notes.ts's exact shape: create* takes a plain
// supabase client + explicit caller identity so it's reusable by both a
// human Server Action and Ember's save_working_knowledge tool (one
// validation/insert path, not two independently-maintained copies); list/
// read/mutate helpers take the full WorkbenchCallerContext since those are
// only ever called from an already-authenticated caller.

export interface CreateWorkingKnowledgeItemInput {
  projectId: string
  type: WorkingKnowledgeItemType
  title: string
  objective?: string | null
  content: string
  sourceConversationId?: string | null
  synthesisProvider?: string | null
  synthesisModel?: string | null
  sources?: {
    url: string
    domain?: string | null
    title?: string | null
    publishedDate?: string | null
    excerpt?: string | null
    contentFingerprint?: string | null
  }[]
}

export async function createWorkingKnowledgeItem(
  supabase: SupabaseClient<Database>,
  owner: { id: string; role: UserRole },
  input: CreateWorkingKnowledgeItemInput
): Promise<{ itemId: string }> {
  if (owner.role === 'anonymous') throw new AuthError('Create an account to save Working Knowledge')
  if (!input.title.trim()) throw new ProjectValidationError('Title is required')
  if (!input.content.trim()) throw new ProjectValidationError('Content is required')

  const { data, error } = await supabase
    .from('working_knowledge_items')
    .insert({
      project_id: input.projectId,
      owner_id: owner.id,
      type: input.type,
      title: input.title.trim(),
      objective: input.objective?.trim() || null,
      content: input.content.trim(),
      source_conversation_id: input.sourceConversationId || null,
      synthesis_provider: input.synthesisProvider || null,
      synthesis_model: input.synthesisModel || null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new ProjectValidationError('Failed to save Working Knowledge')

  if (input.sources?.length) {
    const { error: sourcesError } = await supabase.from('working_knowledge_sources').insert(
      input.sources.map((s) => ({
        item_id: data.id,
        url: s.url,
        domain: s.domain || null,
        title: s.title || null,
        published_date: s.publishedDate || null,
        excerpt: s.excerpt || null,
        content_fingerprint: s.contentFingerprint || null,
      }))
    )
    // Best-effort -- the notebook itself already saved successfully; losing
    // its source rows is a lesser failure than losing the whole save, same
    // "never let bookkeeping block the real action" posture used elsewhere
    // in this codebase (e.g. mcp-gateway/execute.ts's syncToolMessageForInvocation).
    if (sourcesError) console.error('createWorkingKnowledgeItem: failed to save sources', sourcesError)
  }

  return { itemId: data.id }
}

export async function updateWorkingKnowledgeItem(
  ctx: WorkbenchCallerContext,
  itemId: string,
  updates: { title?: string; objective?: string | null; content?: string }
): Promise<void> {
  const patch: TableUpdate<'working_knowledge_items'> = {}
  if (updates.title !== undefined) {
    if (!updates.title.trim()) throw new ProjectValidationError('Title is required')
    patch.title = updates.title.trim()
  }
  if (updates.objective !== undefined) patch.objective = updates.objective?.trim() || null
  if (updates.content !== undefined) {
    if (!updates.content.trim()) throw new ProjectValidationError('Content is required')
    patch.content = updates.content.trim()
  }
  if (Object.keys(patch).length === 0) return

  const { data, error } = await ctx.supabase.from('working_knowledge_items').update(patch).eq('id', itemId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to edit this Working Knowledge item')
}

export async function archiveWorkingKnowledgeItem(ctx: WorkbenchCallerContext, itemId: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from('working_knowledge_items')
    .update({ trust_status: 'archived', archived_at: new Date().toISOString() })
    .eq('id', itemId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to archive this Working Knowledge item')
}

export async function setWorkingKnowledgeVisibility(
  ctx: WorkbenchCallerContext,
  itemId: string,
  visibility: WorkingKnowledgeVisibility
): Promise<void> {
  const { data, error } = await ctx.supabase.from('working_knowledge_items').update({ visibility }).eq('id', itemId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to change this item\'s visibility')
}

// RLS (working_knowledge_items_select_own) already restricts this to the
// caller's own rows regardless of the explicit owner_id filter below -- kept
// explicit anyway since "my Working Knowledge" is this function's entire
// purpose, not an incidental side effect of what RLS happens to allow.
export async function listMyWorkingKnowledge(
  ctx: WorkbenchCallerContext,
  projectId: string,
  options: { includeArchived?: boolean } = {}
): Promise<WorkingKnowledgeItem[]> {
  let query = ctx.supabase
    .from('working_knowledge_items')
    .select('*')
    .eq('project_id', projectId)
    .eq('owner_id', ctx.user.id)
    .order('updated_at', { ascending: false })
  if (!options.includeArchived) query = query.neq('trust_status', 'archived')
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// Items visible to the caller via RLS (a named share or shared_project) that
// they don't themselves own -- "shared with me," never "everything in this
// Project" (there is no such view; see the dev request's explicit non-goal
// "no administrator content-surveillance dashboard").
export async function listSharedWorkingKnowledge(ctx: WorkbenchCallerContext, projectId: string): Promise<WorkingKnowledgeItem[]> {
  const { data, error } = await ctx.supabase
    .from('working_knowledge_items')
    .select('*')
    .eq('project_id', projectId)
    .neq('owner_id', ctx.user.id)
    .neq('trust_status', 'archived')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listWorkingKnowledgeSources(ctx: WorkbenchCallerContext, itemId: string): Promise<WorkingKnowledgeSource[]> {
  const { data, error } = await ctx.supabase
    .from('working_knowledge_sources')
    .select('*')
    .eq('item_id', itemId)
    .order('retrieved_at', { ascending: false })
  if (error) throw error
  return data ?? []
}

// Validates the recipient is a *currently active* member of the item's own
// Project before sharing -- getActiveProjectRole (workbench/context.ts) is
// hardcoded to the caller's own id, so this is its own small direct query
// rather than a reused helper. RLS (working_knowledge_shares_manage_owner)
// re-enforces the same membership check server-side regardless.
export async function shareWorkingKnowledgeItem(ctx: WorkbenchCallerContext, itemId: string, recipientUserId: string): Promise<void> {
  const { data: item, error: itemError } = await ctx.supabase.from('working_knowledge_items').select('project_id').eq('id', itemId).single()
  if (itemError || !item) throw itemError ?? new ProjectValidationError('Working Knowledge item not found')

  const { data: membership } = await ctx.supabase
    .from('project_members')
    .select('role')
    .eq('project_id', item.project_id)
    .eq('user_id', recipientUserId)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) throw new ProjectValidationError('You can only share with an active member of this project')

  const { error } = await ctx.supabase
    .from('working_knowledge_shares')
    .insert({ item_id: itemId, recipient_user_id: recipientUserId, granted_by: ctx.user.id })
  if (error) throw error
}

export async function revokeWorkingKnowledgeShare(ctx: WorkbenchCallerContext, shareId: string, reason?: string): Promise<void> {
  const { data, error } = await ctx.supabase
    .from('working_knowledge_shares')
    .update({ status: 'revoked', revoked_by: ctx.user.id, revoked_at: new Date().toISOString(), revocation_reason: reason || null })
    .eq('id', shareId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to revoke this share')
}

export interface WorkingKnowledgeShareWithRecipient {
  id: string
  recipientUserId: string
  recipientEmail: string | null
  status: 'active' | 'revoked'
  grantedAt: string
}

export async function listWorkingKnowledgeShares(ctx: WorkbenchCallerContext, itemId: string): Promise<WorkingKnowledgeShareWithRecipient[]> {
  const { data: shares, error } = await ctx.supabase
    .from('working_knowledge_shares')
    .select('id, recipient_user_id, status, granted_at')
    .eq('item_id', itemId)
    .eq('status', 'active')
    .order('granted_at', { ascending: false })
  if (error) throw error
  if (!shares || shares.length === 0) return []

  // Recipient emails are for display only -- the shares themselves (fetched
  // above, RLS-checked) are the real authorization boundary. profiles RLS
  // only lets a caller see their own row or staff see everyone, so a
  // consultant/member-role owner can't read a recipient's email through the
  // normal client; the admin client here only ever returns id+email, same
  // narrow pattern as resolveUserIdsByEmail (projects.ts) and the working-
  // knowledge detail page's own share-candidate lookup.
  const recipientIds = [...new Set(shares.map((s) => s.recipient_user_id))]
  const admin = createAdminClient()
  const { data: profiles } = await admin.from('profiles').select('id, email').in('id', recipientIds)
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))

  return shares.map((s) => ({
    id: s.id,
    recipientUserId: s.recipient_user_id,
    recipientEmail: emailById.get(s.recipient_user_id) ?? null,
    status: s.status,
    grantedAt: s.granted_at,
  }))
}

export async function getWorkingKnowledgeItem(ctx: WorkbenchCallerContext, itemId: string): Promise<WorkingKnowledgeItem | null> {
  const { data, error } = await ctx.supabase.from('working_knowledge_items').select('*').eq('id', itemId).maybeSingle()
  if (error) throw error
  return data ?? null
}
