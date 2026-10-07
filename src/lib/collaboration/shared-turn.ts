import 'server-only'
import {
  resolveChatProvider,
  AIProviderError,
  classifyProviderError,
  AISensitivityError,
  getEffectiveSensitivity,
  assertProviderEligible,
  withAllowanceGate,
  getBuilderSpendSummary,
  BuilderAllowanceError,
  aiHostingForProject,
  SelfHostedAIUnavailableError,
} from '@/lib/ai'
import type { ChatMessage, ChatProviderInfo } from '@/lib/ai'
import { SEARCH_PROJECT_KNOWLEDGE_TOOL, SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME, runSearchProjectKnowledge } from '@/lib/chat/project-knowledge-tool'
import { LIST_PROJECT_MEMBERS_TOOL, LIST_PROJECT_MEMBERS_TOOL_NAME, runListProjectMembers } from '@/lib/chat/project-members-tool'
import { LIST_WORKSTREAMS_TOOL, LIST_WORKSTREAMS_TOOL_NAME, runListWorkstreams } from '@/lib/chat/workstream-list-tool'
import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { CollaborationError, toCollaborationError } from './errors'
import {
  MAX_PROPOSALS,
  PROPOSE_FIELD_EDIT_TOOL,
  PROPOSE_FIELD_EDIT_TOOL_NAME,
  PROPOSE_PROJECT_NOTE_TOOL,
  PROPOSE_PROJECT_NOTE_TOOL_NAME,
  toProposal,
  type ProposalContext,
} from './shared-chat-tools'
import {
  SUMMARIZE_AFTER,
  SUMMARY_SYSTEM_PROMPT,
  buildSharedHistory,
  buildSummaryInput,
  evidenceKey,
  mergeEvidence,
  sharedSystemPrompt,
  usableSummary,
  type ClaimedTurn,
  type TurnContext,
} from './shared-turn-context'
import type { SharedEvidence, SharedProposal } from './types'

// Shared workspace sessions, Phase 3: runs the shared chat's waiting turns
// for one conversation, one at a time, in order. Called from
// src/app/api/collaboration/turns/route.ts by one of the pair.
//
// Differences from a personal Ember turn (src/lib/chat/loop.ts), all
// deliberate:
// - Evidence: Ember sees only sources every reader of the conversation (the
//   pair and its viewers) can open. Search results are filtered with
//   collaboration_common_evidence, which applies the real access rules as
//   each reader, called with the signed-in caller's own credentials; earlier
//   answers that drew on anything else are left out of the context.
// - Tools: search_project_knowledge, list_workstreams, list_project_members,
//   and two proposal tools (shared-chat-tools.ts): Ember proposes a note or
//   field text and a person acts on it. No workspace changes, invitations,
//   web search, working knowledge or gateway tools.
// - Summary: once enough messages fall outside the latest 30 Ember sees,
//   a new summary of them (common evidence only) is written after the
//   answer, and used for later turns while it stays common.
// - Models: the platform's default chat model (or a Sandz-hosted one where
//   the Project requires it); never a builder's own LLM. The information-
//   sensitivity check runs before every model call, as in loop.ts.
// - Writes: claiming, completing and failing a turn use the service role
//   (no browser can write an Ember reply); the turn's lease makes a repeated
//   or late completion harmless.

const MAX_ITERATIONS = 6
const MAX_SEARCHES = 3
// Stop taking new turns after this long, leaving time to finish the last one
// within the route's maxDuration; the next poll starts another run.
const RUN_BUDGET_MS = 45_000

type Admin = ReturnType<typeof createAdminClient>

async function rpc<T>(client: WorkbenchCallerContext['supabase'] | Admin, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw toCollaborationError(error)
  return data as T
}

export async function runSharedChatTurns(ctx: WorkbenchCallerContext, conversationId: string): Promise<{ answered: number; state: 'idle' | 'busy' }> {
  const admin = createAdminClient()
  const started = Date.now()
  let answered = 0
  while (Date.now() - started < RUN_BUDGET_MS) {
    // Checks again that the caller is one of the pair, with access.
    const claim = await rpc<ClaimedTurn | { state: 'idle' | 'busy' }>(admin, 'collaboration_claim_turn', {
      p_conversation: conversationId,
      p_actor: ctx.user.id,
    })
    if (claim.state !== 'claimed') return { answered, state: claim.state }
    await runOneTurn(ctx, admin, claim)
    answered++
  }
  return { answered, state: 'busy' }
}

async function runOneTurn(ctx: WorkbenchCallerContext, admin: Admin, turn: ClaimedTurn): Promise<void> {
  const fail = (message: string) => rpc(admin, 'collaboration_fail_turn', { p_turn: turn.turnId, p_lease: turn.leaseId, p_error: message })
  let result: Awaited<ReturnType<typeof answer>>
  let context: TurnContext
  try {
    context = await rpc<TurnContext>(admin, 'collaboration_turn_context', { p_turn: turn.turnId, p_lease: turn.leaseId })
    result = await answer(ctx, turn, context)
    if ('error' in result) {
      await fail(result.error)
      return
    }
    await rpc(admin, 'collaboration_complete_turn', {
      p_turn: turn.turnId,
      p_lease: turn.leaseId,
      p_content: result.content,
      p_evidence: result.evidence,
      p_provider: result.provider.providerName,
      p_model: result.provider.modelId,
    })
    if (result.proposals.length > 0) {
      await rpc(admin, 'collaboration_set_reply_proposals', { p_turn: turn.turnId, p_lease: turn.leaseId, p_proposals: result.proposals })
    }
  } catch (err) {
    // A turn taken over after its lease ran out: the other run answers it.
    if (err instanceof CollaborationError && err.kind === 'stale') return
    console.error('Shared chat turn failed', err)
    await fail('Ember couldn’t answer this time. Ask again.').catch(() => {})
    return
  }
  // The answer is in; a summary is extra and never fails the turn.
  if (context.unsummarized.length >= SUMMARIZE_AFTER) {
    await summarize(ctx, admin, turn, context, result).catch((err) => console.error('Shared chat summary failed', err))
  }
}

type Answered = {
  content: string
  evidence: SharedEvidence[]
  proposals: SharedProposal[]
  provider: ChatProviderInfo
  providerRowId: string
  projectSensitivity: Parameters<typeof getEffectiveSensitivity>[1]['projectSensitivity']
}

async function checkSensitivity(ctx: WorkbenchCallerContext, providerRowId: string, evidence: SharedEvidence[], projectSensitivity: Answered['projectSensitivity']) {
  const sensitivity = await getEffectiveSensitivity(ctx.supabase, {
    wikiArticleSlugs: evidence.filter((e) => e.type === 'wiki_article').map((e) => e.id),
    knowledgeSourceIds: evidence.filter((e) => e.type === 'knowledge_source').map((e) => e.id),
    projectSensitivity,
  })
  await assertProviderEligible(ctx.supabase, providerRowId, sensitivity)
}

// Rewrites the summary to cover the messages that dropped out of Ember's
// window, from common evidence only, with the same model and checks.
async function summarize(ctx: WorkbenchCallerContext, admin: Admin, turn: ClaimedTurn, context: TurnContext, answered: Answered) {
  const all = [...(context.summary?.evidence ?? []), ...context.unsummarized.flatMap((m) => m.evidence)]
  const input = buildSummaryInput(context, await commonEvidence(ctx, turn.conversationId, all))
  if (!input) return
  await checkSensitivity(ctx, answered.providerRowId, input.evidence, answered.projectSensitivity)
  const result = await answered.provider.provider.generateChat({
    messages: [{ role: 'user', content: input.text }],
    system: SUMMARY_SYSTEM_PROMPT,
    maxOutputTokens: answered.provider.maxOutputTokens ?? undefined,
  })
  const content = result.message.content?.trim()
  if (!content) return
  await rpc(admin, 'collaboration_record_summary', {
    p_conversation: turn.conversationId,
    p_upto_ord: input.uptoOrd,
    p_content: content,
    p_evidence: input.evidence,
    p_provider: answered.provider.providerName,
    p_model: answered.provider.modelId,
  })
}

// Only the evidence every reader can open, as the database's own access
// rules decide, checked with the caller's credentials.
async function commonEvidence(ctx: WorkbenchCallerContext, conversationId: string, items: SharedEvidence[]): Promise<Set<string>> {
  if (items.length === 0) return new Set()
  const common = await rpc<SharedEvidence[]>(ctx.supabase, 'collaboration_common_evidence', {
    p_conversation: conversationId,
    p_evidence: items.map(({ type, id }) => ({ type, id })),
  })
  return new Set(common.map(evidenceKey))
}

async function answer(ctx: WorkbenchCallerContext, turn: ClaimedTurn, context: TurnContext): Promise<Answered | { error: string }> {
  const { data: project, error: projectError } = await ctx.supabase
    .from('projects')
    .select('name, goal, objective, information_sensitivity, owner_id, builder_id, portfolio_category')
    .eq('id', turn.projectId)
    .single()
  if (projectError || !project) throw projectError ?? new Error('Project not found')

  const { data: shell } = await ctx.supabase.rpc('collaboration_conversation', { p_conversation: turn.conversationId })
  const conversation = shell as { participants: { name: string }[]; viewers: unknown[] } | null

  const historyEvidence = [...turn.history.flatMap((h) => h.evidence), ...(context.summary?.evidence ?? [])]
  const common = await commonEvidence(ctx, turn.conversationId, historyEvidence)
  const { messages, carried } = buildSharedHistory(turn, common)
  // The summary of older messages, while everyone can still open what it drew on.
  const summary = usableSummary(context.summary, common)
  let evidence: SharedEvidence[] = summary ? mergeEvidence(carried, summary.evidence) : carried
  const proposals: SharedProposal[] = []
  let proposalContext: ProposalContext | null = null

  const selfHostedOnly = (await aiHostingForProject(turn.projectId)) === 'self_hosted_only'
  let provider: ChatProviderInfo
  try {
    provider = await resolveChatProvider(ctx.supabase, undefined, { task: 'chat', requestedBy: ctx.user.id, projectId: turn.projectId }, { selfHostedOnly })
  } catch (err) {
    if (err instanceof SelfHostedAIUnavailableError) return { error: err.message }
    throw err
  }
  const { data: providerRow, error: providerRowError } = await ctx.supabase.from('ai_providers').select('id').eq('name', provider.providerName).single()
  if (providerRowError || !providerRow) throw providerRowError ?? new Error(`Provider row not found: ${provider.providerName}`)
  // A builder's own lab Project is metered against the builder's allowance,
  // whichever of the pair runs the turn.
  if (project.portfolio_category === 'builder_lab') {
    const builderId = project.builder_id ?? project.owner_id
    if (builderId) {
      const admin = createAdminClient()
      provider = { ...provider, provider: withAllowanceGate(() => getBuilderSpendSummary(admin, builderId), provider.provider) }
    }
  }

  const system = sharedSystemPrompt({
    projectName: project.name,
    goal: project.goal,
    objective: project.objective,
    pairNames: (conversation?.participants ?? []).map((p) => p.name),
    viewerCount: conversation?.viewers.length ?? 0,
    summary: summary?.content ?? null,
  })
  const tools = [SEARCH_PROJECT_KNOWLEDGE_TOOL, LIST_WORKSTREAMS_TOOL, LIST_PROJECT_MEMBERS_TOOL, PROPOSE_PROJECT_NOTE_TOOL, PROPOSE_FIELD_EDIT_TOOL]
  const history: ChatMessage[] = [...messages]
  let searches = 0

  try {
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      await checkSensitivity(ctx, providerRow.id, evidence, project.information_sensitivity)

      const lastIteration = iteration === MAX_ITERATIONS - 1
      const result = await provider.provider.generateChat({
        messages: history,
        system,
        tools: lastIteration ? undefined : tools,
        maxOutputTokens: provider.maxOutputTokens ?? undefined,
        cacheKey: `ember-shared-chat:${turn.projectId}`,
      })
      history.push(result.message)
      const calls = result.message.toolCalls ?? []
      if (calls.length === 0) {
        const content = result.message.content?.trim()
        return content
          ? { content, evidence, proposals, provider, providerRowId: providerRow.id, projectSensitivity: project.information_sensitivity }
          : { error: 'Ember didn’t produce an answer. Ask again.' }
      }
      for (const call of calls) {
        let output: unknown
        if (call.name === LIST_WORKSTREAMS_TOOL_NAME) {
          output = await runListWorkstreams(ctx, turn.projectId)
        } else if (call.name === LIST_PROJECT_MEMBERS_TOOL_NAME) {
          output = await runListProjectMembers(ctx, turn.projectId, call.arguments ?? {})
        } else if (call.name === PROPOSE_PROJECT_NOTE_TOOL_NAME || call.name === PROPOSE_FIELD_EDIT_TOOL_NAME) {
          proposalContext ??= await loadProposalContext(ctx, turn.projectId)
          const checked = proposals.length >= MAX_PROPOSALS ? { error: `At most ${MAX_PROPOSALS} proposals per answer.` } : toProposal(call.name, call.arguments, proposalContext)
          if ('proposal' in checked) proposals.push(checked.proposal)
          output = 'proposal' in checked ? { proposed: true, note: 'It will appear under your answer for them to use or not.' } : { error: checked.error }
        } else if (call.name !== SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME) {
          output = { error: `${call.name} isn't available in a shared conversation. Answer with what you have.` }
        } else if (++searches > MAX_SEARCHES) {
          output = { error: `You have searched ${MAX_SEARCHES} times. Answer with what you found.` }
        } else {
          const args = (call.arguments ?? {}) as { query?: unknown; limit?: unknown }
          const limit = typeof args.limit === 'number' ? Math.min(Math.max(Math.round(args.limit), 1), 10) : 3
          // Over-fetch, then keep only what every reader can open.
          const { results } = await runSearchProjectKnowledge(ctx, turn.projectId, { query: args.query, limit: Math.min(limit * 2, 10) })
          const found = results.map((r) => ({ type: r.sourceType, id: r.sourceId, title: r.title }) as SharedEvidence)
          const common = await commonEvidence(ctx, turn.conversationId, found)
          const usable = results.filter((r) => common.has(evidenceKey({ type: r.sourceType, id: r.sourceId }))).slice(0, limit)
          evidence = mergeEvidence(
            evidence,
            usable.map((r) => ({ type: r.sourceType, id: r.sourceId, title: r.title }))
          )
          output = {
            results: usable.map((r) => ({ layer: r.layer, title: r.title, content: r.content, similarity: r.similarity })),
            ...(usable.length < results.length ? { note: 'Some results were left out because not everyone in this conversation can open them.' } : {}),
          }
        }
        history.push({ role: 'tool', toolCallId: call.id, toolName: call.name, content: JSON.stringify(output) })
      }
    }
  } catch (err) {
    if (err instanceof AISensitivityError || err instanceof BuilderAllowanceError) return { error: err.message }
    if (err instanceof AIProviderError) {
      const code = classifyProviderError(err.cause ?? err)
      return {
        error:
          code === 'rate_limit' || code === 'quota_exceeded'
            ? 'Ember hit a capacity limit. Try again in a moment.'
            : 'Ember couldn’t get a response from its model right now. Try again.',
      }
    }
    throw err
  }
  return { error: 'Ember didn’t finish answering. Ask again.' }
}

// Members and workstreams a proposal may name (every reader sees these).
async function loadProposalContext(ctx: WorkbenchCallerContext, projectId: string): Promise<ProposalContext> {
  const [{ members }, { workstreams }] = await Promise.all([runListProjectMembers(ctx, projectId, {}), runListWorkstreams(ctx, projectId)])
  return { projectId, members, workstreams }
}
