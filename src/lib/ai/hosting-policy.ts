import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import { knowledgeBaseIdsForDocuments, projectIdsUsingKnowledgeBases } from './policy-manifests'

// Where a content AI call for a Project may run (Sandz policy, October 2026):
//
// - 'any': presales work. Builder workspaces, client Projects before they go
//   Live, and internal/foundation Projects (Supabase stacks, hosting, Public
//   Pages, presentations) may use any approved model, within the builder's
//   budget where metering applies.
// - 'self_hosted_only': a contracted client Project that is Live. Content
//   calls (chat, summaries, Wiki drafts, presentations, ontology
//   suggestions) must use a provider flagged ai_providers.is_self_hosted,
//   and Ember switches to one automatically.
//
// "Contracted client Project" = it has a client_project_fees row, which only
// the accepted-proposal promotion creates (workstream-promotions.ts) -- not
// portfolio_category, which owners and curators edit freely, so recategorizing
// a client Project can't loosen the rule. Foundational calls (enrichment,
// embeddings) are never affected (src/lib/ai/sensitivity.ts AICallPurpose).
//
// Reads ids, statuses and fee-row existence only, with the service-role
// client, so the answer doesn't depend on who is asking.
export type AIHostingRequirement = 'any' | 'self_hosted_only'

export async function aiHostingForProjects(projectIds: string[]): Promise<AIHostingRequirement> {
  const ids = [...new Set(projectIds.filter(Boolean))]
  if (ids.length === 0) return 'any'
  const admin = createAdminClient()
  const { data: live, error } = await admin.from('projects').select('id').in('id', ids).eq('status', 'live')
  if (error) throw error
  const liveIds = (live ?? []).map((p) => p.id)
  if (liveIds.length === 0) return 'any'
  const { data: clientRows, error: feeError } = await admin.from('client_project_fees').select('project_id').in('project_id', liveIds)
  if (feeError) throw feeError
  return (clientRows ?? []).length > 0 ? 'self_hosted_only' : 'any'
}

export async function aiHostingForProject(projectId: string): Promise<AIHostingRequirement> {
  return aiHostingForProjects([projectId])
}

export async function aiHostingForWorkstream(workstreamId: string): Promise<AIHostingRequirement> {
  const { data, error } = await createAdminClient().from('project_workstreams').select('project_id').eq('id', workstreamId).maybeSingle()
  if (error) throw error
  return data ? aiHostingForProject(data.project_id) : 'any'
}

export async function aiHostingForArtifact(artifactId: string): Promise<AIHostingRequirement> {
  const { data, error } = await createAdminClient().from('workstream_artifacts').select('workstream_id').eq('id', artifactId).maybeSingle()
  if (error) throw error
  return data ? aiHostingForWorkstream(data.workstream_id) : 'any'
}

// Source documents (a Wiki draft synthesized from chunks): the strictest
// requirement of any Project whose knowledge bases hold them.
export async function aiHostingForDocuments(documentIds: string[]): Promise<AIHostingRequirement> {
  return aiHostingForProjects(await projectIdsUsingKnowledgeBases(await knowledgeBaseIdsForDocuments(documentIds)))
}
