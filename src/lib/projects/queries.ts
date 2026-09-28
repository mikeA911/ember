import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { createAdminClient } from '@/lib/supabase/admin'

export async function getProjectStats(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.from('projects').select('status')
  if (error) throw error
  const rows = data ?? []
  return { total: rows.length, active: rows.filter((p) => p.status === 'active').length }
}

// "Drafted a public presentation but hasn't published it" -- not just "any
// private project," since most projects are legitimately private forever
// (client work) and that'd make this permanently full of noise. This is
// specifically work sitting one click short of done.
export async function listProjectsWithDraftUpdates(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, public_profile')
    .eq('visibility', 'private')
    .not('public_profile', 'is', null)
    .order('name')
  if (error) throw error
  return data ?? []
}

// For the Wiki article page's project-attach picker (RelatedArticlesManager
// pattern). RLS (projects_select_members / is_project_member) naturally
// scopes this to projects the caller can actually see -- a platform curator
// who isn't a member of a given project won't see it here, which is the
// correct boundary: platform role alone shouldn't let you attach a
// project-private article to a project you don't belong to.
export async function listProjectsForLinking(supabase: SupabaseClient<Database>) {
  const { data, error } = await supabase.from('projects').select('id, name').order('name')
  if (error) throw error
  return data ?? []
}

// Backs the Ember-first home's Project selector (docs/dev-request-role-
// aware-project-views-and-ember-first-workspace.md, View 3) -- deliberately
// narrower than /projects/page.tsx's own member-scoped query (that page
// needs status/visibility/objective for cards; a <select> needs only id and
// name). Two genuinely different call sites, not one over-fit abstraction.
export interface MemberProjectOption {
  id: string
  name: string
}

export async function listMemberProjectOptions(supabase: SupabaseClient<Database>, userId: string): Promise<MemberProjectOption[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (membershipError) throw membershipError

  const projectIds = (memberships ?? []).map((m) => m.project_id)
  if (projectIds.length === 0) return []

  const { data, error } = await supabase.from('projects').select('id, name').in('id', projectIds).order('name')
  if (error) throw error
  return data ?? []
}

export interface DashboardProjectOption {
  id: string
  name: string
  role: string
  status: string
}

// Backs the admin/curator Workbench dashboard's "Your projects" section
// (2026-09-04) -- the Ember-first home (isEmberFirst branch, dashboard/
// page.tsx) already gives consultant/member a project picker plus recent
// conversations so they never have to go searching; admin/curator had no
// equivalent shortcut at all, landing on stat cards with no project list.
// Same "own active memberships only" scope as listMemberProjectOptions --
// this deliberately does not use any admin RLS bypass, so it stays "your
// own projects," not an org-wide list (that's what /projects/portfolio is
// for).
export async function listActiveProjectsForDashboard(supabase: SupabaseClient<Database>, userId: string): Promise<DashboardProjectOption[]> {
  const { data: memberships, error: membershipError } = await supabase
    .from('project_members')
    .select('project_id, role')
    .eq('user_id', userId)
    .eq('status', 'active')
  if (membershipError) throw membershipError
  if ((memberships ?? []).length === 0) return []

  const roleByProjectId = new Map((memberships ?? []).map((m) => [m.project_id, m.role]))
  const { data: projects, error } = await supabase
    .from('projects')
    .select('id, name, status')
    .in('id', [...roleByProjectId.keys()])
    .order('name')
  if (error) throw error

  return (projects ?? []).map((p) => ({ id: p.id, name: p.name, status: p.status, role: roleByProjectId.get(p.id) ?? 'viewer' }))
}

export interface LinkedKnowledgeBase {
  id: string
  name: string
}

// Backs the project page's Knowledge section list. Joins through
// project_knowledge_bases (many-to-many) rather than the legacy
// knowledge_bases.project_id column, since a KB may now serve more than one
// authorized project.
export async function listKnowledgeBasesForProject(
  supabase: SupabaseClient<Database>,
  projectId: string
): Promise<LinkedKnowledgeBase[]> {
  const { data: links, error: linkError } = await supabase
    .from('project_knowledge_bases')
    .select('knowledge_base_id')
    .eq('project_id', projectId)
  if (linkError) throw linkError
  const kbIds = (links ?? []).map((l) => l.knowledge_base_id)
  if (kbIds.length === 0) return []

  const { data: kbs, error: kbError } = await supabase.from('knowledge_bases').select('id, name').in('id', kbIds)
  if (kbError) throw kbError
  return kbs ?? []
}

// Builder Ontology, Part D: same shape as listKnowledgeBasesForProject
// above, joined through workstream_knowledge_bases instead -- a Workstream's
// own scoped KB, distinct from its Project's.
export async function listKnowledgeBasesForWorkstream(
  supabase: SupabaseClient<Database>,
  workstreamId: string
): Promise<LinkedKnowledgeBase[]> {
  const { data: links, error: linkError } = await supabase
    .from('workstream_knowledge_bases')
    .select('knowledge_base_id')
    .eq('workstream_id', workstreamId)
  if (linkError) throw linkError
  const kbIds = (links ?? []).map((l) => l.knowledge_base_id)
  if (kbIds.length === 0) return []

  const { data: kbs, error: kbError } = await supabase.from('knowledge_bases').select('id, name').in('id', kbIds)
  if (kbError) throw kbError
  return kbs ?? []
}

export interface ProjectKnowledgeSource {
  id: string
  knowledgeBaseId: string
  title: string
  publisher: string | null
  sourceUrl: string | null
  versionNumber: number | null
  lifecycleStatus: string
  // The source's current version -- what /review/[docId] reviews.
  documentId: string | null
}

// Backs the project page's Knowledge section source list -- members asked to
// see source metadata (title, publisher, version, URL) directly on the
// project rather than only through Ember's answers or one-at-a-time via
// /sources/[id]. Uses the caller's own RLS-scoped client throughout, same as
// listKnowledgeBasesForProject above: knowledge_sources_select_staff_or_
// owner_or_project_member (and has_evidence_access layered on top of it)
// already scopes this correctly per-source -- a source an evidence-access
// grant has restricted away from this caller just won't come back here,
// with zero extra gating needed in this function.
export async function listSourcesForKnowledgeBases(supabase: SupabaseClient<Database>, kbIds: string[]): Promise<ProjectKnowledgeSource[]> {
  if (kbIds.length === 0) return []

  const { data: sources, error: sourceError } = await supabase
    .from('knowledge_sources')
    .select('id, knowledge_base_id, title, publisher, source_url, current_version_id, lifecycle_status')
    .in('knowledge_base_id', kbIds)
    .order('title')
  if (sourceError) throw sourceError

  const versionIds = (sources ?? []).map((s) => s.current_version_id).filter((v): v is string => !!v)
  const { data: versions, error: versionError } =
    versionIds.length > 0 ? await supabase.from('documents').select('id, version_number').in('id', versionIds) : { data: [], error: null }
  if (versionError) throw versionError
  const versionNumberById = new Map((versions ?? []).map((v) => [v.id, v.version_number]))

  return (sources ?? []).map((s) => ({
    id: s.id,
    knowledgeBaseId: s.knowledge_base_id,
    title: s.title,
    publisher: s.publisher,
    sourceUrl: s.source_url,
    versionNumber: s.current_version_id ? (versionNumberById.get(s.current_version_id) ?? null) : null,
    lifecycleStatus: s.lifecycle_status,
    documentId: s.current_version_id,
  }))
}

export interface SourceReviewCounts {
  total: number
  approved: number
}

// How much of each document is actually searchable: retrieval only uses
// approved chunks (approveChunk embeds on approval), so a listed source can
// sit un-searchable until a curator reviews it -- the project page shows
// this next to each source. document_chunks RLS (chunks_select_staff) only
// lets platform curators/admins read chunks, while any project member sees
// the source list, so this counts through the admin client and returns only
// per-document counts, never chunk content.
export async function getSourceReviewCounts(documentIds: string[]): Promise<Map<string, SourceReviewCounts>> {
  const counts = new Map<string, SourceReviewCounts>(documentIds.map((id) => [id, { total: 0, approved: 0 }]))
  if (documentIds.length === 0) return counts
  const { data, error } = await createAdminClient().from('document_chunks').select('document_id, review_status').in('document_id', documentIds)
  if (error) throw error
  for (const chunk of data ?? []) {
    const entry = counts.get(chunk.document_id)
    if (!entry) continue
    entry.total++
    if (chunk.review_status === 'approved') entry.approved++
  }
  return counts
}

export interface ProjectKnowledgeSummary {
  id: string
  name: string
  documentCount: number
  wikiArticleCount: number
}

// Projects with their own attached knowledge base(s), joined through
// project_knowledge_bases (many-to-many) -- as opposed to the platform-global
// AI Engineering Wiki, which every project can read but none of them own.
// Documents join via doc_type (a KB id); Wiki articles via knowledge_base_id.
export async function listProjectsWithKnowledge(supabase: SupabaseClient<Database>): Promise<ProjectKnowledgeSummary[]> {
  const { data: links, error: linkError } = await supabase.from('project_knowledge_bases').select('project_id, knowledge_base_id')
  if (linkError) throw linkError
  if (!links || links.length === 0) return []

  const kbIdsByProject = new Map<string, string[]>()
  for (const link of links) {
    kbIdsByProject.set(link.project_id, [...(kbIdsByProject.get(link.project_id) ?? []), link.knowledge_base_id])
  }
  const projectIds = [...kbIdsByProject.keys()]
  const allKbIds = [...new Set(links.map((l) => l.knowledge_base_id))]

  const [{ data: projects, error: projError }, { data: documents, error: docError }, { data: articles, error: articleError }] =
    await Promise.all([
      supabase.from('projects').select('id, name').in('id', projectIds),
      supabase.from('documents').select('doc_type').in('doc_type', allKbIds),
      supabase.from('wiki_articles').select('knowledge_base_id').in('knowledge_base_id', allKbIds),
    ])
  if (projError) throw projError
  if (docError) throw docError
  if (articleError) throw articleError

  return (projects ?? []).map((p) => {
    const kbIds = kbIdsByProject.get(p.id) ?? []
    return {
      id: p.id,
      name: p.name,
      documentCount: (documents ?? []).filter((d) => kbIds.includes(d.doc_type)).length,
      wikiArticleCount: (articles ?? []).filter((a) => kbIds.includes(a.knowledge_base_id ?? '')).length,
    }
  })
}
