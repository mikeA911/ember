import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import { env } from '@/lib/env'

// Pre-sales web research, Phase 1. Not registered in src/lib/mcp/tools.ts's
// general registry -- intercepted directly in loop.ts, same as
// search_project_knowledge/list_project_members, because it needs turn-
// scoped behavior (a per-turn call cap, env-based availability) that the
// generic callTool(ctx, name, input) dispatch has no way to carry.
//
// Deliberately NOT a citation source: response-envelope.ts's citation
// schema only covers sourceType 'wiki_article'/'knowledge_source', both
// verified server-side against real internal retrieval provenance. A raw
// web result has none of that provenance, so it's never fed into
// retrievedWikiArticleSlugs/retrievedKnowledgeSourceIds in loop.ts -- a
// finding only becomes real, citable project knowledge once a curator
// approves a research_dossier artifact built from it (see
// buildProjectPromptAddendum's guidance and source-submissions.ts).

export const SEARCH_WEB_TOOL_NAME = 'search_web'

const InputSchema = z.object({
  query: z.string(),
  maxResults: z.number().int().min(1).max(10).default(5),
  // Tavily's search_depth: 'basic' (fast) vs 'advanced' (slower, better
  // relevance) -- exposed because competitive/pre-sales research is
  // exactly the kind of harder query 'advanced' is for.
  searchDepth: z.enum(['basic', 'advanced']).default('basic'),
  // 'news' biases toward recent/dated results -- useful for "what has this
  // company announced recently" competitive research.
  topic: z.enum(['general', 'news']).default('general'),
  timeRange: z.enum(['day', 'week', 'month', 'year']).optional(),
})

export const SEARCH_WEB_TOOL: ToolSpec = {
  name: SEARCH_WEB_TOOL_NAME,
  description:
    "Search the public web via Tavily. Use for pre-sales/competitive research about a prospective client or competitor -- something NOT already covered by search_project_knowledge or search_wiki. Results are NOT vetted Ember evidence: never present them as facts about the platform's own data, never cite them via present_assistant_response's citations field (that's reserved for verified internal retrieval), and never claim anything found here is 'in the knowledge base' -- it becomes real project knowledge only after you propose it as a research_dossier artifact via attach_workstream_artifact and a curator approves it.",
  parameters: z.toJSONSchema(InputSchema),
}

export interface WebSearchHit {
  title: string
  url: string
  content: string
  score: number
  publishedDate: string | null
}

interface TavilyResult {
  title?: string
  url?: string
  content?: string
  score?: number
  published_date?: string
}

interface TavilyResponse {
  results?: TavilyResult[]
  answer?: string
}

export async function runSearchWeb(rawInput: unknown): Promise<{ results: WebSearchHit[]; answer: string | null }> {
  const input = InputSchema.parse(rawInput)
  const apiKey = env.tavilyApiKey()
  if (!apiKey) throw new Error('Web research is not configured (TAVILY_API_KEY unset).')

  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      query: input.query,
      search_depth: input.searchDepth,
      topic: input.topic,
      time_range: input.timeRange,
      max_results: input.maxResults,
      include_answer: false,
    }),
  })
  if (!res.ok) throw new Error(`Tavily search failed (${res.status}): ${await res.text()}`)
  const data = (await res.json()) as TavilyResponse

  const results: WebSearchHit[] = (data.results ?? []).map((r) => ({
    title: r.title ?? '',
    url: r.url ?? '',
    content: r.content ?? '',
    score: r.score ?? 0,
    publishedDate: r.published_date ?? null,
  }))
  return { results, answer: data.answer ?? null }
}
