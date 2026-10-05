import 'server-only'
import { gateProvider, getActiveEmbeddingProvider, manifestForProject } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

// Ember Readiness follow-up: AI-based grouping of knowledge gaps
// (20261018100001_knowledge_gap_semantic_grouping.sql). A gap is embedded
// from its missing topic and question with the platform's default embedding
// model, through the same AI policy gate as Project knowledge search
// ('foundational': search indexing, gated only when EMBER_GATE_FOUNDATIONAL_AI
// is on, and then with the Project's classification).

// Cosine similarity at or above which a new detection joins an open gap.
// Rephrasings of one question typically score well above this with current
// embedding models; different questions about the same system score lower.
// Tunable: the database function accepts 0.5-1.
export const GAP_SEMANTIC_SIMILARITY = 0.82

export interface GapEmbedding {
  embedding: number[]
  // "<model>/<dimensions>" -- vectors are only compared with the same key.
  model: string
}

export function gapEmbeddingText(question: string, missingTopic?: string | null): string {
  return [missingTopic?.trim(), question.trim()].filter(Boolean).join('\n').slice(0, 2000)
}

// Best effort: null when there is no embedding model, the policy gate blocks
// it, or the call fails. Grouping then falls back to word overlap.
export async function embedKnowledgeGap(
  ctx: WorkbenchCallerContext,
  projectId: string,
  question: string,
  missingTopic?: string | null
): Promise<GapEmbedding | null> {
  try {
    const provider = await gateProvider(
      ctx.supabase,
      await getActiveEmbeddingProvider(ctx.supabase, { task: 'knowledge_gap_grouping', requestedBy: ctx.user.id }),
      () => manifestForProject(projectId),
      'foundational'
    )
    const result = await provider.embed({ text: gapEmbeddingText(question, missingTopic) })
    if (!result.embedding?.length) return null
    return { embedding: result.embedding, model: `${result.model}/${result.dimensions || result.embedding.length}` }
  } catch (err) {
    console.error('Could not embed a knowledge gap; grouping falls back to word overlap', err)
    return null
  }
}
