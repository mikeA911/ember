import 'server-only'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { notifyProjectCurators } from '@/lib/projects/knowledge-gaps'
import type { KnowledgeCoverage } from './response-envelope'
import type { KnowledgeGapSignal } from '@/types/database'

// Ember Readiness, Stage 4 (docs/dev-request-ember-readiness-and-knowledge-
// gaps.md): after an Ember answer in a Project conversation, decide whether
// it exposed a gap in the Project's knowledge and, if so, file it for the
// Project's curators. Structured signals only -- never phrase matching on
// the reply text.

// A Project-layer search hit at least this similar counts as relevant
// Project evidence. Below it (or no Project hit at all), and with no
// Project citation and no coverage declaration, the answer is treated as
// not grounded in the Project's knowledge.
export const PROJECT_EVIDENCE_SIMILARITY = 0.4

// Curators get one note when a gap is first detected, and a digest note
// when the same question has come up this many times -- not one per ask.
export const DIGEST_AT_OCCURRENCES = [3, 10, 25]

export interface GapDetectionInput {
  // Ember's own declaration, when it made one.
  coverage: KnowledgeCoverage | undefined
  // Whether search_project_knowledge ran successfully this turn.
  projectSearchRan: boolean
  // Best similarity among Project-layer hits this turn, null when none.
  bestProjectSimilarity: number | null
  // Verified citations of Project-layer evidence in the answer.
  projectCitationCount: number
}

// Pure, so the rules are unit-testable.
//   * Ember declared 'partial' or 'not_in_project_knowledge' -> gap.
//   * Ember declared 'answered' -> no gap (this is also how greetings and
//     out-of-scope questions are kept out).
//   * No declaration: a gap only when the Project search ran, found nothing
//     relevant, and the answer cites no Project evidence.
export function detectKnowledgeGapSignal(input: GapDetectionInput): KnowledgeGapSignal | null {
  if (input.coverage) {
    return input.coverage.status === 'answered' ? null : 'declared'
  }
  if (!input.projectSearchRan || input.projectCitationCount > 0) return null
  if (input.bestProjectSimilarity !== null && input.bestProjectSimilarity >= PROJECT_EVIDENCE_SIMILARITY) return null
  return 'no_project_evidence'
}

export interface RecordedKnowledgeGap {
  gapId: string
  occurrenceId: string
  isNew: boolean
  occurrenceCount: number
}

// Records the detection (grouping with a similar open gap, in the
// database) and notifies curators. Never throws: a failure here must never
// break the chat turn that already succeeded.
export async function recordKnowledgeGap(
  ctx: WorkbenchCallerContext,
  input: { projectId: string; messageId: string; question: string; missingTopic: string | undefined; signal: KnowledgeGapSignal }
): Promise<RecordedKnowledgeGap | null> {
  try {
    const { data, error } = await ctx.supabase.rpc('record_automatic_knowledge_gap', {
      p_message_id: input.messageId,
      p_question: input.question.slice(0, 2000),
      p_missing_topic: input.missingTopic ?? null,
      p_signal: input.signal,
    })
    if (error) throw error
    const row = data?.[0]
    if (!row) return null
    const recorded = { gapId: row.gap_id, occurrenceId: row.occurrence_id, isNew: row.is_new, occurrenceCount: row.occurrence_count }

    const topic = input.missingTopic ? ` (missing: ${input.missingTopic})` : ''
    if (recorded.isNew) {
      await notifyProjectCurators(
        ctx,
        input.projectId,
        recorded.gapId,
        'Ember found a knowledge gap',
        `Ember couldn't answer a question from this Project's knowledge${topic}: "${input.question.slice(0, 200)}". Review it in the Project's knowledge gaps.`
      )
    } else if (DIGEST_AT_OCCURRENCES.includes(recorded.occurrenceCount)) {
      await notifyProjectCurators(
        ctx,
        input.projectId,
        recorded.gapId,
        'A knowledge gap keeps coming up',
        `A question Ember can't answer from this Project's knowledge has now come up ${recorded.occurrenceCount} times${topic}. Review it in the Project's knowledge gaps.`
      )
    }
    return recorded
  } catch (err) {
    console.error('Failed to record a knowledge gap', err)
    return null
  }
}
