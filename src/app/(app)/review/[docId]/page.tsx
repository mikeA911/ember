import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getRestrictedResourceIds } from '@/lib/projects/evidence-access'
import { ChunkReviewer } from '@/components/curator/ChunkReviewer'

// Chunk enrichment (enrichMoreChunks -> enrichDocumentChunks) calls one AI
// request per chunk, sequentially -- Vercel's default serverless function
// timeout can be too short for more than a handful of chunks. Raise the
// ceiling here rather than building a job queue (out of scope for this
// milestone/scale); if a document has enough chunks to exceed even this,
// re-run enrichment in smaller batches for now.
export const maxDuration = 60

export default async function ReviewPage({ params }: { params: Promise<{ docId: string }> }) {
  const { docId } = await params
  const supabase = await createClient()

  const { data: document } = await supabase.from('documents').select('*').eq('id', docId).single()
  if (!document) notFound()

  const { data: chunks } = await supabase
    .from('document_chunks')
    .select('*')
    .eq('document_id', docId)
    .order('chunk_index', { ascending: true })

  // Early heads-up, not a gate -- the actual leak prevention is at
  // Wiki-synthesis-input time (src/app/(app)/wiki/new/page.tsx,
  // src/app/actions/wiki.ts). document_chunks' own RLS has no evidence-
  // access gating at all, so a curator can reach this page for a restricted
  // source's document regardless of their own access to it.
  const restrictedIds = document.knowledge_source_id
    ? await getRestrictedResourceIds('knowledge_source', [document.knowledge_source_id])
    : new Set<string>()
  const sourceRestricted = !!document.knowledge_source_id && restrictedIds.has(document.knowledge_source_id)

  // Where "done reviewing" leads: a project this document's knowledge base
  // is attached to, if the reviewer can see one (RLS-scoped), else the
  // curator dashboard.
  const { data: attachment } = await supabase
    .from('project_knowledge_bases')
    .select('project:projects(id, name)')
    .eq('knowledge_base_id', document.doc_type)
    .limit(1)
    .maybeSingle()
  const project = attachment?.project as { id: string; name: string } | null | undefined
  const backLink = project ? { href: `/projects/${project.id}`, label: `Back to ${project.name}` } : { href: '/dashboard', label: 'Back to dashboard' }

  return <ChunkReviewer document={document} chunks={chunks ?? []} sourceRestricted={sourceRestricted} backLink={backLink} />
}
