import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import { createProjectNote } from '@/lib/projects/notes'
import { listMessages } from '@/lib/chat/conversations'
import type { Database, KnowledgeGapFailureKind, KnowledgeGapStatus, ProjectKnowledgeGap } from '@/types/database'

// Ember Readiness, Stage 3 (docs/dev-request-ember-readiness-and-knowledge-
// gaps.md): failure reports ("Ember got this wrong") and the Project
// curators' knowledge-gap queue. Reports are Project-scoped -- they never
// reach the platform-owner feedback board unless a curator converts one.
// RLS (20261014100001_project_knowledge_gaps.sql) limits a gap to its
// reporter and the Project's curators/admins; triggers keep a new report
// untriaged and what was reported unchangeable.

export const OPEN_GAP_STATUSES: KnowledgeGapStatus[] = ['new', 'needs_source', 'wiki_needed']
export const FAILURE_KINDS: KnowledgeGapFailureKind[] = ['wrong', 'incomplete', 'outdated', 'wrong_source', 'could_not_answer']
const TRIAGE_STATUSES: KnowledgeGapStatus[] = ['needs_source', 'wiki_needed', 'out_of_scope', 'duplicate']

const MAX_QUESTION = 4000
const MAX_ANSWER = 8000
const MAX_TEXT = 4000

export class KnowledgeGapValidationError extends Error {}

export interface FailureReportInput {
  failureKind: KnowledgeGapFailureKind
  details: string
  correctAnswer?: string
  suggestedSource?: string
}

function clean(value: string | undefined | null, max: number): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function validateFailure(input: FailureReportInput) {
  if (!FAILURE_KINDS.includes(input.failureKind)) throw new KnowledgeGapValidationError('Say what went wrong')
}

async function requireCurator(ctx: WorkbenchCallerContext, projectId: string, what: string) {
  if (ctx.profile.role === 'admin') return
  const role = await getActiveProjectRole(ctx, projectId)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError(`Requires this project's owner or curator role (or platform admin) to ${what}`)
  }
}

// Best effort: a notification failure never undoes the report or decision
// that already succeeded (same convention as presentation-notifications.ts).
async function notify(ctx: WorkbenchCallerContext, projectId: string, gapId: string, recipientIds: string[], subject: string, body: string) {
  for (const recipientUserId of new Set(recipientIds)) {
    if (recipientUserId === ctx.user.id) continue
    try {
      await createProjectNote(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
        projectId,
        recipientType: 'user',
        recipientUserId,
        subject,
        body,
        contextType: 'knowledge_gap',
        contextId: gapId,
      })
    } catch (err) {
      console.error(`Failed to notify ${recipientUserId} about knowledge gap ${gapId}:`, err)
    }
  }
}

async function notifyCurators(ctx: WorkbenchCallerContext, projectId: string, gapId: string, question: string) {
  const { data: curators } = await ctx.supabase
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('status', 'active')
    .in('role', ['owner', 'curator'])
  await notify(
    ctx,
    projectId,
    gapId,
    (curators ?? []).map((c) => c.user_id),
    'Ember answer reported',
    `A team member reported a problem with an Ember answer: "${question.slice(0, 200)}". Review it in the Project's knowledge gaps.`
  )
}

async function insertGap(ctx: WorkbenchCallerContext, row: Database['public']['Tables']['project_knowledge_gaps']['Insert']): Promise<string> {
  const { data, error } = await ctx.supabase.from('project_knowledge_gaps').insert(row).select('id').single()
  if (error || !data) throw error ?? new Error('Could not save the report')
  return data.id
}

// "Report a problem with this answer" on an Ember answer in a Project-bound
// conversation. The question, the answer, its verified citations and the
// model are taken from the stored conversation (read through the caller's
// own RLS, so only their own conversation), never from the client.
export async function reportEmberAnswer(ctx: WorkbenchCallerContext, messageId: string, input: FailureReportInput): Promise<{ gapId: string; projectId: string }> {
  validateFailure(input)

  const { data: message, error: messageError } = await ctx.supabase
    .from('chat_messages')
    .select('id, conversation_id, role, content, provider, model, response_payload')
    .eq('id', messageId)
    .maybeSingle()
  if (messageError) throw messageError
  if (!message || message.role !== 'assistant') throw new KnowledgeGapValidationError('That answer could not be found')

  const { data: conversation, error: conversationError } = await ctx.supabase
    .from('conversations')
    .select('id, project_id')
    .eq('id', message.conversation_id)
    .maybeSingle()
  if (conversationError) throw conversationError
  if (!conversation?.project_id) throw new KnowledgeGapValidationError('Only answers in a Project conversation can be reported to its curators')

  // The user's question is the last user message before this answer.
  const rows = await listMessages(ctx.supabase, conversation.id)
  const answerIndex = rows.findIndex((r) => r.id === message.id)
  const question = rows
    .slice(0, answerIndex === -1 ? rows.length : answerIndex)
    .reverse()
    .find((r) => r.role === 'user' && r.content?.trim())?.content

  const payload = message.response_payload as { message?: unknown; citations?: unknown } | null
  const citations = Array.isArray(payload?.citations)
    ? (payload.citations as { label?: unknown; sourceType?: unknown; sourceId?: unknown }[])
        .filter((c) => typeof c.label === 'string' && typeof c.sourceType === 'string' && typeof c.sourceId === 'string')
        .map((c) => ({ label: c.label as string, sourceType: c.sourceType as string, sourceId: c.sourceId as string }))
    : []
  const answer = typeof payload?.message === 'string' ? payload.message : message.content

  const gapId = await insertGap(ctx, {
    project_id: conversation.project_id,
    question: clean(question, MAX_QUESTION) ?? '(question not found)',
    ember_answer: clean(answer, MAX_ANSWER),
    failure_kind: input.failureKind,
    details: clean(input.details, MAX_TEXT),
    correct_answer: clean(input.correctAnswer, MAX_TEXT),
    suggested_source: clean(input.suggestedSource, MAX_TEXT),
    conversation_id: conversation.id,
    message_id: message.id,
    answer_provider: message.provider,
    answer_model: message.model,
    cited_sources: citations.length > 0 ? citations : null,
    reported_by: ctx.user.id,
  })
  await notifyCurators(ctx, conversation.project_id, gapId, question ?? '')
  return { gapId, projectId: conversation.project_id }
}

// A report typed into the Project's readiness section, not tied to a stored
// answer.
export async function reportTypedFailure(
  ctx: WorkbenchCallerContext,
  projectId: string,
  input: FailureReportInput & { question: string; emberAnswer?: string }
): Promise<{ gapId: string }> {
  validateFailure(input)
  const question = clean(input.question, MAX_QUESTION)
  if (!question) throw new KnowledgeGapValidationError('Type the question you asked Ember')

  const gapId = await insertGap(ctx, {
    project_id: projectId,
    question,
    ember_answer: clean(input.emberAnswer, MAX_ANSWER),
    failure_kind: input.failureKind,
    details: clean(input.details, MAX_TEXT),
    correct_answer: clean(input.correctAnswer, MAX_TEXT),
    suggested_source: clean(input.suggestedSource, MAX_TEXT),
    reported_by: ctx.user.id,
  })
  await notifyCurators(ctx, projectId, gapId, question)
  return { gapId }
}

// RLS returns every gap to a curator and only their own to anyone else.
// Open gaps first, newest first within each group.
export async function listKnowledgeGaps(supabase: SupabaseClient<Database>, projectId: string): Promise<ProjectKnowledgeGap[]> {
  const { data, error } = await supabase
    .from('project_knowledge_gaps')
    .select('*')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []
  const isOpen = (g: ProjectKnowledgeGap) => OPEN_GAP_STATUSES.includes(g.status)
  return [...rows.filter(isOpen), ...rows.filter((g) => !isOpen(g))]
}

async function loadGapForCurator(ctx: WorkbenchCallerContext, gapId: string, what: string): Promise<ProjectKnowledgeGap> {
  const { data, error } = await ctx.supabase.from('project_knowledge_gaps').select('*').eq('id', gapId).maybeSingle()
  if (error) throw error
  if (!data) throw new KnowledgeGapValidationError('That knowledge gap could not be found')
  await requireCurator(ctx, data.project_id, what)
  return data
}

async function updateGap(ctx: WorkbenchCallerContext, gapId: string, patch: Database['public']['Tables']['project_knowledge_gaps']['Update']) {
  const { error } = await ctx.supabase.from('project_knowledge_gaps').update(patch).eq('id', gapId)
  if (error) throw error
}

export async function triageKnowledgeGap(
  ctx: WorkbenchCallerContext,
  gapId: string,
  input: { status: KnowledgeGapStatus; note?: string; duplicateOf?: string | null }
): Promise<{ projectId: string }> {
  const gap = await loadGapForCurator(ctx, gapId, 'triage knowledge gaps')
  if (!TRIAGE_STATUSES.includes(input.status)) throw new KnowledgeGapValidationError('Choose a triage outcome')
  if (input.status === 'duplicate') {
    if (!input.duplicateOf || input.duplicateOf === gapId) throw new KnowledgeGapValidationError('Choose the gap this duplicates')
    const { data: original } = await ctx.supabase.from('project_knowledge_gaps').select('project_id').eq('id', input.duplicateOf).maybeSingle()
    if (original?.project_id !== gap.project_id) throw new KnowledgeGapValidationError('Choose a gap from this Project')
  }
  const closing = input.status === 'out_of_scope' || input.status === 'duplicate'
  await updateGap(ctx, gapId, {
    status: input.status,
    triage_note: clean(input.note, MAX_TEXT),
    duplicate_of: input.status === 'duplicate' ? input.duplicateOf! : null,
    resolved_by: closing ? ctx.user.id : null,
    resolved_at: closing ? new Date().toISOString() : null,
  })
  if (closing && gap.reported_by) {
    const outcome = input.status === 'duplicate' ? 'is already covered by another report' : 'is outside what Ember covers for this Project'
    await notify(ctx, gap.project_id, gapId, [gap.reported_by], 'Your Ember report was reviewed', `Your report "${gap.question.slice(0, 200)}" ${outcome}.`)
  }
  return { projectId: gap.project_id }
}

// Resolve by linking the source or Wiki article that now covers the
// question, and record whether Ember now answers it when re-asked.
export async function resolveKnowledgeGap(
  ctx: WorkbenchCallerContext,
  gapId: string,
  input: { resolvingSourceId?: string | null; resolvingArticleId?: string | null; note: string; verifiedAnswers: boolean | null }
): Promise<{ projectId: string }> {
  const gap = await loadGapForCurator(ctx, gapId, 'resolve knowledge gaps')
  const note = clean(input.note, MAX_TEXT)
  if (!input.resolvingSourceId && !input.resolvingArticleId && !note) {
    throw new KnowledgeGapValidationError('Link the source or Wiki article that now covers this, or say how it was resolved')
  }
  const now = new Date().toISOString()
  await updateGap(ctx, gapId, {
    status: 'resolved',
    resolving_source_id: input.resolvingSourceId || null,
    resolving_article_id: input.resolvingArticleId || null,
    resolution_note: note,
    verified_answers: input.verifiedAnswers,
    verified_by: input.verifiedAnswers === null ? null : ctx.user.id,
    verified_at: input.verifiedAnswers === null ? null : now,
    resolved_by: ctx.user.id,
    resolved_at: now,
  })
  if (gap.reported_by) {
    await notify(
      ctx,
      gap.project_id,
      gapId,
      [gap.reported_by],
      'Your Ember report was resolved',
      `Your report "${gap.question.slice(0, 200)}" was resolved.${note ? ` ${note}` : ''}`
    )
  }
  return { projectId: gap.project_id }
}

// One click: the gap's question becomes a draft test question in the
// Project's draft dataset (created if the Project has none), so every later
// eval run checks it stays fixed. A curator reviews it before the dataset
// is activated. Active datasets are frozen, so only a draft one is used.
export async function promoteKnowledgeGapToEvalCase(ctx: WorkbenchCallerContext, gapId: string): Promise<{ projectId: string; datasetId: string }> {
  const gap = await loadGapForCurator(ctx, gapId, 'add test questions')
  if (gap.eval_case_id) throw new KnowledgeGapValidationError('This gap is already a test question')
  const expectedAnswer = gap.correct_answer ?? gap.resolution_note
  if (!expectedAnswer) throw new KnowledgeGapValidationError('Add the correct answer (resolve the gap with a note) before turning it into a test question')

  const { data: drafts, error: draftsError } = await ctx.supabase
    .from('eval_datasets')
    .select('id')
    .eq('project_id', gap.project_id)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
  if (draftsError) throw draftsError

  let datasetId = drafts?.[0]?.id
  if (!datasetId) {
    const { data: project } = await ctx.supabase.from('projects').select('name').eq('id', gap.project_id).maybeSingle()
    const { data: created, error: createError } = await ctx.supabase
      .from('eval_datasets')
      .insert({
        name: `${project?.name ?? 'Project'} — Ember test questions`,
        description: 'Draft test questions, including ones added from resolved knowledge gaps.',
        version: 1,
        status: 'draft',
        knowledge_base_id: null,
        project_id: gap.project_id,
        created_by: ctx.user.id,
      })
      .select('id')
      .single()
    if (createError || !created) throw createError ?? new Error('Could not create a draft dataset')
    datasetId = created.id
  }

  let scoringCriteria: string | null = null
  if (gap.resolving_source_id) {
    const { data: source } = await ctx.supabase.from('knowledge_sources').select('title').eq('id', gap.resolving_source_id).maybeSingle()
    if (source) scoringCriteria = `Should answer from "${source.title}".`
  }

  const { data: evalCase, error: caseError } = await ctx.supabase
    .from('eval_cases')
    .insert({
      dataset_id: datasetId,
      question: gap.question,
      expected_answer: expectedAnswer,
      expected_concepts: null,
      expected_article_ids: gap.resolving_article_id ? [gap.resolving_article_id] : null,
      expected_chunk_ids: null,
      scoring_criteria: scoringCriteria,
      tags: ['knowledge-gap'],
      difficulty: null,
    })
    .select('id')
    .single()
  if (caseError || !evalCase) throw caseError ?? new Error('Could not add the test question')

  await updateGap(ctx, gapId, { eval_case_id: evalCase.id })
  return { projectId: gap.project_id, datasetId }
}

// A report that turns out to be a problem with Ember itself, not a missing
// source: file it on the platform feedback board (as the curator) and close
// the gap as a product issue.
export async function convertKnowledgeGapToFeedback(ctx: WorkbenchCallerContext, gapId: string): Promise<{ projectId: string; reportNumber: number }> {
  const gap = await loadGapForCurator(ctx, gapId, 'convert reports to feedback')
  if (gap.feedback_report_id) throw new KnowledgeGapValidationError('This gap is already on the feedback board')

  const description = [
    `Reported from a Project's knowledge gaps as a problem with Ember itself.`,
    `Question: ${gap.question}`,
    gap.ember_answer ? `Ember's answer: ${gap.ember_answer}` : null,
    gap.details ? `What was wrong: ${gap.details}` : null,
    gap.answer_model ? `Model: ${gap.answer_provider ?? ''} ${gap.answer_model}`.trim() : null,
  ]
    .filter(Boolean)
    .join('\n\n')

  const { data: report, error } = await ctx.supabase
    .from('feedback_reports')
    .insert({
      reporter_id: ctx.user.id,
      type: 'bug',
      title: `Ember answer problem: ${gap.question.slice(0, 120)}`,
      description,
      expected_result: gap.correct_answer,
      actual_result: gap.ember_answer ? gap.ember_answer.slice(0, 2000) : null,
      project_id: gap.project_id,
      current_page: `/projects/${gap.project_id}`,
    })
    .select('id, report_number')
    .single()
  if (error || !report) throw error ?? new Error('Could not file the feedback report')

  const now = new Date().toISOString()
  await updateGap(ctx, gapId, { feedback_report_id: report.id, status: 'product_issue', resolved_by: ctx.user.id, resolved_at: now })
  return { projectId: gap.project_id, reportNumber: report.report_number }
}
