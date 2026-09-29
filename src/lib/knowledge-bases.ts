import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, KnowledgeBase, WikiVisibilityScope } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export async function listActiveKnowledgeBases(supabase: SupabaseClient<Database>): Promise<KnowledgeBase[]> {
  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('*')
    .eq('lifecycle_status', 'active')
    // Pending KBs stay selectable -- a curator should be able to keep
    // uploading into one they just created while it awaits admin review.
    // Only rejected ones drop out of the upload picker.
    .neq('status', 'rejected')
    .order('name')
  // Deployment-safe transition: application instances may briefly run
  // before the migration reaches the database. Preserve the previous list
  // during that window rather than failing the Upload/New Project pages.
  if (error && 'code' in error && error.code === '42703') {
    const fallback = await supabase.from('knowledge_bases').select('*').order('name')
    if (fallback.error) throw fallback.error
    return fallback.data ?? []
  }
  if (error) throw error
  return data ?? []
}

// Backs the project page's "attach a knowledge base" picker, Project-Aware
// Knowledge and Assistant Context Stage 1. Unlike listActiveKnowledgeBases
// (used by the wizard's dropdown, which lists every active KB), this
// excludes bases already attached to THIS project -- but since
// project_knowledge_bases is many-to-many, a KB attached to a different
// project is still a valid, intentional reuse pick here.
export async function listAttachableKnowledgeBases(
  supabase: SupabaseClient<Database>,
  projectId: string
): Promise<KnowledgeBase[]> {
  const { data: linked, error: linkedError } = await supabase
    .from('project_knowledge_bases')
    .select('knowledge_base_id')
    .eq('project_id', projectId)
  if (linkedError) throw linkedError
  const attachedIds = (linked ?? []).map((l) => l.knowledge_base_id)

  // A pending KB (curator-created, awaiting admin review) is attachable --
  // admin review is a quality check, not a setup gate: requiring it here
  // meant a brand-new KB silently vanished from this picker until an admin
  // got to it, while the new-project wizard (listActiveKnowledgeBases) already
  // allowed attaching it. The picker labels it "Pending admin review"; only
  // a rejected KB drops out. Retrieval never depended on KB status.
  //
  // OR-036: also excludes a project_private/selected_projects KB entirely --
  // neither this function nor attachKnowledgeBase (src/lib/workbench/
  // projects.ts) previously checked visibility_scope at all, so any
  // project's curator could attach a KB scoped to a *different* project
  // (e.g. "Zadara / Sandz"), and because kb_vectors_select_scoped grants
  // retrieval purely through project_knowledge_bases membership, that
  // attach would hand the attaching project's members real content access
  // to a KB meant to stay scoped elsewhere. A restricted-scope KB now only
  // ever gets attached out-of-band (migration/seed), never through this
  // self-serve picker.
  let query = supabase
    .from('knowledge_bases')
    .select('*')
    .eq('lifecycle_status', 'active')
    .neq('status', 'rejected')
    .in('visibility_scope', ['platform', 'public'])
    .order('name')
  if (attachedIds.length > 0) query = query.not('id', 'in', `(${attachedIds.join(',')})`)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// Builder Ontology, Part D: same picker shape as listAttachableKnowledgeBases
// above, scoped to a Workstream's own workstream_knowledge_bases instead of
// its Project's project_knowledge_bases -- a KB already attached at the
// project level (or to a different workstream) is still a valid,
// intentional pick here, same "many-to-many, already-attached-elsewhere is
// fine" reasoning as the project-level picker.
export async function listAttachableKnowledgeBasesForWorkstream(
  supabase: SupabaseClient<Database>,
  workstreamId: string
): Promise<KnowledgeBase[]> {
  const { data: linked, error: linkedError } = await supabase
    .from('workstream_knowledge_bases')
    .select('knowledge_base_id')
    .eq('workstream_id', workstreamId)
  if (linkedError) throw linkedError
  const attachedIds = (linked ?? []).map((l) => l.knowledge_base_id)

  let query = supabase
    .from('knowledge_bases')
    .select('*')
    .eq('lifecycle_status', 'active')
    .neq('status', 'rejected')
    .in('visibility_scope', ['platform', 'public'])
    .order('name')
  if (attachedIds.length > 0) query = query.not('id', 'in', `(${attachedIds.join(',')})`)
  const { data, error } = await query
  if (error) throw error
  return data ?? []
}

// Public-facing synopsis list for the Wiki page (any signed-in user, not
// just curator/admin) -- per Mike, 2026-08-28: users should be able to see
// what knowledge bases exist and what each is used for, without seeing the
// KB's actual content or curator-facing operational fields (status,
// classification, origin).
//
// OR-036 rewrite: this previously ran through the caller's own RLS-scoped
// client, so kb_select_global_or_member silently dropped every
// project_private/selected_projects KB a non-member viewer couldn't already
// see -- contradicting this function's own stated Aug-28 purpose ("users
// should be able to see what knowledge bases exist"). Now uses the admin
// client for a narrow, explicitly-safe projection (same "admin client + an
// explicit-safe-column-list, never RLS, is the real gate" pattern as
// getOrganizationPortfolio/listDiscoverableProjects) so a restricted KB's
// existence, name, and description are visible to everyone, while WHO owns
// it is only ever disclosed when that's itself already safe: the owning
// Project is named only if it's discoverability='platform' or the viewer is
// already an active member of it -- naming an otherwise members_only
// Project here would be a backdoor around Project discoverability. viewerId
// null (anonymous) gets description + a neutral scope label only, same as
// this page's existing anonymous-friendly behavior.
export interface KnowledgeBaseSynopsisProjectRef {
  id: string
  name: string
  ownerEmail: string | null
}

export interface KnowledgeBaseSynopsis {
  id: string
  name: string
  description: string | null
  visibilityScope: WikiVisibilityScope
  // The viewer's own active-membership Projects that have this KB attached
  // -- always safe to show (it's the viewer's own membership), links
  // straight through to "Project Knowledge" the way listProjectsWithKnowledge
  // already does for KBs a Project owns outright.
  viewerProjectLinks: { id: string; name: string }[]
  // For a non-platform/public KB only: its owning Project(s), named only
  // when safe to disclose per the rule above. Empty (not necessarily zero
  // attachments) means "nothing safely disclosable" -- render the neutral
  // scope label instead.
  disclosableOwningProjects: KnowledgeBaseSynopsisProjectRef[]
}

export async function listKnowledgeBaseSynopses(viewerId: string | null): Promise<KnowledgeBaseSynopsis[]> {
  const admin = createAdminClient()
  const { data: kbs, error } = await admin
    .from('knowledge_bases')
    .select('id, name, description, visibility_scope')
    .eq('lifecycle_status', 'active')
    .eq('status', 'approved')
    .order('name')
  if (error) throw error
  if (!kbs || kbs.length === 0) return []

  const kbIds = kbs.map((kb) => kb.id)
  const { data: links, error: linksError } = await admin.from('project_knowledge_bases').select('project_id, knowledge_base_id').in('knowledge_base_id', kbIds)
  if (linksError) throw linksError

  const projectIds = [...new Set((links ?? []).map((l) => l.project_id))]
  const [{ data: projects, error: projectsError }, { data: viewerMemberships, error: membershipError }] = await Promise.all([
    projectIds.length > 0 ? admin.from('projects').select('id, name, owner_id, discoverability').in('id', projectIds) : Promise.resolve({ data: [], error: null }),
    viewerId && projectIds.length > 0
      ? admin.from('project_members').select('project_id').eq('user_id', viewerId).eq('status', 'active').in('project_id', projectIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (projectsError) throw projectsError
  if (membershipError) throw membershipError

  const ownerIds = [...new Set((projects ?? []).map((p) => p.owner_id).filter((id): id is string => !!id))]
  const { data: owners, error: ownersError } =
    ownerIds.length > 0 ? await admin.from('profiles').select('id, email').in('id', ownerIds) : { data: [], error: null }
  if (ownersError) throw ownersError
  const ownerEmailById = new Map((owners ?? []).map((o) => [o.id, o.email]))

  const projectById = new Map((projects ?? []).map((p) => [p.id, p]))
  const viewerMemberProjectIds = new Set((viewerMemberships ?? []).map((m) => m.project_id))
  const projectIdsByKb = new Map<string, string[]>()
  for (const l of links ?? []) {
    projectIdsByKb.set(l.knowledge_base_id, [...(projectIdsByKb.get(l.knowledge_base_id) ?? []), l.project_id])
  }

  return kbs.map((kb) => {
    const attachedProjectIds = projectIdsByKb.get(kb.id) ?? []
    const viewerProjectLinks = attachedProjectIds
      .filter((id) => viewerMemberProjectIds.has(id))
      .map((id) => projectById.get(id))
      .filter((p): p is NonNullable<typeof p> => !!p)
      .map((p) => ({ id: p.id, name: p.name }))

    const disclosableOwningProjects =
      kb.visibility_scope === 'platform' || kb.visibility_scope === 'public'
        ? []
        : attachedProjectIds
            .map((id) => projectById.get(id))
            .filter((p): p is NonNullable<typeof p> => !!p && (p.discoverability === 'platform' || viewerMemberProjectIds.has(p.id)))
            .map((p) => ({ id: p.id, name: p.name, ownerEmail: p.owner_id ? (ownerEmailById.get(p.owner_id) ?? null) : null }))

    return {
      id: kb.id,
      name: kb.name,
      description: kb.description,
      visibilityScope: kb.visibility_scope,
      viewerProjectLinks,
      disclosableOwningProjects,
    }
  })
}

export async function requireActiveKnowledgeBase(supabase: SupabaseClient<Database>, id: string): Promise<void> {
  const { data, error } = await supabase
    .from('knowledge_bases')
    .select('id')
    .eq('id', id)
    .eq('lifecycle_status', 'active')
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('This knowledge base is retained for reference and cannot be used for new work.')
}
