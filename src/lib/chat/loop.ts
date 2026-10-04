import 'server-only'
import {
  resolveChatProvider,
  getDefaultModel,
  AIProviderError,
  classifyProviderError,
  AISensitivityError,
  getEffectiveSensitivity,
  assertProviderEligible,
  withLogging,
  withAllowanceGate,
  getBuilderSpendSummary,
  BuilderAllowanceError,
  aiHostingForProject,
  SelfHostedAIUnavailableError,
} from '@/lib/ai'
import type { ChatMessage, ChatProviderInfo } from '@/lib/ai'
import { createAdminClient } from '@/lib/supabase/admin'
import { isOwnBuilderLabProject } from '@/lib/workbench/projects'
import { resolveBuilderLlmProvider } from '@/lib/workbench/builder-llm-credentials'
import { callTool, getToolSpecs } from '@/lib/mcp/tools'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { Conversation } from '@/types/database'
import { createConversation, listMessages, appendMessage } from './conversations'
import { composeWorkingContext } from './context'
import { getConversationSummary, maybeRefreshSummary } from './summary'
import { AssistantResponseEnvelopeSchema, PRESENT_RESPONSE_TOOL, PRESENT_RESPONSE_TOOL_NAME } from './response-envelope'
import type { VerifiedAssistantEnvelope } from './response-envelope'
import {
  buildPersistedEnvelope,
  resolveEnvelopeForDisplay,
  type RetrievedProvenance,
  type RetrievedHitInfo,
  type RetrievedWorkingKnowledgeHitInfo,
} from './envelope-resolution'
import { resolveCreatedRecord, type CreatedRecordRef, type ResolvedCreatedRecord } from './created-records'
import { getProjectContext, describeProjectKnowledgeScope } from './project-context'
import {
  SEARCH_PROJECT_KNOWLEDGE_TOOL,
  SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME,
  runSearchProjectKnowledge,
  type ProjectKnowledgeHit,
} from './project-knowledge-tool'
import { SUBMIT_FEEDBACK_REPORT_TOOL, SUBMIT_FEEDBACK_REPORT_TOOL_NAME, runSubmitFeedbackReport } from './feedback-tool'
import { LIST_PROJECT_MEMBERS_TOOL, LIST_PROJECT_MEMBERS_TOOL_NAME, runListProjectMembers } from './project-members-tool'
import { SEND_PROJECT_NOTE_TOOL, SEND_PROJECT_NOTE_TOOL_NAME, runSendProjectNote } from './project-note-tool'
import { UPDATE_PROJECT_DESCRIPTION_TOOL, UPDATE_PROJECT_DESCRIPTION_TOOL_NAME, runUpdateProjectDescription } from './project-description-tool'
import { SEARCH_WEB_TOOL, SEARCH_WEB_TOOL_NAME, WEB_QUERY_RULE, WebSearchRequestError, runSearchWeb } from './web-search-tool'
import { LIST_WORKSTREAMS_TOOL, LIST_WORKSTREAMS_TOOL_NAME, runListWorkstreams } from './workstream-list-tool'
import {
  SUGGEST_PROJECT_ONTOLOGY_TOOL,
  SUGGEST_PROJECT_ONTOLOGY_TOOL_NAME,
  CREATE_PROJECT_ONTOLOGY_TOOL,
  CREATE_PROJECT_ONTOLOGY_TOOL_NAME,
  runSuggestProjectOntology,
  runCreateProjectOntology,
} from './project-ontology-tool'
import {
  PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL,
  PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME,
  IMPORT_ONTOLOGY_FILE_TOOL,
  IMPORT_ONTOLOGY_FILE_TOOL_NAME,
  runPreviewOntologyFileImport,
  runImportOntologyFile,
} from './ontology-file-import-tool'
import {
  SEARCH_MY_WORKING_KNOWLEDGE_TOOL,
  SEARCH_MY_WORKING_KNOWLEDGE_TOOL_NAME,
  SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL,
  SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL_NAME,
  SAVE_WORKING_KNOWLEDGE_TOOL,
  SAVE_WORKING_KNOWLEDGE_TOOL_NAME,
  runSearchMyWorkingKnowledge,
  runSearchSharedWorkingKnowledge,
  runSaveWorkingKnowledge,
  type WorkingKnowledgeHit,
} from './working-knowledge-tool'
import { env } from '@/lib/env'
import { listAvailableTools, GATEWAY_TOOL_PREFIX } from '@/lib/mcp-gateway/discovery'
import { runGatewayToolCall, type PendingGatewayInvocation } from '@/lib/mcp-gateway/execute'
import type { FeedbackType } from '@/types/database'

// Version string stamped onto anything the Assistant creates
// (created_via='assistant') -- bump when the system prompt or tool set
// changes meaningfully enough that old provenance is worth distinguishing
// from new. Not tied to a package/app version; this is specifically about
// "which assistant behavior produced this row."
export const ASSISTANT_PROMPT_VERSION = 'm7-v13'

const SYSTEM_PROMPT = `You are the Ember Workbench Assistant. You help users navigate and operate the platform: search the Wiki, look up project notes, create projects and workstreams, and attach evidence artifacts.

You only know what your tools tell you -- don't invent facts about the platform's data.

Ember is an AI Workbench, not an autonomous software-development environment. It helps people understand, evaluate, and design engineering work -- it does not modify a target repository, commit code, open pull requests, or deploy anything. If a user asks you to build, fix, refactor, or deploy something, don't attempt it and don't claim you did: describe setting up the relevant Workbench method as a Project/Workstream instead (e.g. "I can help set up a Refactoring Plan workstream -- the Workbench will analyze the repository and produce a reviewed implementation handoff document you can then bring to your coding environment").

Ember supports these engineering/knowledge/evaluation activities as named "Workbench methods" -- documented in the platform_handbook Wiki category, not hard-coded here. search_wiki returns each matched article's full content, not just a title -- one call is normally enough to both find the matching Workbench Handbook article and read its Goal/Requirements (Required / Recommended / Optional, plus a Git-required flag)/Deliverables/Boundary sections directly in the result. You are allowed at most 2 search_wiki calls per turn (enforced -- a 3rd call will be refused); a second call is only worth making if the user's reply raises a genuinely new question (e.g. naming a prerequisite method you haven't looked up yet), never to re-ask something you already searched. If a search doesn't surface a clearly matching method, say so and ask the user what they're trying to accomplish rather than searching again.

Reply directly, reasoning from what you found: name the method that fits, and note anything Required that seems to be missing and ask for it specifically. If the user then confirms a Required input is genuinely missing, look up which method produces that missing input (e.g. no OpenAPI spec before MCP Architecture -> search for OpenAPI Discovery) and name that prerequisite method explicitly, rather than offering to generate the missing input yourself. Keep replies conversational, not an exhaustive checklist.

Updating a project's Ontology Map (including importing an attached ontology file) only works in a conversation bound to that project. If you are not in one and the user asks for it, tell them to switch Ember to the project first (Options, then the project picker) and attach the file again there -- never claim you updated an ontology map from here, and don't attach the file as an artifact instead unless they ask for that.

Before proposing to create a new project, call search_projects with a likely keyword (a company/client name, for example) -- reuse or reference an existing project instead of creating a duplicate when one already covers the same work. Only create a new project once you've checked and found nothing suitable, or the user explicitly asks for a new one.

When you need to tell the user which Ember page to go to for something you can't do yourself (inviting a project member, for example), call get_navigation_guide first and base your answer on what it returns -- don't name a specific page from memory. Getting the wrong page sends the user somewhere unhelpful. This applies just as much when you're recovering from a failed tool call as when you're proactively suggesting where to go -- if a tool call fails for a permissions reason and you need to tell the user where to go instead, call get_navigation_guide before naming a page or button, rather than guessing from memory what the control might be called.

Never describe a project, resource, or workstream as "restricted," "secured," or "isolated" unless you have just called classify_project (or another access/policy tool) successfully this same turn. If access still needs to be configured, say so plainly and name the exact next step and who should do it -- never imply protection has been applied when it hasn't.

Ember works in one of three ways depending on the task: it can do some things itself (Native Workbench, e.g. Wiki synthesis, RAG evaluation), it can define and govern work a practitioner runs in an external tool like Claude Code or ChatGPT and returns artifacts from (External Workstream), or it can investigate and produce an evidence-backed specification/Implementation Handoff for someone else to implement (Document-First Engineering -- the default for refactoring and feature work). Mention whichever applies once you know enough to say.

Always call present_assistant_response exactly once as your last action, after any evidence-gathering, instead of replying with plain text. Put your normal conversational reply in its "message" field. Use the optional fields only when they're genuinely earned:

- links: to point at a real Ember page, add a links entry with a target {kind, id} -- kind is one of wiki_article/project/workstream/assessment/knowledge_source, and id is the article's slug (for wiki_article), the source's id (for knowledge_source), or the record's id (for the others). Never write a URL or hostname directly in your message text -- it will not become a working link, and the chat interface cannot turn model-written links into navigation. If you don't know a real id, don't invent one -- just name the destination in plain text instead.
- citations: only for something you actually retrieved this turn -- a wiki_article via search_wiki/search_project_knowledge (sourceId is that article's slug), or a knowledge_source via search_project_knowledge (sourceId is that result's sourceId). A citation for anything you didn't just retrieve will be silently dropped, so don't bother inventing one.
- documents: only when you actually called attach_workstream_artifact and it succeeded this turn -- artifactId is the real id it returned. Never invent an artifactId or claim something was attached/saved when you haven't just created it with a tool call this turn. The row saving successfully is not the same as the artifact being done -- always report the tool's actual returned status (draft/validation_failed/ready_for_review) in your message, and relay validationNotes verbatim if status is validation_failed. Never say an artifact was "successfully attached" as if that alone means it satisfies what was asked for.
- quickSummary/requirements/nextSteps/suggestedPrompts: use when they add real value; omit them for a simple reply.

Be concise. When you use a tool, briefly say what you did in your final message.`

// Exposes the live system prompt for display (e.g. the Agent Flow page's
// curator/admin-only disclosure) without letting SYSTEM_PROMPT itself be
// imported and role-gating decided elsewhere -- callers just get the text.
export function getSystemPromptText(): string {
  return SYSTEM_PROMPT
}

// Project-Aware Knowledge and Assistant Context, Stage 2. Appended, not
// substituted, so every base instruction (tool-call discipline, citation
// rules, the KB Sandbox capability boundaries) still applies unchanged.
// Encodes the retrieval-precedence requirement directly in the prompt
// (search_project_knowledge's own code-enforced project-first ordering is
// the real guarantee; this just tells the model to actually call it) and
// the "don't silently merge conflicting evidence" requirement.
function buildProjectPromptAddendum(context: { name: string; goal: string | null; objective: string | null }, knowledgeScope: string, webSearchAvailable: boolean): string {
  const base = `\n\nThis conversation is bound to the Ember project "${context.name}"${context.goal ? ` (goal: ${context.goal})` : ''}. Its own knowledge scope: ${knowledgeScope}.

You have an additional tool, search_project_knowledge, that searches this project's own attached knowledge first. Call it before search_wiki when you need evidence -- its results are tagged layer:'project' (this project's own approved evidence -- prefer this, it wins over general platform guidance when the two conflict) or layer:'platform' (general shared knowledge, used only to fill a genuine gap). If project evidence and platform guidance materially conflict, say so explicitly rather than silently merging them. If the project has no relevant attached knowledge for this question, say that plainly instead of presenting platform guidance as if it were project-specific evidence.

Some evidence in this project may be access-restricted to specific people (e.g. customer pricing visible only to Sales/Finance) -- your tools only ever return what you're personally authorized to see, the same as any other user. If the user seems to expect something you can't retrieve, don't guess why or speculate about what might exist. Say plainly that the information isn't available in your current project access scope and suggest they ask the project owner or access steward to review their access -- never name or describe a restricted resource you can't actually see.

You also have list_project_members (no Project ID needed) for questions like who's working on this project, who owns it, or who handles a specific approval responsibility. Always call it fresh -- never guess from earlier in this conversation, and never copy its results into a saved summary. Project role, business function, and approval responsibility are three separate things: don't conflate them, and knowing someone is a member never tells you what evidence they're personally authorized to see.

If the user asks you to send someone a Project Note (e.g. "send Maria a note about X"), first call list_project_members to find the exact person. Then state the exact recipient, subject and body you're about to send in your reply and wait for the user's explicit confirmation in their next message -- only call send_project_note once they've clearly agreed to that exact content, never in the same turn you proposed it.

This project's current description (the short line under its title, separate from its goal) is: ${context.objective ? `"${context.objective}"` : '(none yet)'}. If the user asks you to write, rewrite or change it, show them the exact new description in your reply and wait for their explicit confirmation in their next message -- only then call update_project_description with that exact text, never in the same turn you proposed it. Only the project's owner or curator (or a platform admin) can change it; if the tool refuses, say so plainly.

You also have list_workstreams (no Project ID needed) for this project's existing workstreams with their real ids. Call it before attach_workstream_artifact whenever you need to reference an existing workstream -- a workstream's display name (e.g. "Phase 1 -- Showcase") is never a valid workstreamId, and guessing one will fail.

If the user asks you to sketch, suggest, or "produce" a domain-object ontology for this project (the business's own noun types, e.g. Plane/Route -- not instances), call suggest_project_ontology. Present what it suggests in your own words -- don't just dump the raw tool output -- and wait for the user's explicit confirmation, or their requested changes, in their next message. Only once they've clearly agreed to a specific set of objects and workstreams, call create_project_ontology with exactly that tree (keeping each item's tempId/parentTempId links intact, or adjusted consistently if they asked for changes) -- never in the same turn you proposed it. After it succeeds, tell the user their new project's Ontology Map -- a visual diagram of what you just created -- is on the project page, and give them the ontologyMapUrl the tool returned.

If the user attaches a Turtle ontology file (.ttl/.n3/.nt -- a message containing "Attached file:" with that extension) and wants it on this project's ontology/Ontology Map, call preview_ontology_file_import with that fileName. Never rebuild a Turtle file's tree yourself and never use create_project_ontology for it. Present the preview in your own words: how many objects it would create, a short version of the outline (the top-level groups and a few examples are enough for a long one), anything already on the map (skipped), and what's left out. If canImport is false, say they need the project's owner or curator to run it. Then wait for the user's explicit confirmation in their next message, and only then call import_ontology_file with the same fileName -- it is refused in the same turn as the preview. After it succeeds, give them the ontologyMapUrl. If the file is attached as an artifact too, that's separate: attaching an artifact never changes the Ontology Map.

For an ontology in another format (OWL/RDF-XML, JSON-LD, JSON, YAML, or a CSV/list of classes), map THEIR file yourself instead: its classes/entity types become objects (subclass/parent relationships become parentTempId links; descriptions/comments become the description), and only include workstreams if the file actually describes units of work. Say how many objects you found, show the tree (or a representative part of it if it's large), and point out anything you had to leave out or interpret. Then wait for the user's explicit confirmation, exactly as above, before calling create_project_ontology with that tree.

If the user's message says its attached files were saved as Findings in a workstream, they already exist there as artifacts -- don't attach them again with attach_workstream_artifact unless the user asks for a copy somewhere else. Saved findings can later be submitted to a knowledge base or drafted into a Wiki article from the artifact itself on the workstream page.

Never tell the user the Ontology Map was created or updated unless import_ontology_file or create_project_ontology actually succeeded in this conversation.

You also have search_my_working_knowledge and search_shared_working_knowledge (no Project ID needed) -- Working Knowledge is the current user's own private research notebooks and working notes in this project (plus, for the "shared" tool, notebooks other members have explicitly shared with them), used for continuity across conversations (e.g. "continue my research from yesterday"). It is NOT approved organizational knowledge and must never be presented as such -- always call it out as working/unverified material when you use it, and if it conflicts with search_project_knowledge's approved evidence, disclose the conflict explicitly rather than silently preferring one. A working-knowledge result CAN be cited (sourceType 'working_knowledge', sourceId is that result's id) -- it just renders with a distinct "working" badge, never the approved-evidence one.

When the user wants to keep research or notes for later (most commonly after web research, but also a plain note), call save_working_knowledge rather than attach_workstream_artifact -- it's private to them by default and exactly what Working Knowledge is for. Tell them plainly it's private by default, marked working/unverified, and that they manage sharing or submitting it for curation from the project page -- never claim it's already approved or visible to anyone else.`

  // Only described when actually offered this turn (webSearchAvailable
  // mirrors the same env.tavilyApiKey() check that gates the tool out of
  // the tools array) -- describing a tool the model can't actually call
  // would just teach it to hallucinate the call.
  const webSearchAddendum = webSearchAvailable
    ? `\n\nYou also have search_web, for public web research -- useful for pre-sales or competitive-intelligence questions about a prospective client or competitor that project knowledge and the Wiki can't answer (e.g. "what does this company publicly say about their current infrastructure"). You are allowed at most ${WEB_SEARCH_LIMIT} search_web calls per turn. A web result is NOT project knowledge and NOT a citation -- never cite it via present_assistant_response's citations field, and never tell the user something is "in the knowledge base" or "confirmed" based on a web search alone. If web research turns up something worth keeping, call save_working_knowledge (type 'research_notebook') with your synthesis and the source URLs/titles as its sources -- not attach_workstream_artifact, which isn't private-by-default the way Working Knowledge is. Tell the user it's saved privately, marked working/unverified, and that a curator only sees it if they later choose to submit it.\n\n${WEB_QUERY_RULE} This project's own name, goal and objective count as project-internal: search for the public organizations and topics involved, not for the project itself.`
    : ''

  return base + webSearchAddendum
}

const FEEDBACK_CATEGORY_LABELS: Record<FeedbackType, string> = {
  bug: 'Report a problem',
  improvement: 'Suggest an improvement',
  feature_request: 'Request a new feature',
  usability: 'Usability feedback',
  documentation: 'Documentation issue',
}

const FEEDBACK_CATEGORY_QUESTIONS: Record<FeedbackType, string> = {
  bug: 'What went wrong?',
  improvement: 'What could work better?',
  feature_request: 'What would you like Ember to do?',
  usability: 'What could work better?',
  documentation: 'What went wrong?',
}

// Owner Roadmap and Ember Feedback Board, Phase 1. A full replacement for
// SYSTEM_PROMPT, not an addendum (unlike buildProjectPromptAddendum) --
// feedback intake is a different task register from Workbench navigation,
// not a variant of it. submit_feedback_report is modeled as an ordinary,
// non-terminal tool (like search_project_knowledge), not a second terminal
// path -- the model still finishes every reply, including the confirmation,
// with present_assistant_response.
function buildFeedbackSystemPrompt(feedbackContext: { category: FeedbackType; currentPage: string }): string {
  return `You are Ember, helping an Ember user file feedback with the product team. The user chose "${FEEDBACK_CATEGORY_LABELS[feedbackContext.category]}" and is currently on the page ${feedbackContext.currentPage} -- that page will be attached to the report automatically.

Start by asking: "${FEEDBACK_CATEGORY_QUESTIONS[feedbackContext.category]}" -- unless the user's first message already answered it, in which case don't re-ask.

Reuse anything the user has already told you in this conversation -- never make them repeat themselves. Ask at most ONE follow-up question, and only if a genuinely essential fact is still missing (for a bug, typically what was expected vs. what actually happened). Everything else is optional -- draft your best reasonable version rather than interrogating the user.

Once you have enough for a useful report (at minimum a clear title and description), call submit_feedback_report exactly once. After it succeeds, confirm the report number to the user in your own words as your final reply -- don't just repeat the raw tool output.

You cannot accept or decline the report, promise a timeline, or set its final severity or priority -- a human reviews it. Always call present_assistant_response as your last action for every reply in this conversation, whether you're asking the clarifying question or confirming submission.`
}

// A create_* tool succeeded; the loop stamps provenance on the row it just
// created as a follow-up update -- kept entirely here, not in
// src/lib/workbench/* or src/lib/mcp/tools.ts, so those stay unaware of
// "chat"/"assistant" as a concept and remain reusable by any caller.
async function stampProvenance(
  ctx: WorkbenchCallerContext,
  toolName: string,
  output: unknown,
  conversationId: string
): Promise<void> {
  const stamp = { created_via: 'assistant', assistant_prompt_version: ASSISTANT_PROMPT_VERSION, assistant_conversation_id: conversationId }
  if (toolName === 'create_project' && output && typeof output === 'object' && 'projectId' in output) {
    const projectId = (output as { projectId: string }).projectId
    await ctx.supabase.from('projects').update(stamp).eq('id', projectId)
    // A general (unbound) conversation that just created a project IS now
    // that project's own history, not stray general chat -- bind it so it
    // shows up in the project's own scoped History (listProjectConversations)
    // going forward. Only when currently unbound: conversations.project_id
    // is immutable once set (conversations_project_id_immutable trigger,
    // 20260824190001_conversations_project_binding.sql), by design, so a
    // project created mid-conversation from within an *already* project-
    // bound conversation must never get silently re-pointed to a different
    // project -- the `.is('project_id', null)` filter makes that structurally
    // impossible (the trigger never even fires for a row the WHERE excludes).
    await ctx.supabase.from('conversations').update({ project_id: projectId }).eq('id', conversationId).is('project_id', null)
  } else if (toolName === 'create_workstream' && output && typeof output === 'object' && 'workstreamId' in output) {
    await ctx.supabase.from('project_workstreams').update(stamp).eq('id', (output as { workstreamId: string }).workstreamId)
  } else if (toolName === CREATE_PROJECT_ONTOLOGY_TOOL_NAME && output && typeof output === 'object' && 'workstreamIds' in output) {
    const workstreamIds = (output as { workstreamIds: string[] }).workstreamIds
    // project_objects has no created_via/assistant_* columns at all (it
    // predates that provenance convention and nothing else stamps it
    // either) -- only the workstreams this call created get stamped.
    if (workstreamIds.length > 0) await ctx.supabase.from('project_workstreams').update(stamp).in('id', workstreamIds)
  } else if (toolName === 'attach_workstream_artifact' && output && typeof output === 'object' && 'artifactId' in output) {
    await ctx.supabase.from('workstream_artifacts').update(stamp).eq('id', (output as { artifactId: string }).artifactId)
  }
}

// A Postgrest error -- what supabase-js actually throws/returns for a DB
// failure -- is a plain object shaped like { message, details, hint, code },
// never a real Error instance. Every catch block below used to do
// `err instanceof Error ? err.message : String(err)`, which silently fell
// through to String(err) for a Postgrest error and produced the literal
// text "[object Object]" as the tool result -- observed live 2026-09-04
// when attach_workstream_artifact got an invalid-UUID workstreamId and its
// resulting Postgrest error rendered this way instead of the real "invalid
// input syntax for type uuid" message. Extracts .message from anything that
// has one (a real Error, a Postgrest error, a Zod-ish error), falling back
// to String(err) only for a genuinely message-less throw.
function toolErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message
  }
  return String(err)
}

// Raised from 5 (M6D's original value) after live testing under M7's
// requirement-resolution reasoning: a small model legitimately wanting two
// search_wiki calls plus its final reply was exhausting 5 iterations before
// producing any text, even for well-scoped requests. 8 leaves real headroom
// without masking a genuinely runaway tool loop.
export const MAX_TOOL_ITERATIONS = 8

// Backstop for the prompt's own "search no more than twice" instruction --
// hoisted to module scope (not just local to runAssistantTurn) so it can be
// exported and displayed as a real guardrail value on the Agent Flow page,
// instead of being restated there as a second hard-coded literal.
export const SEARCH_WIKI_LIMIT = 2

// Tavily is a metered/paid external API (unlike search_wiki/search_project_
// knowledge, both free internal RPCs) -- capped lower than SEARCH_WIKI_LIMIT
// to bound per-turn cost while still allowing one query plus one refinement
// (e.g. broaden after an empty/irrelevant first result).
export const WEB_SEARCH_LIMIT = 2

export interface ModelSelection {
  providerName: string
  modelId: string
}

export interface AssistantTurnResult {
  conversationId: string
  reply: string
  providerName: string
  providerDisplayName: string
  modelId: string
  modelDisplayName: string
  toolsUsed: string[]
  // Every query this turn actually sent to Tavily (search_web), in order --
  // shown under the reply as "Searched the web for: ..." so the user sees
  // exactly what left Ember for an external service. Includes a search that
  // failed after the request went out; excludes refused calls (over the
  // per-turn limit, not project-bound) and invalid input, which sent nothing.
  webSearchQueries: string[]
  embeddingModelDisplayName?: string
  structured: VerifiedAssistantEnvelope | null
  createdRecords: ResolvedCreatedRecord[]
  // Gated (write-risk) Agent Gateway tool calls proposed this turn but not
  // yet confirmed -- rendered as an interactive confirm/cancel card, not a
  // simple navigational chip, so kept separate from createdRecords. See
  // src/lib/mcp-gateway/execute.ts.
  pendingGatewayInvocations: PendingGatewayInvocation[]
  // Set when `reply` is a friendly stand-in for a failed provider call
  // (rate limit, capacity, auth, ...) rather than a real assistant answer --
  // see the generateChat catch below. A normal AssistantTurnResult (not a
  // thrown error) so it can never surface as an uncaught Server Action
  // exception, which production Next.js redacts to an opaque digest-only
  // error (observed live: a Groq TPM/413 error reached the user as "Minified
  // React error #441" instead of an actionable message). ChatPanel routes
  // this the same way it already routes a thrown error -- red text plus a
  // one-click Retry of the same message -- rather than as a normal reply.
  isProviderError?: boolean
  // Same non-throwing shape as isProviderError above, for the Information
  // Sensitivity Classification policy check (src/lib/ai/sensitivity.ts) --
  // the selected model isn't eligible to process what was retrieved this
  // turn. ChatPanel routes this exactly like isProviderError.
  isSensitivityBlock?: boolean
  // Same non-throwing shape again, for anything else that throws inside the
  // turn (a DB write failure, an unexpected exception from a tool handler
  // not already caught per-call, ...) -- found live during the OrderLunch
  // builder-journey test (OL-008): a long corrective response triggered an
  // uncaught exception that reached the client as an opaque "Minified React
  // error #441" with no way to tell whether the turn's side effects had
  // completed. The outer catch below turns any such throw into this instead.
  isInternalError?: boolean
}

// Short, safe, user-facing text per failure category -- never the raw SDK
// error (which can include org/account identifiers, billing-tier upsell
// copy, etc.). classifyProviderError only reads `.status`/`.message`, so it
// works the same whether `err` is a real AIProviderError or an unrelated
// thrown value.
function friendlyProviderErrorMessage(err: unknown): string {
  const provider = err instanceof AIProviderError ? err.provider : undefined
  const providerLabel = provider ? ` with ${provider}` : ''
  const code = classifyProviderError(err instanceof AIProviderError ? (err.cause ?? err) : err)
  switch (code) {
    case 'rate_limit':
    case 'quota_exceeded':
      return `Ember hit a capacity limit${providerLabel} for this response. Try again in a moment, or switch to a different model using the dropdown above.`
    case 'model_unavailable':
      return "The selected model isn't available right now. Try a different model using the dropdown above."
    case 'authentication':
      return `Ember couldn't authenticate${providerLabel} right now. Please try again shortly, or let an administrator know if this continues.`
    case 'invalid_request':
      return `Ember couldn't process that request${providerLabel}. Try rephrasing, or switch to a different model using the dropdown above.`
    default:
      return `Ember couldn't get a response${providerLabel} right now. Try again, or switch to a different model using the dropdown above.`
  }
}

// projectId is only consulted when starting a brand-new conversation
// (conversationId null) -- once a conversation exists, its own row's
// project_id is what's used, never re-trusted from the caller, matching the
// "never trust a model-supplied project_id" principle extended to the HTTP
// boundary too. A conversation is either general forever or bound to one
// project forever (see the immutability trigger in
// 20260824190001_conversations_project_binding.sql) -- "switching projects"
// means starting a new conversation, not passing a different projectId here
// for an existing one.
export async function runAssistantTurn(
  ctx: WorkbenchCallerContext,
  conversationId: string | null,
  userMessage: string,
  modelSelection?: ModelSelection,
  projectId?: string | null,
  feedbackContext?: { category: FeedbackType; currentPage: string }
): Promise<AssistantTurnResult> {
  let conversation: Conversation
  if (conversationId) {
    const { data, error } = await ctx.supabase.from('conversations').select('*').eq('id', conversationId).single()
    if (error || !data) throw error ?? new Error('Conversation not found')
    conversation = data
  } else {
    conversation = await createConversation(
      ctx.supabase,
      ctx.user.id,
      userMessage.slice(0, 80),
      projectId ?? null,
      feedbackContext ? 'feedback' : 'chat'
    )
  }
  const resolvedProjectId = conversation.project_id

  // Durable "turn in progress" marker so a page refresh mid-turn doesn't
  // strand the client with no way to discover a pending/completed reply --
  // cleared in the finally below regardless of how the turn ends.
  await ctx.supabase.from('conversations').update({ pending_turn_started_at: new Date().toISOString() }).eq('id', conversation.id)

  const priorRows = conversationId ? await listMessages(ctx.supabase, conversationId) : []
  const history: ChatMessage[] = priorRows.map((r) => ({
    role: r.role,
    content: r.content ?? '',
    toolCalls: r.tool_calls ?? undefined,
    toolCallId: r.tool_call_id ?? undefined,
    toolName: r.tool_name ?? undefined,
  }))
  // A brand-new conversation can't have a summary yet -- only fetched when
  // continuing an existing one, same conditioning as priorRows above.
  const existingSummary = conversationId ? await getConversationSummary(ctx.supabase, conversationId) : null

  history.push({ role: 'user', content: userMessage })
  await appendMessage(ctx.supabase, { conversationId: conversation.id, userId: ctx.user.id, role: 'user', content: userMessage })

  // Builder AI Usage Metering + BYOLLM (src/lib/ai/metering.ts,
  // src/lib/workbench/builder-llm-credentials.ts): only ever applies to a
  // builder's own conversation on their own builder_lab Project, in a
  // Builder-mode deployment -- an Enterprise conversation, or a builder's
  // conversation on any other Project, is never metered or substituted.
  const isBuilderOwnProject =
    env.productMode() === 'builder' && resolvedProjectId ? await isOwnBuilderLabProject(ctx, resolvedProjectId) : false
  // A Live client Project may use only Sandz-hosted AI (src/lib/ai/
  // hosting-policy.ts): no BYOLLM, and the chat model switches to a
  // Sandz-hosted one if the selection or default isn't.
  const selfHostedOnly = resolvedProjectId ? (await aiHostingForProject(resolvedProjectId)) === 'self_hosted_only' : false
  const byoLlm = isBuilderOwnProject && !selfHostedOnly ? await resolveBuilderLlmProvider(ctx.user.id) : null

  let chatProvider: ChatProviderInfo
  // null for a BYOLLM turn -- there's no ai_providers row for a builder's
  // own credential, so the sensitivity/eligibility check below is skipped
  // entirely rather than looked up against a row that doesn't exist.
  let chatProviderId: string | null = null

  if (byoLlm) {
    // A BYOLLM call costs the platform nothing -- logged for observability
    // (isByoLlm: true) but never wrapped in withAllowanceGate, and
    // logging.ts skips cost computation for it entirely.
    chatProvider = {
      provider: withLogging(byoLlm.provider, { requestedBy: ctx.user.id, projectId: resolvedProjectId ?? undefined, isByoLlm: true }),
      providerName: byoLlm.provider.name,
      providerDisplayName: 'Your own LLM',
      modelId: byoLlm.modelId,
      modelDisplayName: byoLlm.modelId,
      maxOutputTokens: null,
      contextWindow: null,
    }
  } else {
    try {
      chatProvider = await resolveChatProvider(
        ctx.supabase,
        modelSelection,
        { requestedBy: ctx.user.id, projectId: resolvedProjectId ?? undefined },
        { selfHostedOnly }
      )
    } catch (err) {
      if (!(err instanceof SelfHostedAIUnavailableError)) throw err
      // Same non-throwing, retryable shape as a provider failure (see
      // isProviderError below): the user sees why, nothing reaches a model.
      await ctx.supabase.from('conversations').update({ pending_turn_started_at: null }).eq('id', conversation.id)
      return {
        conversationId: conversation.id,
        reply: err.message,
        providerName: '',
        providerDisplayName: '',
        modelId: '',
        modelDisplayName: '',
        toolsUsed: [],
        structured: null,
        createdRecords: [],
        pendingGatewayInvocations: [],
        isProviderError: true,
      }
    }
    // ChatProviderInfo.provider is the built client (has .generateChat(), not
    // .id) -- the eligibility check needs the ai_providers row id, resolved
    // once per turn since chatProvider.providerName is fixed for the turn.
    const { data: chatProviderRow, error: chatProviderRowError } = await ctx.supabase
      .from('ai_providers')
      .select('id')
      .eq('name', chatProvider.providerName)
      .single()
    if (chatProviderRowError || !chatProviderRow) throw chatProviderRowError ?? new Error(`Provider row not found: ${chatProvider.providerName}`)
    chatProviderId = chatProviderRow.id

    if (isBuilderOwnProject) {
      const builderId = ctx.user.id
      const admin = createAdminClient()
      chatProvider = {
        ...chatProvider,
        provider: withAllowanceGate(() => getBuilderSpendSummary(admin, builderId), chatProvider.provider),
      }
    }
  }

  const projectContext = resolvedProjectId ? await getProjectContext(ctx, resolvedProjectId) : null
  // Gateway tools are always Project-scoped (builder_integration_project_
  // availability has no concept of a non-Project-bound grant) -- discovered
  // once per turn here, alongside the fixed tool list, not re-discovered
  // per tool call inside the iteration loop below.
  const gatewayDiscovery = resolvedProjectId
    ? await listAvailableTools(ctx.supabase, resolvedProjectId, { userId: ctx.user.id, platformRole: ctx.profile.role })
    : { toolSpecs: [], contextByToolName: new Map() }
  // search_web only exists when Tavily is actually configured -- omitted
  // from the tools array entirely rather than offered-but-erroring, same
  // "only offer what's actually usable" principle as resolveChatProvider
  // only offering providers with a configured key. Computed before
  // systemPrompt so the addendum's own text can match what's actually
  // offered this turn -- describing a tool that isn't in the tools array
  // would just teach the model to hallucinate calling it.
  const webSearchAvailable = Boolean(env.tavilyApiKey())
  const webSearchTools = webSearchAvailable ? [SEARCH_WEB_TOOL] : []
  const systemPrompt = feedbackContext
    ? buildFeedbackSystemPrompt(feedbackContext)
    : projectContext
      ? SYSTEM_PROMPT + buildProjectPromptAddendum(projectContext, describeProjectKnowledgeScope(projectContext), webSearchAvailable)
      : SYSTEM_PROMPT
  const tools = feedbackContext
    ? [PRESENT_RESPONSE_TOOL, SUBMIT_FEEDBACK_REPORT_TOOL]
    : projectContext
      ? [
          ...getToolSpecs(),
          SEARCH_PROJECT_KNOWLEDGE_TOOL,
          LIST_PROJECT_MEMBERS_TOOL,
          SEND_PROJECT_NOTE_TOOL,
          UPDATE_PROJECT_DESCRIPTION_TOOL,
          LIST_WORKSTREAMS_TOOL,
          SUGGEST_PROJECT_ONTOLOGY_TOOL,
          CREATE_PROJECT_ONTOLOGY_TOOL,
          PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL,
          IMPORT_ONTOLOGY_FILE_TOOL,
          SEARCH_MY_WORKING_KNOWLEDGE_TOOL,
          SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL,
          SAVE_WORKING_KNOWLEDGE_TOOL,
          ...webSearchTools,
          ...gatewayDiscovery.toolSpecs,
          PRESENT_RESPONSE_TOOL,
        ]
      : [...getToolSpecs(), PRESENT_RESPONSE_TOOL]
  const toolsUsed = new Set<string>()
  const webSearchQueries: string[] = []
  try {
  // A model that ignores the prompt's "search no more than twice" instruction
  // (observed live: GPT-OSS 120B repeatedly re-searching when search_wiki
  // wasn't returning content) would otherwise just keep searching until
  // MAX_TOOL_ITERATIONS kills the whole turn. Once SEARCH_WIKI_LIMIT is hit,
  // the tool call is refused with an explanatory result instead of actually
  // running -- the model gets a clear signal to stop searching and answer,
  // rather than a silent no-op.
  let searchWikiCalls = 0
  let webSearchCalls = 0
  // Recomputed each iteration -- cheap (pure, in-memory) and the current
  // turn keeps growing as tool round-trips are appended to `history`.
  // Sticky across iterations: once truncation has happened once this turn,
  // treat the turn as truncated for the summary-refresh decision below even
  // if a later iteration's smaller working set wouldn't trip it again.
  let contextWasTruncated = false
  // This turn's real retrieval/creation provenance, accumulated across
  // iterations -- citations are checked against these (never against what
  // the model merely asserts), and createdRecordRefs feeds the Artifacts
  // panel's "Created records" group. Stage 3: keyed maps, not bare sets, so
  // a verified citation can also carry which knowledge layer it came from
  // and (for a knowledge_source) which specific document version was
  // actually retrieved -- search_wiki hits are always layer:'platform'
  // (it's the general tool, never project-tagged) with no version concept.
  const retrievedWikiArticleSlugs = new Map<string, RetrievedHitInfo>()
  const retrievedKnowledgeSourceIds = new Map<string, RetrievedHitInfo>()
  const retrievedWorkingKnowledgeIds = new Map<string, RetrievedWorkingKnowledgeHitInfo>()
  const createdRecordRefs: CreatedRecordRef[] = []
  const pendingGatewayInvocations: PendingGatewayInvocation[] = []

  // Shared tail for every terminal path below: resolves the embedding model
  // display name, refreshes the conversation summary, and shapes the
  // return value. Never persists anything itself -- each caller appends its
  // own row first, since the content/response_payload differ per path.
  async function finishTurn(reply: string, structured: VerifiedAssistantEnvelope | null): Promise<AssistantTurnResult> {
    const usedEmbeddingRetrieval = toolsUsed.has('search_wiki') || toolsUsed.has(SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME)
    const embeddingModelDisplayName = usedEmbeddingRetrieval ? (await getDefaultModel(ctx.supabase, 'embedding')).model.display_name : undefined
    await maybeRefreshSummary(ctx, conversation.id, contextWasTruncated, projectContext ? projectContext.informationSensitivity : undefined, selfHostedOnly)
    const resolvedCreatedRecords = (await Promise.all(createdRecordRefs.map((ref) => resolveCreatedRecord(ctx, ref)))).filter(
      (r): r is ResolvedCreatedRecord => r !== null
    )
    return {
      conversationId: conversation.id,
      reply,
      providerName: chatProvider.providerName,
      providerDisplayName: chatProvider.providerDisplayName,
      modelId: chatProvider.modelId,
      modelDisplayName: chatProvider.modelDisplayName,
      toolsUsed: [...toolsUsed],
      webSearchQueries: [...webSearchQueries],
      embeddingModelDisplayName,
      structured,
      createdRecords: resolvedCreatedRecords,
      pendingGatewayInvocations,
    }
  }

  // The model's one required terminal action. A malformed/missing envelope
  // must never fail the turn -- fall back to whatever plain text is
  // recoverable and persist no structured payload at all.
  async function finalizeStructuredTurn(presentCall: { arguments: Record<string, unknown> }, rawContent: string): Promise<AssistantTurnResult> {
    const parsed = AssistantResponseEnvelopeSchema.safeParse(presentCall.arguments)

    if (!parsed.success) {
      const recoveredMessage = typeof presentCall.arguments?.message === 'string' ? presentCall.arguments.message.trim() : ''
      const content =
        rawContent.trim() ||
        recoveredMessage ||
        "I put together a response but it didn't come through correctly -- could you ask again?"
      await appendMessage(ctx.supabase, {
        conversationId: conversation.id,
        userId: ctx.user.id,
        role: 'assistant',
        content,
        provider: chatProvider.providerName,
        model: chatProvider.modelId,
        responsePayload: null,
      })
      return finishTurn(content, null)
    }

    const retrieved: RetrievedProvenance = {
      wikiArticleSlugs: retrievedWikiArticleSlugs,
      knowledgeSourceIds: retrievedKnowledgeSourceIds,
      workingKnowledgeIds: retrievedWorkingKnowledgeIds,
    }
    const persisted = await buildPersistedEnvelope(ctx, parsed.data, retrieved)
    await appendMessage(ctx.supabase, {
      conversationId: conversation.id,
      userId: ctx.user.id,
      role: 'assistant',
      content: persisted.message,
      provider: chatProvider.providerName,
      model: chatProvider.modelId,
      responsePayload: persisted,
    })
    const structured = await resolveEnvelopeForDisplay(ctx, persisted)
    return finishTurn(persisted.message, structured)
  }

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration++) {
    const working = composeWorkingContext({
      history,
      summary: existingSummary,
      contextWindow: chatProvider.contextWindow,
      maxOutputTokens: chatProvider.maxOutputTokens,
    })
    contextWasTruncated = contextWasTruncated || working.wasTruncated
    let result: Awaited<ReturnType<typeof chatProvider.provider.generateChat>>
    try {
      // Information Sensitivity Classification check -- runs every
      // iteration, right before the content actually reaches the model
      // ("the policy decision can happen before the model ever sees the
      // prompt"). Cheap on iteration 0 of a non-project conversation (no
      // resources retrieved yet, no project bound -> getEffectiveSensitivity
      // returns 'public' with no DB query at all); becomes meaningful once
      // search_wiki/search_project_knowledge have retrieved something, OR
      // immediately (iteration 0) for a project-bound conversation, since
      // the project's own name/goal is already in the system prompt via
      // buildProjectPromptAddendum before any tool ever runs.
      // Skipped entirely for a BYOLLM turn (chatProviderId is null) -- there
      // is no ai_providers row for a builder's own credential to check
      // against, and the platform's information-sensitivity policy is about
      // which PLATFORM providers may see what, not a builder's own private
      // workspace content.
      if (chatProviderId) {
        const sensitivity = await getEffectiveSensitivity(ctx.supabase, {
          wikiArticleSlugs: [...retrievedWikiArticleSlugs.keys()],
          knowledgeSourceIds: [...retrievedKnowledgeSourceIds.keys()],
          projectSensitivity: projectContext ? projectContext.informationSensitivity : undefined,
        })
        await assertProviderEligible(ctx.supabase, chatProviderId, sensitivity)
      }

      result = await chatProvider.provider.generateChat({
        messages: working.messages,
        system: systemPrompt,
        tools,
        maxOutputTokens: chatProvider.maxOutputTokens ?? undefined,
      })
    } catch (err) {
      if (err instanceof AISensitivityError) {
        // Same non-throwing-result shape as the AIProviderError catch below
        // -- nothing persisted to chat_messages for this turn, so a blocked
        // attempt never becomes part of the model's own context on retry.
        return {
          conversationId: conversation.id,
          reply: err.message,
          providerName: chatProvider.providerName,
          providerDisplayName: chatProvider.providerDisplayName,
          modelId: chatProvider.modelId,
          modelDisplayName: chatProvider.modelDisplayName,
          toolsUsed: [...toolsUsed],
          webSearchQueries: [...webSearchQueries],
          structured: null,
          createdRecords: [],
          pendingGatewayInvocations: [],
          isSensitivityBlock: true,
        }
      }
      if (err instanceof BuilderAllowanceError) {
        // Same non-throwing-result shape as the AIProviderError catch below,
        // but the reply is the gate's own clear message directly, not run
        // through friendlyProviderErrorMessage's generic classifier (which
        // has no case for this and would otherwise show a vague "try again"
        // message, losing the actionable "ask for more credit or configure
        // your own LLM" guidance).
        return {
          conversationId: conversation.id,
          reply: err.message,
          providerName: chatProvider.providerName,
          providerDisplayName: chatProvider.providerDisplayName,
          modelId: chatProvider.modelId,
          modelDisplayName: chatProvider.modelDisplayName,
          toolsUsed: [...toolsUsed],
          webSearchQueries: [...webSearchQueries],
          structured: null,
          createdRecords: [],
          pendingGatewayInvocations: [],
          isProviderError: true,
        }
      }
      // A provider failure (rate limit, capacity, auth, ...) here must
      // resolve normally rather than throw -- an uncaught exception crossing
      // the sendChatMessageAction Server Action boundary reaches production
      // Next.js's opaque digest-only error path (seen live as "Minified
      // React error #441" for a Groq TPM/413 error), not a readable message.
      // Nothing is persisted to chat_messages for this turn -- a failed
      // attempt shouldn't become part of the model's own context on retry.
      return {
        conversationId: conversation.id,
        reply: friendlyProviderErrorMessage(err),
        providerName: chatProvider.providerName,
        providerDisplayName: chatProvider.providerDisplayName,
        modelId: chatProvider.modelId,
        modelDisplayName: chatProvider.modelDisplayName,
        toolsUsed: [...toolsUsed],
        webSearchQueries: [...webSearchQueries],
        structured: null,
        createdRecords: [],
        pendingGatewayInvocations: [],
        isProviderError: true,
      }
    }
    history.push(result.message)

    // Submitting the final structured response is always terminal. If the
    // model also requested other tools in the same batch -- it shouldn't,
    // per the prompt, but providers occasionally do this -- those other
    // calls are dropped, not executed: a model submitting a final answer
    // hasn't asked to keep gathering evidence, and executing them would
    // leave tool-result messages with nothing to respond to.
    const presentCall = result.message.toolCalls?.find((tc) => tc.name === PRESENT_RESPONSE_TOOL_NAME)
    if (presentCall) {
      return await finalizeStructuredTurn(presentCall, result.message.content)
    }

    const hasToolCalls = Boolean(result.message.toolCalls && result.message.toolCalls.length > 0)
    // A row with tool calls but no content is a normal intermediate step
    // (the model is about to see tool results, not replying yet) -- but a
    // *terminal* row (no tool calls) with empty/null content is a real
    // provider failure mode (observed live: search_project_knowledge's
    // large tool-result payload occasionally produced a genuinely empty
    // completion), and previously flowed all the way to the client as a
    // literal `content: null` message, crashing the renderer instead of
    // showing a recoverable error. Coerced here, once, so both the
    // persisted row and the returned reply agree.
    const messageContent = hasToolCalls
      ? result.message.content || null
      : result.message.content?.trim() || "I wasn't able to generate a reply to that -- could you try rephrasing, or asking again?"

    await appendMessage(ctx.supabase, {
      conversationId: conversation.id,
      userId: ctx.user.id,
      role: 'assistant',
      content: messageContent,
      toolCalls: result.message.toolCalls ?? null,
      provider: chatProvider.providerName,
      model: chatProvider.modelId,
    })

    if (!hasToolCalls) {
      // A provider that never calls present_assistant_response (weak
      // tool-calling support, or it judged no tool needed and replied
      // directly) still gets a normal, working reply -- just without a
      // structured payload.
      return await finishTurn(messageContent as string, null)
    }

    for (const toolCall of result.message.toolCalls ?? []) {
      toolsUsed.add(toolCall.name)
      let toolResultText: string
      // This call's own contribution to retrievedWikiArticleSlugs/
      // retrievedKnowledgeSourceIds below -- persisted onto this row via
      // appendMessage's retrievedResources so summary.ts (which never sees
      // this turn's in-memory maps) can rebuild the full retrieval manifest
      // from chat_messages alone. See 20260829130001_chat_message_retrieved_resources.sql.
      const newlyRetrieved: { resourceType: 'wiki_article' | 'knowledge_source'; resourceId: string }[] = []
      if (toolCall.name === 'search_wiki' && ++searchWikiCalls > SEARCH_WIKI_LIMIT) {
        toolResultText = JSON.stringify({
          error: `search_wiki has already been called ${SEARCH_WIKI_LIMIT} times this turn. Do not search again -- answer using what you already found, or ask the user a clarifying question instead.`,
        })
      } else if (toolCall.name === SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- intercepted here
        // before reaching callTool, same as PRESENT_RESPONSE_TOOL, because
        // its behavior depends on resolvedProjectId, which callTool's
        // generic (ctx, name, input) dispatch has no way to carry.
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'search_project_knowledge is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runSearchProjectKnowledge(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
            for (const hit of output.results as ProjectKnowledgeHit[]) {
              const info: RetrievedHitInfo = { layer: hit.layer, documentVersionId: hit.documentVersionId }
              if (hit.sourceType === 'wiki_article') retrievedWikiArticleSlugs.set(hit.sourceId, info)
              else retrievedKnowledgeSourceIds.set(hit.sourceId, info)
              newlyRetrieved.push({ resourceType: hit.sourceType, resourceId: hit.sourceId })
            }
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === LIST_PROJECT_MEMBERS_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- same
        // interception pattern as search_project_knowledge, because this
        // tool's behavior depends on resolvedProjectId (never model-supplied).
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'list_project_members is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runListProjectMembers(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === LIST_WORKSTREAMS_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- same
        // interception pattern as list_project_members. Closes the gap that
        // let the model hallucinate a workstreamId from a display name
        // (e.g. "Phase 1 -- Showcase") when calling attach_workstream_artifact
        // -- give it a way to look up the real id instead of guessing one.
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'list_workstreams is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runListWorkstreams(ctx, resolvedProjectId)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SUGGEST_PROJECT_ONTOLOGY_TOOL_NAME) {
        // Read-only -- nothing written until create_project_ontology is
        // separately called and confirmed (see that tool's own comment).
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'suggest_project_ontology is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runSuggestProjectOntology(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === CREATE_PROJECT_ONTOLOGY_TOOL_NAME) {
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'create_project_ontology is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runCreateProjectOntology(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
            // This tool is intercepted here, before the generic callTool
            // dispatch (the only place stampProvenance is otherwise called
            // from, line ~962 below) -- call it explicitly so the created
            // workstreams get the same created_via='assistant' provenance
            // create_workstream's own single-id case gets.
            await stampProvenance(ctx, CREATE_PROJECT_ONTOLOGY_TOOL_NAME, output, conversation.id)
            // Each created workstream gets its own real page (project_objects
            // don't -- see ontology-map.ts's own header comment, nothing
            // renders them individually yet), so only workstreams surface in
            // the Artifacts panel's "Created records" group, same as
            // create_workstream's own single-id case below.
            for (const workstreamId of output.workstreamIds) {
              createdRecordRefs.push({ kind: 'workstream', id: workstreamId })
            }
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME || toolCall.name === IMPORT_ONTOLOGY_FILE_TOOL_NAME) {
        // Same interception reason as the ontology pair above, plus both
        // read the attached file back from this conversation's messages.
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: `${toolCall.name} is only available in a project-bound conversation.` })
        } else {
          try {
            const output =
              toolCall.name === PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME
                ? await runPreviewOntologyFileImport(ctx, resolvedProjectId, conversation.id, toolCall.arguments)
                : await runImportOntologyFile(ctx, resolvedProjectId, conversation.id, toolCall.arguments)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SEARCH_MY_WORKING_KNOWLEDGE_TOOL_NAME || toolCall.name === SEARCH_SHARED_WORKING_KNOWLEDGE_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- same
        // interception pattern as search_project_knowledge. Working
        // Knowledge retrieval is deliberately NOT pushed into
        // newlyRetrieved/retrieved_resources (unlike wiki/knowledge_source
        // hits) -- that array feeds getEffectiveSensitivity's classification
        // manifest, and working_knowledge_items has no resource_access_
        // policies row concept at all (not part of that system this
        // increment). retrievedWorkingKnowledgeIds below is the complete,
        // correct provenance record for THIS turn's own citation
        // verification, which is all that's needed.
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: `${toolCall.name} is only available in a project-bound conversation.` })
        } else {
          try {
            const output =
              toolCall.name === SEARCH_MY_WORKING_KNOWLEDGE_TOOL_NAME
                ? await runSearchMyWorkingKnowledge(ctx, resolvedProjectId, toolCall.arguments)
                : await runSearchSharedWorkingKnowledge(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
            for (const hit of output.results as WorkingKnowledgeHit[]) {
              retrievedWorkingKnowledgeIds.set(hit.id, {
                itemType: hit.type,
                visibility: hit.visibility as 'private' | 'shared_selected' | 'shared_project',
              })
            }
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SAVE_WORKING_KNOWLEDGE_TOOL_NAME) {
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'save_working_knowledge is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runSaveWorkingKnowledge(ctx, resolvedProjectId, conversation.id, toolCall.arguments, {
              providerName: chatProvider.providerName,
              modelId: chatProvider.modelId,
            })
            toolResultText = JSON.stringify(output)
            createdRecordRefs.push({ kind: 'working_knowledge', id: output.itemId })
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SEND_PROJECT_NOTE_TOOL_NAME) {
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'send_project_note is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runSendProjectNote(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
            // Same "auto-tracked, not dependent on the model remembering to
            // add a links entry" convention as create_project/create_workstream
            // below -- the Artifacts panel's "Created records" group is how
            // the structured link back to the note actually surfaces.
            createdRecordRefs.push({ kind: 'project_note', id: output.noteId })
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === UPDATE_PROJECT_DESCRIPTION_TOOL_NAME) {
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'update_project_description is only available in a project-bound conversation.' })
        } else {
          try {
            const output = await runUpdateProjectDescription(ctx, resolvedProjectId, toolCall.arguments)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SEARCH_WEB_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- same
        // interception pattern as search_project_knowledge, both because
        // it's only offered in a project-bound conversation and because it
        // needs its own per-turn call cap (Tavily is a metered/paid API,
        // unlike search_wiki's free internal RPC).
        if (!resolvedProjectId) {
          toolResultText = JSON.stringify({ error: 'search_web is only available in a project-bound conversation.' })
        } else if (++webSearchCalls > WEB_SEARCH_LIMIT) {
          toolResultText = JSON.stringify({
            error: `search_web has already been called ${WEB_SEARCH_LIMIT} times this turn. Do not search again -- work with what you already found, or ask the user to narrow the request.`,
          })
        } else {
          try {
            const output = await runSearchWeb(toolCall.arguments)
            webSearchQueries.push(output.query)
            toolResultText = JSON.stringify(output)
          } catch (err) {
            // A failure after the request went out still sent the query to
            // Tavily -- record it (and persist it in the tool result, which
            // conversations.ts reads back) so the user sees it either way.
            if (err instanceof WebSearchRequestError) {
              webSearchQueries.push(err.query)
              toolResultText = JSON.stringify({ query: err.query, error: toolErrorMessage(err) })
            } else {
              toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
            }
          }
        }
      } else if (toolCall.name.startsWith(GATEWAY_TOOL_PREFIX)) {
        // Agent Gateway, Milestone 1 -- a registered Builder Integration's
        // MCP tool, discovered once above (gatewayDiscovery) and dispatched
        // here rather than through the generic callTool(ctx, name, input)
        // registry, since it needs resolvedProjectId/conversation.id that
        // callTool's signature can't carry (same reason every other branch
        // in this switch is intercepted here instead of living in
        // src/lib/mcp/tools.ts).
        const gwContext = resolvedProjectId ? gatewayDiscovery.contextByToolName.get(toolCall.name) : undefined
        if (!gwContext) {
          toolResultText = JSON.stringify({ error: 'This integration is not available in this conversation.' })
        } else {
          try {
            const outcome = await runGatewayToolCall(ctx, {
              projectId: resolvedProjectId as string,
              conversationId: conversation.id,
              toolContext: gwContext,
              input: toolCall.arguments,
            })
            toolResultText = JSON.stringify(outcome.resultForModel)
            if (outcome.pending) pendingGatewayInvocations.push(outcome.pending)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else if (toolCall.name === SUBMIT_FEEDBACK_REPORT_TOOL_NAME) {
        // Not in src/lib/mcp/tools.ts's general registry -- same
        // interception pattern as search_project_knowledge, because its
        // behavior depends on feedbackContext, which callTool's generic
        // (ctx, name, input) dispatch has no way to carry.
        if (!feedbackContext) {
          toolResultText = JSON.stringify({ error: 'submit_feedback_report is only available in a feedback-intake conversation.' })
        } else {
          try {
            const output = await runSubmitFeedbackReport(
              ctx,
              { category: feedbackContext.category, currentPage: feedbackContext.currentPage, conversationId: conversation.id },
              toolCall.arguments
            )
            toolResultText = JSON.stringify(output)
          } catch (err) {
            toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
          }
        }
      } else {
        try {
          // create_workstream takes a model-supplied projectId (it's in the
          // general registry, reused outside chat too, so it can't be
          // server-resolved-only the way search_project_knowledge etc. are).
          // Live-observed 2026-09-04: nothing ever told the model the
          // current project's real UUID, so it guessed a slug derived from
          // the project's name and the call failed against the real column.
          // In a project-bound conversation there is exactly one correct
          // project for this call regardless of what the model passed --
          // force it, same "never trust a model-supplied id when a server-
          // resolved one exists" principle every other tool in this file
          // already follows.
          const toolArguments =
            toolCall.name === 'create_workstream' && resolvedProjectId
              ? { ...toolCall.arguments, projectId: resolvedProjectId }
              : toolCall.arguments
          const output = await callTool(ctx, toolCall.name, toolArguments)
          await stampProvenance(ctx, toolCall.name, output, conversation.id)
          toolResultText = JSON.stringify(output)

          if (toolCall.name === 'search_wiki' && output && typeof output === 'object' && 'articles' in output) {
            for (const article of (output as { articles: { slug: string }[] }).articles) {
              retrievedWikiArticleSlugs.set(article.slug, { layer: 'platform', documentVersionId: null })
              newlyRetrieved.push({ resourceType: 'wiki_article', resourceId: article.slug })
            }
          } else if (toolCall.name === 'create_project' && output && typeof output === 'object' && 'projectId' in output) {
            createdRecordRefs.push({ kind: 'project', id: (output as { projectId: string }).projectId })
          } else if (toolCall.name === 'create_workstream' && output && typeof output === 'object' && 'workstreamId' in output) {
            createdRecordRefs.push({ kind: 'workstream', id: (output as { workstreamId: string }).workstreamId })
          } else if (toolCall.name === 'attach_workstream_artifact' && output && typeof output === 'object' && 'artifactId' in output) {
            createdRecordRefs.push({ kind: 'workstream_artifact', id: (output as { artifactId: string }).artifactId })
          }
        } catch (err) {
          toolResultText = JSON.stringify({ error: toolErrorMessage(err) })
        }
      }

      const toolMessage: ChatMessage = { role: 'tool', content: toolResultText, toolCallId: toolCall.id, toolName: toolCall.name }
      history.push(toolMessage)
      await appendMessage(ctx.supabase, {
        conversationId: conversation.id,
        userId: ctx.user.id,
        role: 'tool',
        content: toolResultText,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        retrievedResources: newlyRetrieved.length ? newlyRetrieved : null,
      })
    }
  }

  const fallback = "I wasn't able to finish that within the allotted number of steps -- could you try rephrasing or breaking it into a smaller request?"
  await appendMessage(ctx.supabase, {
    conversationId: conversation.id,
    userId: ctx.user.id,
    role: 'assistant',
    content: fallback,
    provider: chatProvider.providerName,
    model: chatProvider.modelId,
  })
  return {
    conversationId: conversation.id,
    reply: fallback,
    providerName: chatProvider.providerName,
    providerDisplayName: chatProvider.providerDisplayName,
    modelId: chatProvider.modelId,
    modelDisplayName: chatProvider.modelDisplayName,
    toolsUsed: [...toolsUsed],
    webSearchQueries: [...webSearchQueries],
    structured: null,
    createdRecords: [],
    pendingGatewayInvocations: [],
  }
  } catch (err) {
    // Catches anything not already handled above -- most notably an
    // unguarded appendMessage() failing (OL-008: a large corrective
    // response's persisted row hit some DB-level failure; nothing wrapped
    // that specific call). Never let a throw here cross the
    // sendChatMessageAction Server Action boundary uncaught -- production
    // Next.js redacts that to an opaque "Minified React error #441" with no
    // way for the user to tell whether the turn's side effects (e.g. an
    // artifact attach earlier in the same turn) completed. This can't
    // itself guarantee that answer -- it only guarantees the user gets a
    // readable message and a Retry instead of a dead end.
    console.error('runAssistantTurn: uncaught error', err)
    return {
      conversationId: conversation.id,
      reply: "Something went wrong while finishing that response. It's possible part of it (e.g. an attached artifact) was saved before the failure -- check the conversation before retrying to avoid a duplicate.",
      providerName: chatProvider.providerName,
      providerDisplayName: chatProvider.providerDisplayName,
      modelId: chatProvider.modelId,
      modelDisplayName: chatProvider.modelDisplayName,
      toolsUsed: [...toolsUsed],
      webSearchQueries: [...webSearchQueries],
      structured: null,
      createdRecords: [],
      pendingGatewayInvocations: [],
      isInternalError: true,
    }
  } finally {
    await ctx.supabase.from('conversations').update({ pending_turn_started_at: null }).eq('id', conversation.id)
  }
}
