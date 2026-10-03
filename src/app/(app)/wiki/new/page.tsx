import { createClient } from '@/lib/supabase/server'
import { listCategories } from '@/lib/wiki/queries'
import { getRestrictedResourceIds } from '@/lib/projects/evidence-access'
import { NewArticleForms } from '@/components/wiki/NewArticleForms'

export default async function NewWikiArticlePage({ searchParams }: { searchParams: Promise<{ artifact?: string }> }) {
  // ?artifact=<id> -- a workstream artifact's "Draft a Wiki article" link.
  const { artifact: requestedArtifactId } = await searchParams
  const supabase = await createClient()

  const [categories, { data: chunks }, { data: recentArtifactRows }] = await Promise.all([
    listCategories(supabase),
    supabase
      .from('document_chunks')
      .select('id, chunk_text, source_page, document_id')
      .eq('review_status', 'approved')
      .order('created_at', { ascending: false })
      .limit(50),
    // RLS-scoped (workstream_artifacts_select_member) -- naturally limited to
    // artifacts on projects this viewer is a member of, or all of them if admin.
    supabase
      .from('workstream_artifacts')
      .select('id, title, content, workstream_id')
      .not('content', 'is', null)
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  // The linked artifact may be older than the 50 most recent -- fetch it too
  // (same RLS-scoped client, so only if this viewer can see it).
  let artifactRows = recentArtifactRows ?? []
  if (requestedArtifactId && !artifactRows.some((a) => a.id === requestedArtifactId)) {
    const { data: requested } = await supabase
      .from('workstream_artifacts')
      .select('id, title, content, workstream_id')
      .eq('id', requestedArtifactId)
      .not('content', 'is', null)
      .maybeSingle()
    if (requested) artifactRows = [requested, ...artifactRows]
  }

  const documentIds = [...new Set((chunks ?? []).map((c) => c.document_id))]
  const { data: documents } = documentIds.length
    ? await supabase.from('documents').select('id, original_filename, doc_type, knowledge_source_id').in('id', documentIds)
    : { data: [] }
  const documentById = new Map((documents ?? []).map((d) => [d.id, d]))

  // Keep a restricted source's chunks out of the Wiki-synthesis picker
  // entirely, regardless of the viewer's own access to it -- see
  // getRestrictedResourceIds's own comment for why this can't just be "can
  // I see it" (has_evidence_access already answers that for document_chunks'
  // own -- ungated -- select; this is the separate leak-prevention check).
  const knowledgeSourceIds = [...new Set((documents ?? []).map((d) => d.knowledge_source_id).filter((id): id is string => !!id))]
  const restrictedSourceIds = await getRestrictedResourceIds('knowledge_source', knowledgeSourceIds)

  const approvedChunks = (chunks ?? [])
    .filter((c) => {
      const doc = documentById.get(c.document_id)
      return !doc?.knowledge_source_id || !restrictedSourceIds.has(doc.knowledge_source_id)
    })
    .map((c) => ({
      ...c,
      document: documentById.get(c.document_id) ?? null,
    }))

  const workstreamIds = [...new Set((artifactRows ?? []).map((a) => a.workstream_id))]
  const { data: workstreamRows } = workstreamIds.length
    ? await supabase.from('project_workstreams').select('id, name, project_id').in('id', workstreamIds)
    : { data: [] }
  const projectIds = [...new Set((workstreamRows ?? []).map((w) => w.project_id))]
  const { data: projectRows } = projectIds.length
    ? await supabase.from('projects').select('id, name').in('id', projectIds)
    : { data: [] }
  const projectNameById = new Map((projectRows ?? []).map((p) => [p.id, p.name]))
  const workstreamById = new Map(
    (workstreamRows ?? []).map((w) => [w.id, { name: w.name, projectName: projectNameById.get(w.project_id) ?? null }])
  )

  // Same leak-prevention reasoning as the chunk filter above -- a curator
  // with a personal grant on a restricted artifact can already see it here
  // via workstream_artifacts_select_member's RLS, but shouldn't be able to
  // publish it into an open Wiki article.
  const restrictedArtifactIds = await getRestrictedResourceIds(
    'workstream_artifact',
    (artifactRows ?? []).map((a) => a.id)
  )

  const artifacts = (artifactRows ?? [])
    .filter((a) => !restrictedArtifactIds.has(a.id))
    .map((a) => ({
      id: a.id,
      title: a.title,
      workstreamName: workstreamById.get(a.workstream_id)?.name ?? null,
      projectName: workstreamById.get(a.workstream_id)?.projectName ?? null,
    }))

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h1 className="text-xl font-semibold">New Wiki article</h1>
      <NewArticleForms categories={categories} approvedChunks={approvedChunks} artifacts={artifacts} initialArtifactId={requestedArtifactId} />
    </div>
  )
}
