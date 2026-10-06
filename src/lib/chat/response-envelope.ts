import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'

// docs/dev-request-structured-assistant-responses-and-artifacts-panel.md's
// versioned response envelope. Target kinds are deliberately narrower than
// the doc's own example list -- limited to what has a confirmed, real route
// today (see navigation-resolver.ts). Widen only when a new kind actually
// has somewhere to resolve to. knowledge_source added in Project-Aware
// Knowledge and Assistant Context, Stage 2 -- resolves via
// /sources/[id] (src/app/(app)/sources/[id]/page.tsx), RLS-gated the same
// way as the underlying knowledge_sources row itself.
// project_note added in Role-Aware Project Views Stage 4 -- resolves via
// /projects/[id]/notes/[noteId], RLS-gated the same way as the underlying
// project_notes row itself (see navigation-resolver.ts).
// working_knowledge added in Working Knowledge & Research Notebooks Stage
// 1+2 -- resolves via /projects/[id]/working-knowledge/[itemId], RLS-gated
// the same way (can_view_working_knowledge_item).
export const NavigationTargetKindSchema = z.enum([
  'wiki_article',
  'project',
  'workstream',
  'assessment',
  'knowledge_source',
  'project_note',
  'working_knowledge',
  // Solution conformance, Stage 5 -- /projects/[id]/requirements/[id],
  // RLS-gated (members read the register).
  'solution_requirement',
])
export type NavigationTargetKind = z.infer<typeof NavigationTargetKindSchema>

// citations[].sourceType was pinned to 'wiki_article' while search_wiki was
// the only tool that returned provenance-checkable retrieved content;
// search_project_knowledge (Stage 2) also retrieves knowledge_source chunks,
// so this widens to match. list_project_notes still isn't evidence a reply
// "cites" -- only real retrieval tools produce citable content.
// working_knowledge added in Working Knowledge & Research Notebooks Stage
// 1+2 (search_my_working_knowledge/search_shared_working_knowledge) --
// StructuredResponse.tsx renders this with a distinct "Working
// research"/"Private working note"/"Project-shared research" badge that can
// never be confused with the approved-evidence badge the other two get.
export const CitationSourceTypeSchema = z.enum(['wiki_article', 'knowledge_source', 'working_knowledge'])
export const AssistantResponseEnvelopeSchema = z.object({
  schemaVersion: z.literal('1.0'),
  message: z.string().min(1).max(8000),
  quickSummary: z.string().max(300).optional(),
  requirements: z
    .array(
      z.object({
        label: z.string().max(200),
        status: z.enum(['available', 'needed', 'optional', 'can_be_produced_elsewhere', 'unknown']),
        importance: z.enum(['required', 'recommended', 'optional']),
      })
    )
    .max(10)
    .optional(),
  links: z
    .array(
      z.object({
        label: z.string().max(200),
        target: z.object({ kind: NavigationTargetKindSchema, id: z.string().max(200) }),
      })
    )
    .max(6)
    .optional(),
  documents: z
    .array(z.object({ label: z.string().max(200), documentType: z.string().max(60), artifactId: z.string() }))
    .max(6)
    .optional(),
  citations: z
    .array(z.object({ label: z.string().max(200), sourceType: CitationSourceTypeSchema, sourceId: z.string().max(200) }))
    .max(8)
    .optional(),
  nextSteps: z
    .array(
      z.object({
        label: z.string().max(200),
        status: z.enum(['suggested', 'ready', 'blocked', 'completed']),
        // No executable action type ships this phase -- automatically
        // executing proposed next steps is explicitly out of scope.
        action: z.null(),
      })
    )
    .max(8)
    .optional(),
  suggestedPrompts: z.array(z.string().max(160)).max(4).optional(),
  // Ember Readiness, Stage 4: in a Project conversation, whether this answer
  // is grounded in the Project's own approved knowledge. 'partial' or
  // 'not_in_project_knowledge' files a knowledge gap for the Project's
  // curators (src/lib/chat/knowledge-gap-detection.ts).
  knowledgeCoverage: z
    .object({
      status: z.enum(['answered', 'partial', 'not_in_project_knowledge']),
      missingTopic: z.string().max(200).optional(),
    })
    .optional(),
})
export type AssistantResponseEnvelope = z.infer<typeof AssistantResponseEnvelopeSchema>
export type KnowledgeCoverage = NonNullable<AssistantResponseEnvelope['knowledgeCoverage']>

// The shape actually persisted to chat_messages.response_payload. Citations
// are permanently filtered here to only those verified present in this
// turn's own tool results -- that's a point-in-time historical fact, safe
// to bake in for good. links/documents keep their raw, unresolved
// references ({kind,id} / artifactId) rather than a baked-in route: a
// project, workstream, or wiki article's visibility can change after this
// message is written, so the route has to be re-derived from the reference
// every time it's displayed, not cached. Garbage references (never
// resolved even once, at persist time) are dropped and don't make it here
// at all -- see envelope-resolution.ts.
export interface PersistedAssistantEnvelope {
  message: string
  quickSummary?: string
  requirements?: AssistantResponseEnvelope['requirements']
  links?: { label: string; target: { kind: NavigationTargetKind; id: string } }[]
  documents?: { label: string; documentType: string; artifactId: string }[]
  // Stage 3: attached from this turn's own retrieval provenance
  // (envelope-resolution.ts), never from the model -- layer is which
  // knowledge tier the hit came from, documentVersionId is the specific
  // documents.id a knowledge_source citation actually resolved to (absent
  // for a wiki_article citation, which has no version/staleness concept).
  // workingKnowledgeType/workingKnowledgeVisibility are the Working
  // Knowledge equivalent -- also attached from real retrieval provenance,
  // never the model -- StructuredResponse.tsx uses them to pick a distinct
  // "Working research"/"Private working note"/"Project-shared research"
  // badge that can never be confused with layer's approved-evidence badge.
  citations?: {
    label: string
    sourceType: CitationSourceType
    sourceId: string
    layer?: 'project' | 'platform'
    documentVersionId?: string
    workingKnowledgeType?: 'research_notebook' | 'working_note'
    workingKnowledgeVisibility?: 'private' | 'shared_selected' | 'shared_project'
  }[]
  nextSteps?: AssistantResponseEnvelope['nextSteps']
  suggestedPrompts?: string[]
  knowledgeCoverage?: KnowledgeCoverage
}
export type CitationSourceType = z.infer<typeof CitationSourceTypeSchema>

// Lenient validator for reading chat_messages.response_payload back out --
// the column is untyped jsonb (see database.ts's comment), so a row from
// before this feature, or after some future incompatible schema change,
// must fail closed to "no structured payload" rather than being assumed to
// match today's shape.
export const PersistedAssistantEnvelopeSchema: z.ZodType<PersistedAssistantEnvelope> = z.object({
  message: z.string(),
  quickSummary: z.string().optional(),
  requirements: AssistantResponseEnvelopeSchema.shape.requirements,
  links: z.array(z.object({ label: z.string(), target: z.object({ kind: NavigationTargetKindSchema, id: z.string() }) })).optional(),
  documents: z.array(z.object({ label: z.string(), documentType: z.string(), artifactId: z.string() })).optional(),
  citations: z
    .array(
      z.object({
        label: z.string(),
        sourceType: CitationSourceTypeSchema,
        sourceId: z.string(),
        layer: z.enum(['project', 'platform']).optional(),
        documentVersionId: z.string().optional(),
        workingKnowledgeType: z.enum(['research_notebook', 'working_note']).optional(),
        workingKnowledgeVisibility: z.enum(['private', 'shared_selected', 'shared_project']).optional(),
      })
    )
    .optional(),
  nextSteps: AssistantResponseEnvelopeSchema.shape.nextSteps,
  suggestedPrompts: z.array(z.string()).optional(),
  knowledgeCoverage: AssistantResponseEnvelopeSchema.shape.knowledgeCoverage,
})

// The shape actually handed to the client for rendering: links/documents/
// citations replaced by their *freshly resolved* forms (label + route, or
// enrichment fields). Computed from a PersistedAssistantEnvelope by
// envelope-resolution.ts, both immediately after a turn completes and again
// on every subsequent history read -- never cached.
export interface VerifiedAssistantEnvelope {
  message: string
  quickSummary?: string
  requirements?: AssistantResponseEnvelope['requirements']
  links?: { label: string; route: string }[]
  documents?: { label: string; documentType: string; artifactId: string; title: string; route: string | null }[]
  // stale: the source has a newer version than the one actually cited --
  // recomputed on every read (see resolveEnvelopeForDisplay), never cached.
  citations?: {
    label: string
    sourceType: CitationSourceType
    sourceId: string
    route: string
    layer?: 'project' | 'platform'
    stale?: boolean
    workingKnowledgeType?: 'research_notebook' | 'working_note'
    workingKnowledgeVisibility?: 'private' | 'shared_selected' | 'shared_project'
  }[]
  nextSteps?: AssistantResponseEnvelope['nextSteps']
  suggestedPrompts?: string[]
}

// Not registered in src/lib/mcp/tools.ts's tools map: that registry is for
// real, executable tools callTool() dispatches into. This one is
// intercepted in loop.ts before ever reaching callTool, so a "handler that
// never runs" would be dead weight there -- defined here instead and
// appended to the tools list passed to generateChat.
export const PRESENT_RESPONSE_TOOL_NAME = 'present_assistant_response'

export const PRESENT_RESPONSE_TOOL: ToolSpec = {
  name: PRESENT_RESPONSE_TOOL_NAME,
  description:
    'Submit your final structured response for this turn. Call this exactly once as your last action, after any evidence-gathering, instead of replying with plain text.',
  parameters: z.toJSONSchema(AssistantResponseEnvelopeSchema),
}
