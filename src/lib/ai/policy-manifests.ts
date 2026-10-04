import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { InformationSensitivity } from '@/types/database'
import { SENSITIVITY_RANK, mergeManifests, type ContextManifest } from './sensitivity'

// Builders for the ContextManifest each single-shot AI call site sends
// through withPolicyGate/gateProvider (docs/design-notes/ai-policy-
// enforcement-service-and-context-manifest.md §3.2). They read only ids and
// classification tiers -- never content -- with the service-role client, for
// the same reason readResourceTiers does: the tier decides which PROVIDER
// may see content, so it must not depend on who is asking.

function highest(tiers: (InformationSensitivity | null | undefined)[]): InformationSensitivity | undefined {
  let top: InformationSensitivity | undefined
  for (const t of tiers) {
    if (t && (!top || SENSITIVITY_RANK[t] > SENSITIVITY_RANK[top])) top = t
  }
  return top
}

// Every Project that uses one of these knowledge bases: attached to the
// Project, attached to one of its Workstreams, or owned by it
// (knowledge_bases.project_id). Shared with src/lib/ai/hosting-policy.ts.
export async function projectIdsUsingKnowledgeBases(knowledgeBaseIds: string[]): Promise<string[]> {
  if (knowledgeBaseIds.length === 0) return []
  const admin = createAdminClient()
  const [projectLinks, workstreamLinks, owned] = await Promise.all([
    admin.from('project_knowledge_bases').select('project_id').in('knowledge_base_id', knowledgeBaseIds),
    admin.from('workstream_knowledge_bases').select('workstream_id').in('knowledge_base_id', knowledgeBaseIds),
    admin.from('knowledge_bases').select('project_id').in('id', knowledgeBaseIds),
  ])
  if (projectLinks.error) throw projectLinks.error
  if (workstreamLinks.error) throw workstreamLinks.error
  if (owned.error) throw owned.error

  const projectIds = new Set<string>()
  for (const row of projectLinks.data ?? []) projectIds.add(row.project_id)
  const workstreamIds = [...new Set((workstreamLinks.data ?? []).map((r) => r.workstream_id))]
  if (workstreamIds.length > 0) {
    const { data: workstreams, error } = await admin.from('project_workstreams').select('project_id').in('id', workstreamIds)
    if (error) throw error
    for (const ws of workstreams ?? []) projectIds.add(ws.project_id)
  }
  for (const row of owned.data ?? []) if (row.project_id) projectIds.add(row.project_id)
  return [...projectIds]
}

// The knowledge base ids (documents.doc_type) behind these documents.
export async function knowledgeBaseIdsForDocuments(documentIds: string[]): Promise<string[]> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return []
  const { data, error } = await createAdminClient().from('documents').select('doc_type').in('id', ids)
  if (error) throw error
  return [...new Set((data ?? []).map((r) => r.doc_type).filter((id): id is string => !!id))]
}

// The highest classification of any Project that uses one of these
// knowledge bases. Unclassified Projects contribute nothing -- an
// unclassified source already defaults to 'internal' on its own. Undefined
// when no using Project is classified.
export async function inheritedProjectSensitivityForKnowledgeBases(knowledgeBaseIds: string[]): Promise<InformationSensitivity | undefined> {
  const projectIds = await projectIdsUsingKnowledgeBases(knowledgeBaseIds)
  if (projectIds.length === 0) return undefined
  const { data: projects, error } = await createAdminClient().from('projects').select('information_sensitivity').in('id', projectIds)
  if (error) throw error
  return highest((projects ?? []).map((p) => p.information_sensitivity as InformationSensitivity | null))
}

// Source documents: each document's knowledge source, plus the inherited
// floor from the Projects that use its knowledge base (documents.doc_type is
// the knowledge base id). Used for chunk enrichment and chunk embedding.
export async function manifestForDocuments(documentIds: string[]): Promise<ContextManifest> {
  const ids = [...new Set(documentIds)]
  if (ids.length === 0) return { entries: [] }
  const { data, error } = await createAdminClient().from('documents').select('knowledge_source_id, doc_type').in('id', ids)
  if (error) throw error
  const rows = data ?? []
  const sourceIds = [...new Set(rows.map((r) => r.knowledge_source_id).filter((id): id is string => !!id))]
  const kbIds = [...new Set(rows.map((r) => r.doc_type).filter((id): id is string => !!id))]
  const minimumSensitivity = await inheritedProjectSensitivityForKnowledgeBases(kbIds)
  return {
    entries: sourceIds.map((resourceId) => ({ resourceType: 'knowledge_source' as const, resourceId })),
    ...(minimumSensitivity ? { minimumSensitivity } : {}),
  }
}

// Text written in a Project's context (a search question, a generated
// presentation): the Project's own classification. null = the Project
// exists but is unclassified, which getEffectiveSensitivity reads as
// 'internal', same as loop.ts's project-bound turns.
export async function manifestForProject(projectId: string): Promise<ContextManifest> {
  const { data, error } = await createAdminClient().from('projects').select('information_sensitivity').eq('id', projectId).maybeSingle()
  if (error) throw error
  return { entries: [], projectSensitivity: (data?.information_sensitivity as InformationSensitivity | null | undefined) ?? null }
}

// A Workstream's content: its Project plus every artifact on it (each
// artifact can carry its own, stricter classification).
export async function manifestForWorkstream(workstreamId: string): Promise<ContextManifest> {
  const admin = createAdminClient()
  const { data: workstream, error } = await admin.from('project_workstreams').select('project_id').eq('id', workstreamId).single()
  if (error || !workstream) throw error ?? new Error('Workstream not found')
  const { data: artifacts, error: artifactsError } = await admin.from('workstream_artifacts').select('id').eq('workstream_id', workstreamId)
  if (artifactsError) throw artifactsError
  return mergeManifests(await manifestForProject(workstream.project_id), {
    entries: (artifacts ?? []).map((a) => ({ resourceType: 'workstream_artifact' as const, resourceId: a.id })),
  })
}

// One artifact on its own (e.g. a Wiki draft synthesized from it): the
// artifact's classification plus its Project's.
export async function manifestForArtifact(artifactId: string): Promise<ContextManifest> {
  const admin = createAdminClient()
  const { data, error } = await admin.from('workstream_artifacts').select('workstream_id').eq('id', artifactId).single()
  if (error || !data) throw error ?? new Error('Artifact not found')
  const { data: ws, error: wsError } = await admin.from('project_workstreams').select('project_id').eq('id', data.workstream_id).maybeSingle()
  if (wsError) throw wsError
  const artifact: ContextManifest = { entries: [{ resourceType: 'workstream_artifact', resourceId: artifactId }] }
  return ws ? mergeManifests(await manifestForProject(ws.project_id), artifact) : artifact
}

// An approved Wiki version being embedded: the article's own classification
// plus everything it was written from (linked documents/chunks and
// artifacts), since the article text can restate any of it.
export async function manifestForWikiVersion(versionId: string): Promise<ContextManifest> {
  const admin = createAdminClient()
  const { data: version, error } = await admin.from('wiki_versions').select('wiki_article_id').eq('id', versionId).single()
  if (error || !version) throw error ?? new Error('Wiki version not found')
  const { data: article, error: articleError } = await admin.from('wiki_articles').select('slug').eq('id', version.wiki_article_id).maybeSingle()
  if (articleError) throw articleError

  const { data: sources, error: sourcesError } = await admin
    .from('wiki_sources')
    .select('document_id, chunk_id, workstream_artifact_id')
    .eq('wiki_version_id', versionId)
  if (sourcesError) throw sourcesError

  const documentIds = new Set<string>()
  const chunkIds: string[] = []
  const artifactIds: string[] = []
  for (const s of sources ?? []) {
    if (s.document_id) documentIds.add(s.document_id)
    if (s.chunk_id) chunkIds.push(s.chunk_id)
    if (s.workstream_artifact_id) artifactIds.push(s.workstream_artifact_id)
  }
  if (chunkIds.length > 0) {
    const { data: chunks, error: chunksError } = await admin.from('document_chunks').select('document_id').in('id', chunkIds)
    if (chunksError) throw chunksError
    for (const c of chunks ?? []) documentIds.add(c.document_id)
  }

  return mergeManifests(
    { entries: article ? [{ resourceType: 'wiki_article', resourceId: article.slug }] : [] },
    await manifestForDocuments([...documentIds]),
    { entries: artifactIds.map((resourceId) => ({ resourceType: 'workstream_artifact' as const, resourceId })) }
  )
}
