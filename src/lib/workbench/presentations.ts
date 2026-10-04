import 'server-only'
import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import { createAdminClient } from '@/lib/supabase/admin'
import { aiHostingForWorkstream, gateProvider, getActiveStructuredOutputProvider, manifestForWorkstream } from '@/lib/ai'
import { getOntologyMapData } from '@/lib/projects/ontology-map'
import { notifyReviewOpened, notifySubmittedForCuratorReview, notifyApproved } from './presentation-notifications'
import type {
  Database,
  Presentation,
  PresentationVersion,
  PresentationSlide,
  PresentationSlideComment,
  PresentationAction,
  PresentationActionStatus,
  PresentationActionType,
  PresentationStatus,
  SlideCommentClassification,
  TableUpdate,
} from '@/types/database'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Workstream Presentation & Review, Part A (docs/Workstream Presentation &
// Customer Review.docx). Same curator-or-admin write-guard shape as
// workstream-relationships.ts/methods.ts's own local copies (this
// codebase's own convention, not a shared helper).

async function requireCuratorForWorkstream(ctx: WorkbenchCallerContext, workstreamId: string, actionLabel: string): Promise<string> {
  const { profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError(`Create an account to ${actionLabel}`)
  const { data: workstream, error } = await supabase.from('project_workstreams').select('project_id').eq('id', workstreamId).single()
  if (error || !workstream) throw error ?? new ProjectValidationError('Workstream not found')
  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, workstream.project_id)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `To ${actionLabel} you need this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }.`
      )
    }
  }
  return workstream.project_id as string
}

async function requireCuratorForPresentation(
  ctx: WorkbenchCallerContext,
  presentationId: string,
  actionLabel: string
): Promise<{ projectId: string; workstreamId: string }> {
  const { data: presentation, error } = await ctx.supabase.from('presentations').select('workstream_id').eq('id', presentationId).single()
  if (error || !presentation) throw error ?? new ProjectValidationError('Presentation not found')
  const projectId = await requireCuratorForWorkstream(ctx, presentation.workstream_id, actionLabel)
  return { projectId, workstreamId: presentation.workstream_id as string }
}

// -- Generation ---------------------------------------------------------

const GeneratedSlideSchema = z.object({
  tempId: z.string(),
  title: z.string(),
  // Not `.string()` alone -- caught live: for a bullet-list-only slide,
  // Gemini's real structured output omits the body key entirely rather
  // than sending "", the same "omits an optional key instead of emitting
  // null/empty" behavior already documented in project-ontology-
  // suggestions.ts's own parentTempId comment. `.nullish()` accepts the
  // key being absent OR null; a plain `.optional()` alone would still
  // reject an explicit null, which the model does also sometimes send.
  body: z.string().nullish(),
  items: z.array(z.string()).nullish(),
})
const GeneratedPresentationSchema = z.object({ slides: z.array(GeneratedSlideSchema) })

function buildPresentationPrompt(
  workstream: { name: string; goal: string | null; summary: string | null; guardrail: string | null; deliverables: { label: string }[] },
  artifacts: { artifact_type: string; title: string; content: string | null }[],
  project: { objective: string | null }
): string {
  const artifactLines = artifacts
    .map((a) => `- [${a.artifact_type}] ${a.title}${a.content ? `: ${a.content.slice(0, 1500)}` : ''}`)
    .join('\n')
  return (
    `Project objective: ${project.objective ?? 'Not specified'}\n` +
    `Workstream: ${workstream.name}\n` +
    `Goal: ${workstream.goal ?? 'Not specified'}\n` +
    `Summary: ${workstream.summary ?? 'Not specified'}\n` +
    `Guardrail: ${workstream.guardrail ?? 'Not specified'}\n` +
    `Deliverables: ${workstream.deliverables.map((d) => d.label).join(', ') || 'None'}\n\n` +
    `Evidence gathered from this workstream's own artifacts:\n${artifactLines || 'None attached yet.'}\n\n` +
    'Write a concise slide-based proposal covering only what the evidence above actually supports. Suggested (not ' +
    'mandatory) slides: Goal, Customer/business problem, Current-state findings, Proposed solution, Architecture, ' +
    'Knowledge and evidence, AI components, Alternatives considered, Evaluation results, Security and governance, ' +
    'Implementation approach, Risks and limitations, Expected outcome, Open questions, Recommendation, Next steps. ' +
    "Not every workstream needs every slide -- omit any slide the evidence doesn't support, and never invent a " +
    'capability or result the evidence above does not show. Give each slide a unique tempId (e.g. "slide-1"), a ' +
    'short title, and a concise body (a short paragraph, or bullet points via the items array). Keep it ' +
    'presentation-concise, not long-form documentation.'
  )
}

// Always creates a NEW version -- never edits an existing one's slides
// (presentation_versions is insert-only, no update/delete RLS policy at
// all, same immutability as wiki_versions).
export async function generatePresentation(
  ctx: WorkbenchCallerContext,
  workstreamId: string
): Promise<{ presentationId: string; versionId: string; slideCount: number }> {
  await requireCuratorForWorkstream(ctx, workstreamId, 'generate a presentation for this workstream')
  const { supabase, user } = ctx

  const { data: workstream, error: wsError } = await supabase
    .from('project_workstreams')
    .select('project_id, name, goal, summary, guardrail, deliverables')
    .eq('id', workstreamId)
    .single()
  if (wsError || !workstream) throw wsError ?? new ProjectValidationError('Workstream not found')

  const { data: project, error: projectError } = await supabase.from('projects').select('objective').eq('id', workstream.project_id).single()
  if (projectError || !project) throw projectError ?? new ProjectValidationError('Project not found')

  const { data: artifacts, error: artifactsError } = await supabase
    .from('workstream_artifacts')
    .select('artifact_type, title, content')
    .eq('workstream_id', workstreamId)
  if (artifactsError) throw artifactsError

  // Most pre-existing projects have no Builder Ontology at all (no
  // project_objects rows) -- getOntologyMapData already returns empty
  // arrays for those, not an error, so this is a plain presence check.
  const ontologyData = await getOntologyMapData(supabase, workstream.project_id)

  // Sends the Workstream's goal/summary, every artifact and the Project
  // objective -- gated on the Project's and each artifact's classification.
  const provider = await gateProvider(
    supabase,
    await getActiveStructuredOutputProvider(
      supabase,
      { requestedBy: user.id },
      { selfHostedOnly: (await aiHostingForWorkstream(workstreamId)) === 'self_hosted_only' }
    ),
    await manifestForWorkstream(workstreamId)
  )
  const { data: generated } = await provider.generateStructured({
    system: 'You are Ember, turning a completed Workstream into a concise slide-based proposal for internal and customer review.',
    prompt: buildPresentationPrompt(workstream, artifacts ?? [], project),
    schema: GeneratedPresentationSchema,
    maxOutputTokens: 4096,
  })

  const { data: existing } = await supabase.from('presentations').select('id').eq('workstream_id', workstreamId).maybeSingle()
  let presentationId = existing?.id as string | undefined
  if (!presentationId) {
    const { data: created, error: createError } = await supabase
      .from('presentations')
      .insert({ workstream_id: workstreamId, created_by: user.id })
      .select('id')
      .single()
    if (createError || !created) throw createError ?? new ProjectValidationError('Failed to create presentation')
    presentationId = created.id
  }
  if (!presentationId) throw new ProjectValidationError('Failed to resolve presentation')

  const { data: latestVersion } = await supabase
    .from('presentation_versions')
    .select('version_number')
    .eq('presentation_id', presentationId)
    .order('version_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  const versionNumber = (latestVersion?.version_number ?? 0) + 1

  const slides: PresentationSlide[] = generated.slides.map((s) => ({
    id: s.tempId,
    type: 'text',
    title: s.title,
    // A bullet-list-only slide (items present, body omitted) is valid --
    // fall back to '' rather than leaving an undefined body reaching the DB.
    body: s.body ?? '',
    items: s.items ?? undefined,
  }))

  // Frozen into this version at generation time, same as every other
  // slide's content -- not live-refreshed on later views. Only added when
  // this project actually has ontology data; most projects don't.
  if (ontologyData.objects.length > 0) {
    slides.unshift({ id: 'ontology-overview', type: 'diagram_ref', title: 'Ontology Overview', body: '', diagramData: ontologyData })
  }

  const { data: version, error: versionError } = await supabase
    .from('presentation_versions')
    .insert({ presentation_id: presentationId, version_number: versionNumber, slides, generated_by: user.id })
    .select('id')
    .single()
  if (versionError || !version) throw versionError ?? new ProjectValidationError('Failed to save the generated presentation')

  const { error: updateError } = await supabase.from('presentations').update({ current_version_id: version.id }).eq('id', presentationId)
  if (updateError) throw updateError

  return { presentationId, versionId: version.id, slideCount: slides.length }
}

// -- Review-period state machine -----------------------------------------
// Exactly transitionProjectStatus's own shape (src/lib/workbench/projects.ts):
// re-read current status, guard the actual update by that same value (race-
// safe), log to presentation_status_history via the admin client (that
// table has no insert policy at all -- same as project_status_history),
// best-effort/non-fatal logging failure.

async function transitionPresentationStatus(
  ctx: WorkbenchCallerContext,
  presentationId: string,
  validFrom: PresentationStatus[],
  to: PresentationStatus,
  extra?: Record<string, unknown>
): Promise<{ projectId: string; workstreamId: string }> {
  const { projectId, workstreamId } = await requireCuratorForPresentation(ctx, presentationId, "update this presentation's review status")

  const { data: current, error: readError } = await ctx.supabase.from('presentations').select('status').eq('id', presentationId).single()
  if (readError || !current) throw readError ?? new ProjectValidationError('Presentation not found')
  if (!validFrom.includes(current.status)) {
    throw new ProjectValidationError(`This presentation is currently "${current.status}" -- expected ${validFrom.join(' or ')}.`)
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('presentations')
    .update({ status: to, ...extra })
    .eq('id', presentationId)
    .eq('status', current.status)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError("This presentation's status changed before the update could complete -- please retry.")
  }

  try {
    await admin
      .from('presentation_status_history')
      .insert({ presentation_id: presentationId, from_status: current.status, to_status: to, actor_id: ctx.user.id })
  } catch (err) {
    console.error(`Failed to log presentation status change (${presentationId}: ${current.status} -> ${to}):`, err)
  }

  return { projectId, workstreamId }
}

export async function openPresentationReview(ctx: WorkbenchCallerContext, presentationId: string, reviewDeadline?: string | null): Promise<void> {
  const { workstreamId } = await transitionPresentationStatus(ctx, presentationId, ['draft'], 'review_open', {
    review_deadline: reviewDeadline ?? null,
    // Opening early cleanly clears any pending schedule -- the cron job's
    // own WHERE clause already excludes non-draft rows, but leaving a
    // stale scheduled_open_at around would be a confusing thing to show.
    scheduled_open_at: null,
  })
  await notifyReviewOpened(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
    presentationId,
    workstreamId,
    reviewDeadline: reviewDeadline ?? null,
  })
}

export async function closePresentationReview(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  await transitionPresentationStatus(ctx, presentationId, ['review_open'], 'review_closed')
}

export async function startBuilderRevision(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  await transitionPresentationStatus(ctx, presentationId, ['review_closed'], 'builder_revision')
}

export async function submitForCuratorReview(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  const { workstreamId } = await transitionPresentationStatus(ctx, presentationId, ['review_closed', 'builder_revision'], 'curator_review')
  await notifySubmittedForCuratorReview(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, { presentationId, workstreamId })
}

export async function reopenPresentationReview(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  await transitionPresentationStatus(ctx, presentationId, ['curator_review'], 'review_open')
}

// Self-approval is blocked here, at the service layer -- every other
// transition on this same column is already curator-only, so a dedicated
// RLS policy just for this one case would be redundant with the check
// transitionPresentationStatus already requires (see the migration's own
// comment on presentations_update_curator).
export async function approvePresentation(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  const { data: presentation, error } = await ctx.supabase.from('presentations').select('created_by').eq('id', presentationId).single()
  if (error || !presentation) throw error ?? new ProjectValidationError('Presentation not found')
  if (presentation.created_by === ctx.user.id) {
    throw new AuthError('You cannot approve a presentation you created yourself -- ask another curator or admin to approve it.')
  }
  const { workstreamId } = await transitionPresentationStatus(ctx, presentationId, ['curator_review'], 'approved')
  await notifyApproved(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
    presentationId,
    workstreamId,
    createdBy: presentation.created_by,
  })
}

// -- Scheduled review open -------------------------------------------------
// A curator can schedule review to open automatically at a future date/time
// instead of clicking "Open for review" that day. Not a status-machine
// transition (status stays 'draft' the whole time it's pending) -- plain
// RLS-gated field updates, same bar as updatePresentationAction's
// owner/curator update.

export async function scheduleReviewOpen(
  ctx: WorkbenchCallerContext,
  presentationId: string,
  scheduledOpenAt: string,
  reviewDeadline?: string | null
): Promise<void> {
  await requireCuratorForPresentation(ctx, presentationId, 'schedule this presentation to open for review')
  if (new Date(scheduledOpenAt).getTime() <= Date.now()) {
    throw new ProjectValidationError('The scheduled open time must be in the future.')
  }

  const { data: current, error: readError } = await ctx.supabase.from('presentations').select('status').eq('id', presentationId).single()
  if (readError || !current) throw readError ?? new ProjectValidationError('Presentation not found')
  if (current.status !== 'draft') {
    throw new ProjectValidationError(`This presentation is currently "${current.status}" -- only a draft presentation can be scheduled.`)
  }

  const { error } = await ctx.supabase
    .from('presentations')
    .update({ scheduled_open_at: scheduledOpenAt, review_deadline: reviewDeadline ?? null })
    .eq('id', presentationId)
  if (error) throw error
}

export async function cancelScheduledReviewOpen(ctx: WorkbenchCallerContext, presentationId: string): Promise<void> {
  await requireCuratorForPresentation(ctx, presentationId, "cancel this presentation's scheduled open")
  const { error } = await ctx.supabase.from('presentations').update({ scheduled_open_at: null, review_deadline: null }).eq('id', presentationId)
  if (error) throw error
}

// Called from the cron route handler -- no ctx, since there's no acting
// user for a scheduled job. Mirrors transitionPresentationStatus's own
// compare-and-set + history-log shape, but entirely via the admin client
// (no curator check to make) and actor_id: null on the history row (a
// system-triggered transition, not a person's).
export async function autoOpenScheduledPresentations(): Promise<{ opened: string[] }> {
  const admin = createAdminClient()
  const { data: due, error } = await admin
    .from('presentations')
    .select('id, workstream_id, review_deadline, created_by')
    .eq('status', 'draft')
    .not('scheduled_open_at', 'is', null)
    .lte('scheduled_open_at', new Date().toISOString())
  if (error) throw error

  const opened: string[] = []
  for (const p of due ?? []) {
    const { data: updated, error: updateError } = await admin
      .from('presentations')
      .update({ status: 'review_open', scheduled_open_at: null })
      .eq('id', p.id)
      .eq('status', 'draft')
      .select('id')
    if (updateError) {
      console.error(`Auto-open failed for presentation ${p.id}:`, updateError)
      continue
    }
    if (!updated || updated.length === 0) continue // raced with a manual open -- already handled there

    try {
      await admin
        .from('presentation_status_history')
        .insert({ presentation_id: p.id, from_status: 'draft', to_status: 'review_open', actor_id: null })
    } catch (err) {
      console.error(`Failed to log auto-open history for ${p.id}:`, err)
    }

    if (p.created_by) {
      // Authored as the presentation's own creator (the curator who
      // scheduled it) -- createProjectNote requires a real, non-anonymous
      // author, and there is no acting user for a cron-triggered call.
      await notifyReviewOpened(
        admin,
        { id: p.created_by, role: 'curator' },
        { presentationId: p.id, workstreamId: p.workstream_id, reviewDeadline: p.review_deadline }
      )
    }
    opened.push(p.id)
  }
  return { opened }
}

// -- Slide comments ---------------------------------------------------------

export async function addSlideComment(
  ctx: WorkbenchCallerContext,
  versionId: string,
  slideId: string,
  commentText: string
): Promise<{ commentId: string }> {
  const { user, profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError('Create an account to comment on this presentation')

  const { data: version, error: versionError } = await supabase.from('presentation_versions').select('presentation_id').eq('id', versionId).single()
  if (versionError || !version) throw versionError ?? new ProjectValidationError('Presentation version not found')
  const { data: presentation, error: presentationError } = await supabase
    .from('presentations')
    .select('status')
    .eq('id', version.presentation_id)
    .single()
  if (presentationError || !presentation) throw presentationError ?? new ProjectValidationError('Presentation not found')
  if (presentation.status !== 'review_open') {
    throw new ProjectValidationError("Comments can only be added while this presentation's review is open.")
  }

  const { data, error } = await supabase
    .from('presentation_slide_comments')
    .insert({ presentation_version_id: versionId, slide_id: slideId, author_id: user.id, comment_text: commentText })
    .select('id')
    .single()
  if (error || !data) throw error ?? new ProjectValidationError('Failed to add comment')
  return { commentId: data.id }
}

// RLS (presentation_slide_comments_reply_curator, builder_reply IS NULL) is
// the real one-reply enforcement -- a second attempt on an already-replied
// row matches zero rows, same "zero rows = no permission" convention as
// reviewArtifact.
export async function replyToComment(ctx: WorkbenchCallerContext, commentId: string, replyText: string): Promise<void> {
  const { user, supabase } = ctx
  const { data, error } = await supabase
    .from('presentation_slide_comments')
    .update({ builder_reply: replyText, builder_reply_by: user.id, builder_reply_at: new Date().toISOString() })
    .eq('id', commentId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError('This comment already has a reply, or you do not have permission to reply to it.')
  }
}

// -- Ember classification + Action Register --------------------------------

const CLASSIFICATION_TO_ACTION_TYPE: Partial<Record<SlideCommentClassification, PresentationActionType>> = {
  evaluation_candidate: 'evaluation',
  action: 'action',
  security_review: 'security',
  requirement_gap: 'requirement',
}

const ClassificationResultSchema = z.object({
  results: z.array(
    z.object({
      commentId: z.string(),
      classification: z.enum([
        'question',
        'evaluation_candidate',
        'action',
        'security_review',
        'requirement_gap',
        'approval_signal',
        'scope_change',
        'risk_concern',
        'customer_requirement',
      ]),
      proposedAction: z.string().nullish(),
    })
  ),
})

// Explicit "Process feedback" trigger, not automatic per-comment -- keeps
// AI cost/latency predictable, same reasoning withAllowanceGate exists for.
// Classification updates and any resulting Action rows both go through the
// admin client after this function's own curator check, the same "Ember
// follow-up write" shape stampProvenance (loop.ts) already uses -- no RLS
// policy exists for a classification-only update (the only update policy
// on this table is the reply one, which requires setting builder_reply).
export async function classifyPendingComments(
  ctx: WorkbenchCallerContext,
  versionId: string
): Promise<{ classified: number; actionsCreated: number }> {
  const { data: version, error: versionError } = await ctx.supabase
    .from('presentation_versions')
    .select('presentation_id')
    .eq('id', versionId)
    .single()
  if (versionError || !version) throw versionError ?? new ProjectValidationError('Presentation version not found')
  await requireCuratorForPresentation(ctx, version.presentation_id, 'process feedback on this presentation')

  const { data: comments, error: commentsError } = await ctx.supabase
    .from('presentation_slide_comments')
    .select('id, comment_text, slide_id')
    .eq('presentation_version_id', versionId)
    .is('classification', null)
  if (commentsError) throw commentsError
  if (!comments || comments.length === 0) return { classified: 0, actionsCreated: 0 }

  // Review comments discuss the Workstream's content, so they carry its
  // classification.
  const { data: presentation, error: presentationError } = await ctx.supabase
    .from('presentations')
    .select('workstream_id')
    .eq('id', version.presentation_id)
    .single()
  if (presentationError || !presentation) throw presentationError ?? new ProjectValidationError('Presentation not found')
  const provider = await gateProvider(
    ctx.supabase,
    await getActiveStructuredOutputProvider(
      ctx.supabase,
      { requestedBy: ctx.user.id },
      { selfHostedOnly: (await aiHostingForWorkstream(presentation.workstream_id)) === 'self_hosted_only' }
    ),
    await manifestForWorkstream(presentation.workstream_id)
  )
  const commentLines = comments.map((c) => `Comment ${c.id} (slide ${c.slide_id}): "${c.comment_text}"`).join('\n')
  const { data: classified } = await provider.generateStructured({
    // Caught live (3rd distinct Gemini structured-output quirk, after the
    // array-flattening/snake_case one below): for a genuinely ambiguous
    // comment, the model returned classification as a SLASH-JOINED string
    // combining several enum values ("evaluation_candidate/action/
    // security_review/requirement_gap") instead of picking one -- almost
    // certainly copying that exact slash-separated shorthand from this
    // system prompt's own earlier wording, which is why it's no longer
    // written that way here. Propose a concrete next step (one sentence,
    // suitable as an Action Register entry) only when the classification
    // is evaluation_candidate, action, security_review, or requirement_gap.
    system:
      'You are Ember, classifying reviewer feedback on a Workstream Presentation. Every comment must get exactly ' +
      'ONE classification value -- never combine two or more values, and never join them with a slash or any other ' +
      'separator. If a comment could plausibly fit more than one category, pick the single most applicable one.',
    // Caught live: for a SINGLE comment, Gemini's real structured output
    // flattened the "results" array away entirely and renamed fields to
    // snake_case (comment_id/proposed_action) instead of following the
    // zod schema's own camelCase names -- the same root cause
    // journal/generate.ts's own comment already documents ("every field
    // must be spelled out by name in the prompt text itself, or the model
    // invents its own field names"). Spelling out the exact shape and
    // field names in plain English, not just via the schema, fixed it.
    prompt:
      `Classify each comment below.\n\n${commentLines}\n\n` +
      'Respond with exactly this JSON shape, even when there is only one comment: ' +
      '{ "results": [ { "commentId": "...", "classification": "...", "proposedAction": "..." or null }, ... ] }. ' +
      'Always wrap every result in the "results" array. Use exactly these field names: commentId, classification, proposedAction. ' +
      'classification must be a single exact value from this list, never more than one and never slash-joined: ' +
      'question, evaluation_candidate, action, security_review, requirement_gap, approval_signal, scope_change, ' +
      'risk_concern, customer_requirement.',
    schema: ClassificationResultSchema,
    maxOutputTokens: 2048,
  })

  const admin = createAdminClient()
  const commentIds = new Set(comments.map((c) => c.id))
  let actionsCreated = 0
  for (const result of classified.results) {
    if (!commentIds.has(result.commentId)) continue
    await admin.from('presentation_slide_comments').update({ classification: result.classification }).eq('id', result.commentId)
    const actionType = CLASSIFICATION_TO_ACTION_TYPE[result.classification]
    if (actionType && result.proposedAction) {
      await admin.from('presentation_actions').insert({
        presentation_id: version.presentation_id,
        source_comment_id: result.commentId,
        action_text: result.proposedAction,
        type: actionType,
        created_by: ctx.user.id,
      })
      actionsCreated++
    }
  }
  return { classified: classified.results.length, actionsCreated }
}

export async function updatePresentationAction(
  ctx: WorkbenchCallerContext,
  actionId: string,
  patch: { status?: PresentationActionStatus; evidence?: string | null }
): Promise<void> {
  const update: TableUpdate<'presentation_actions'> = {}
  if (patch.status !== undefined) update.status = patch.status
  if (patch.evidence !== undefined) update.evidence = patch.evidence || null

  const { data, error } = await ctx.supabase.from('presentation_actions').update(update).eq('id', actionId).select('id')
  if (error) throw error
  if (!data || data.length === 0) throw new ProjectValidationError('You do not have permission to update this action')
}

// -- Reads --------------------------------------------------------------

export async function getPresentation(ctx: WorkbenchCallerContext, workstreamId: string): Promise<Presentation | null> {
  const { data, error } = await ctx.supabase.from('presentations').select('*').eq('workstream_id', workstreamId).maybeSingle()
  if (error) throw error
  return data
}

export async function getPresentationVersion(ctx: WorkbenchCallerContext, versionId: string): Promise<PresentationVersion | null> {
  const { data, error } = await ctx.supabase.from('presentation_versions').select('*').eq('id', versionId).maybeSingle()
  if (error) throw error
  return data
}

export async function listPresentationVersions(ctx: WorkbenchCallerContext, presentationId: string): Promise<PresentationVersion[]> {
  const { data, error } = await ctx.supabase
    .from('presentation_versions')
    .select('*')
    .eq('presentation_id', presentationId)
    .order('version_number', { ascending: false })
  if (error) throw error
  return data ?? []
}

export async function listSlideComments(ctx: WorkbenchCallerContext, versionId: string): Promise<PresentationSlideComment[]> {
  const { data, error } = await ctx.supabase
    .from('presentation_slide_comments')
    .select('*')
    .eq('presentation_version_id', versionId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export async function listPresentationActions(ctx: WorkbenchCallerContext, presentationId: string): Promise<PresentationAction[]> {
  const { data, error } = await ctx.supabase
    .from('presentation_actions')
    .select('*')
    .eq('presentation_id', presentationId)
    .order('created_at')
  if (error) throw error
  return data ?? []
}

export interface ScheduledPresentationRow {
  presentationId: string
  workstreamId: string
  workstreamName: string
  projectId: string
  projectName: string
  scheduledOpenAt: string
}

// Dashboard widget feed -- naturally scoped by the viewer's own RLS
// visibility (project membership), same as every other dashboard query.
// Two plain queries rather than an embedded select, same reasoning as
// notes.ts's withAuthors: the hand-written Database type's
// Relationships: [] degrades an embedded select's type inference.
export async function listUpcomingScheduledPresentations(supabase: SupabaseClient<Database>): Promise<ScheduledPresentationRow[]> {
  const { data: presentations, error } = await supabase
    .from('presentations')
    .select('id, workstream_id, scheduled_open_at')
    .eq('status', 'draft')
    .not('scheduled_open_at', 'is', null)
    .order('scheduled_open_at', { ascending: true })
    .limit(10)
  if (error) throw error
  if (!presentations || presentations.length === 0) return []

  const workstreamIds = presentations.map((p) => p.workstream_id)
  const { data: workstreams } = await supabase.from('project_workstreams').select('id, project_id, name').in('id', workstreamIds)
  const workstreamById = new Map((workstreams ?? []).map((w) => [w.id, w]))

  const projectIds = [...new Set((workstreams ?? []).map((w) => w.project_id))]
  const { data: projects } = projectIds.length > 0 ? await supabase.from('projects').select('id, name').in('id', projectIds) : { data: [] }
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]))

  return presentations
    .map((p) => {
      const workstream = workstreamById.get(p.workstream_id)
      if (!workstream) return null
      return {
        presentationId: p.id,
        workstreamId: p.workstream_id,
        workstreamName: workstream.name,
        projectId: workstream.project_id,
        projectName: projectNameById.get(workstream.project_id) ?? 'Unknown project',
        scheduledOpenAt: p.scheduled_open_at as string,
      }
    })
    .filter((row): row is ScheduledPresentationRow => row !== null)
}
