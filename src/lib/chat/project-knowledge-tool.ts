import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import { gateProvider, getActiveEmbeddingProvider, manifestForProject } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { Database } from '@/types/database'

// Project-Aware Knowledge and Assistant Context, Stage 2. Not registered in
// src/lib/mcp/tools.ts's general registry: this tool only exists, and is
// only ever offered to the model, when runAssistantTurn has a project_id
// resolved server-side from the conversation row -- never from model input
// (the request's own "never trust a model-supplied project_id" principle).
// Same "defined here, intercepted in loop.ts before reaching callTool"
// pattern as PRESENT_RESPONSE_TOOL in response-envelope.ts, for the same
// reason: this tool's behavior depends on context callTool()'s generic
// dispatch doesn't carry.

export const SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME = 'search_project_knowledge'

const InputSchema = z.object({ query: z.string(), limit: z.number().int().min(1).max(10).default(3) })

export const SEARCH_PROJECT_KNOWLEDGE_TOOL: ToolSpec = {
  name: SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME,
  description:
    "Semantic search over THIS project's own approved knowledge -- source documents in knowledge bases attached to the project or to one of its workstreams, and any Wiki articles attached specifically to it. Results are tagged layer:'project' (this project's own evidence, prefer this) or layer:'platform' (general shared knowledge, used only to fill gaps). The project is fixed for this conversation -- there is no project parameter to set. Prefer this over search_wiki when it's available.",
  parameters: z.toJSONSchema(InputSchema),
}

export interface ProjectKnowledgeHit {
  layer: 'project' | 'platform'
  sourceType: 'wiki_article' | 'knowledge_source'
  sourceId: string
  title: string
  route: string
  similarity: number
  content: string
  // Stage 3: the specific documents.id this knowledge_source hit actually
  // resolved to -- null for a wiki_article hit (wiki has no equivalent
  // version/staleness concept). Lets a later citation carry "which version
  // was actually retrieved," so display-time can notice if the source has
  // since been updated (see envelope-resolution.ts's staleness check).
  documentVersionId: string | null
}

export interface ProjectKnowledgeBaseAttachment {
  knowledgeBaseId: string
  // null: attached to the Project itself; otherwise the workstream it's
  // attached to.
  workstreamId: string | null
  purpose: string | null
}

// Every knowledge base attachment that makes up a Project's own knowledge:
// attached to the Project (project_knowledge_bases) or to one of its
// workstreams (workstream_knowledge_bases). A knowledge base attached in
// both places appears once per attachment.
export async function listProjectKnowledgeBaseAttachments(
  supabase: WorkbenchCallerContext['supabase'],
  projectId: string
): Promise<ProjectKnowledgeBaseAttachment[]> {
  const [{ data: kbLinks, error: kbError }, { data: workstreamKbLinks, error: workstreamKbError }] = await Promise.all([
    supabase.from('project_knowledge_bases').select('knowledge_base_id, purpose').eq('project_id', projectId),
    supabase
      .from('workstream_knowledge_bases')
      .select('knowledge_base_id, workstream_id, purpose, workstream:project_workstreams!inner(project_id)')
      .eq('workstream.project_id', projectId),
  ])
  if (kbError) throw kbError
  if (workstreamKbError) throw workstreamKbError
  return [
    ...(kbLinks ?? []).map((l) => ({ knowledgeBaseId: l.knowledge_base_id, workstreamId: null, purpose: l.purpose ?? null })),
    ...(workstreamKbLinks ?? []).map((l) => ({ knowledgeBaseId: l.knowledge_base_id, workstreamId: l.workstream_id, purpose: l.purpose ?? null })),
  ]
}

// Shared between this tool and eval's project-scoped retrieval
// (src/lib/eval/retrieval.ts) so both use the exact same "what does this
// project actually have attached" membership logic rather than two
// independently-maintained copies of it.
//
// Knowledge bases attached to one of the Project's workstreams count as the
// Project's own (layer 'project') too: curated workstream knowledge is
// Project knowledge. Their approved chunks are readable by Project members
// since 20261016100001_workstream_knowledge_in_project_search.sql.
export async function getProjectKnowledgeScopeIds(
  supabase: WorkbenchCallerContext['supabase'],
  projectId: string
): Promise<{ kbIds: Set<string>; articleIds: Set<string> }> {
  const [attachments, { data: articleLinks }] = await Promise.all([
    listProjectKnowledgeBaseAttachments(supabase, projectId),
    supabase.from('project_wiki_articles').select('wiki_article_id').eq('project_id', projectId),
  ])
  return {
    kbIds: new Set(attachments.map((a) => a.knowledgeBaseId)),
    articleIds: new Set((articleLinks ?? []).map((l) => l.wiki_article_id)),
  }
}

// Tighter than search_wiki's own 4000-char cap: unlike search_wiki (one hit
// per matched article), this tool routinely returns several distinct
// knowledge_source chunks in one call, and the zadara_sandz ingested chunks
// are themselves large (~4000 chars each) -- at the old cap, a default
// 5-result call could put ~20,000 characters of raw content in a single
// tool-result message. Observed live: that produced a genuinely empty
// completion from the chat model (no content, no tool call), which then
// crashed the client renderer before the null-content fix in loop.ts.
// Capped smaller here as the primary defense; loop.ts's fallback text is
// the backstop for whatever this doesn't prevent.
const MAX_CONTENT_CHARS = 1500

type DocRow = Database['public']['Functions']['match_documents']['Returns'][number]
type WikiRow = Database['public']['Functions']['match_wiki_vectors']['Returns'][number]

function capContent(content: string): string {
  return content.length > MAX_CONTENT_CHARS ? `${content.slice(0, MAX_CONTENT_CHARS)}…` : content
}

async function embedQuery(ctx: WorkbenchCallerContext, projectId: string, query: string): Promise<number[]> {
  // Foundational (search indexing): ungated unless EMBER_GATE_FOUNDATIONAL_AI
  // is on, in which case the question carries the Project's classification.
  const embeddingProvider = await gateProvider(
    ctx.supabase,
    await getActiveEmbeddingProvider(ctx.supabase, { task: 'knowledge_search', requestedBy: ctx.user.id }),
    () => manifestForProject(projectId),
    'foundational'
  )
  const { embedding } = await embeddingProvider.embed({ text: query })
  return embedding
}

// match_documents doesn't return knowledge_source_id -- enrich via
// kb_vectors -> documents -> knowledge_sources, same "RPC stays generic,
// enrich with a follow-up query" pattern search_wiki uses for category.
async function toKnowledgeSourceHits(ctx: WorkbenchCallerContext, docRows: DocRow[], projectKbIds: Set<string>): Promise<ProjectKnowledgeHit[]> {
  const vectorIds = docRows.map((r) => r.id)
  const { data: vectorRows } = vectorIds.length
    ? await ctx.supabase.from('kb_vectors').select('id, document_id').in('id', vectorIds)
    : { data: [] as { id: string; document_id: string }[] }
  const documentIdByVectorId = new Map((vectorRows ?? []).map((v) => [v.id, v.document_id]))

  const documentIds = [...new Set((vectorRows ?? []).map((v) => v.document_id))]
  const { data: documentRows } = documentIds.length
    ? await ctx.supabase.from('documents').select('id, knowledge_source_id').in('id', documentIds)
    : { data: [] as { id: string; knowledge_source_id: string }[] }
  const sourceIdByDocumentId = new Map((documentRows ?? []).map((d) => [d.id, d.knowledge_source_id]))

  const sourceIds = [...new Set((documentRows ?? []).map((d) => d.knowledge_source_id))]
  const { data: sourceRows } = sourceIds.length
    ? await ctx.supabase.from('knowledge_sources').select('id, title, knowledge_base_id').in('id', sourceIds)
    : { data: [] as { id: string; title: string; knowledge_base_id: string }[] }
  const sourceById = new Map((sourceRows ?? []).map((s) => [s.id, s]))

  return docRows
    .map((row): ProjectKnowledgeHit | null => {
      const documentId = documentIdByVectorId.get(row.id)
      const source = documentId ? sourceById.get(sourceIdByDocumentId.get(documentId) ?? '') : undefined
      if (!source) return null
      return {
        layer: projectKbIds.has(source.knowledge_base_id) ? 'project' : 'platform',
        sourceType: 'knowledge_source',
        sourceId: source.id,
        title: source.title,
        route: `/sources/${source.id}`,
        similarity: row.similarity,
        content: capContent(row.content),
        documentVersionId: documentId ?? null,
      }
    })
    .filter((r): r is ProjectKnowledgeHit => r !== null)
}

export async function runSearchProjectKnowledge(
  ctx: WorkbenchCallerContext,
  projectId: string,
  rawInput: unknown
): Promise<{ results: ProjectKnowledgeHit[] }> {
  const input = InputSchema.parse(rawInput)
  const embedding = await embedQuery(ctx, projectId, input.query)

  const { kbIds: projectKbIds, articleIds: projectArticleIds } = await getProjectKnowledgeScopeIds(ctx.supabase, projectId)

  const [{ data: docHits, error: docError }, { data: wikiHits, error: wikiError }] = await Promise.all([
    ctx.supabase.rpc('match_documents', { query_embedding: embedding, match_threshold: 0, match_count: input.limit * 2 }),
    ctx.supabase.rpc('match_wiki_vectors', { query_embedding: embedding, match_threshold: 0, match_count: input.limit * 2 }),
  ])
  if (docError) throw docError
  if (wikiError) throw wikiError

  const docRows: DocRow[] = docHits ?? []
  const wikiRows: WikiRow[] = wikiHits ?? []

  const docResults = await toKnowledgeSourceHits(ctx, docRows, projectKbIds)

  const wikiResults: ProjectKnowledgeHit[] = wikiRows.map((row) => ({
    layer: projectArticleIds.has(row.wiki_article_id) ? 'project' : 'platform',
    sourceType: 'wiki_article',
    sourceId: row.article_slug,
    title: row.article_title,
    route: `/wiki/${row.article_slug}`,
    similarity: row.similarity,
    content: capContent(row.content),
    documentVersionId: null,
  }))

  // Project layer first, platform layer after -- explicit, code-enforced
  // precedence rather than relying on embedding-similarity ranking, per
  // "Project evidence wins when it conflicts with generic platform guidance."
  const merged = [...docResults, ...wikiResults].sort((a, b) => (a.layer === b.layer ? 0 : a.layer === 'project' ? -1 : 1))

  return { results: merged.slice(0, input.limit) }
}

// Search limited to the given knowledge bases (e.g. one workstream's, or a
// single one) -- source documents only: no Wiki articles and no platform
// fallback. The caller decides which knowledge bases are in scope and must
// have checked they belong to the Project. Queried per knowledge base
// through match_documents' own filter (a chunk's doc_type is its knowledge
// base id), rather than filtering the global top hits afterwards, which
// would miss a small knowledge base whose chunks never rank there.
export async function runScopedProjectKnowledgeSearch(
  ctx: WorkbenchCallerContext,
  projectId: string,
  knowledgeBaseIds: string[],
  rawInput: unknown
): Promise<{ results: ProjectKnowledgeHit[] }> {
  const input = InputSchema.parse(rawInput)
  const kbIds = [...new Set(knowledgeBaseIds)]
  if (kbIds.length === 0) return { results: [] }
  const embedding = await embedQuery(ctx, projectId, input.query)

  const perKb = await Promise.all(
    kbIds.map((kbId) =>
      ctx.supabase.rpc('match_documents', { query_embedding: embedding, match_threshold: 0, match_count: input.limit, filter_doc_type: kbId })
    )
  )
  const docRows: DocRow[] = []
  for (const { data, error } of perKb) {
    if (error) throw error
    docRows.push(...(data ?? []))
  }
  docRows.sort((a, b) => b.similarity - a.similarity)

  const results = await toKnowledgeSourceHits(ctx, docRows.slice(0, input.limit), new Set(kbIds))
  return { results }
}
