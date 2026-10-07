'use server'

import { requireUser } from '@/lib/auth'
import { CollaborationError, toCollaborationError } from '@/lib/collaboration/errors'
import { collaborationEnabled } from '@/lib/collaboration/flag'
import type { SharedEvidence, SharedProposal } from '@/lib/collaboration/types'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ProjectValidationError } from '@/lib/projects/errors'
import { createProjectNote } from '@/lib/projects/notes'

// Shared workspace sessions, Phase 3: acting on what Ember produced in a
// shared chat -- sending a proposed Project note, publishing the summary
// as one. Both run as the signed-in person with their own note rights
// (project_notes' insert policy), after two checks in the database: they
// can read the answer or summary (its read policy), and every active
// Project member can open the evidence it was built from
// (collaboration_evidence_project_visible), since a note reaches more
// people than the conversation. Short calls, so Server Actions are fine
// here (a long Ember turn runs in a Route Handler instead).

type Result = { ok: true; noteId: string } | { ok: false; error: string }

const message = (err: unknown) => (err instanceof CollaborationError ? err.message : toCollaborationError(err as { code?: string; message?: string }).message)

async function rpc<T>(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw toCollaborationError(error)
  return data as T
}

// The shared chat's tables aren't in the generated Database type; read
// them as the caller (their read policies apply) with an untyped client.
async function readRow<T>(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], table: string, columns: string, id: string): Promise<T | null> {
  const { data } = await (supabase as unknown as SupabaseClient).from(table).select(columns).eq('id', id).maybeSingle()
  return (data as T | null) ?? null
}

async function projectOf(supabase: Awaited<ReturnType<typeof requireUser>>['supabase'], conversationId: string): Promise<string> {
  const shell = await rpc<{ projectId: string; myRole: string }>(supabase, 'collaboration_conversation', { p_conversation: conversationId })
  if (shell.myRole !== 'participant') throw new CollaborationError('Only the two people in the conversation can do that.', 'denied')
  return shell.projectId
}

const NOT_COMMON =
  'This drew on sources that not every member of the Project can open, so it can’t go into a Project note. Write the note yourself instead.'

// Sends Ember's proposed note (index on the answer), with the subject and
// body as the person reviewed them. The recipient is the one proposed.
export async function sendProposedNoteAction(input: { messageId: string; index: number; subject: string; body: string }): Promise<Result> {
  if (!collaborationEnabled()) return { ok: false, error: 'Not available.' }
  const ctx = await requireUser()
  try {
    const row = await readRow<{ id: string; conversation_id: string; kind: string; evidence: SharedEvidence[]; proposals: SharedProposal[] }>(
      ctx.supabase,
      'collaboration_messages',
      'id, conversation_id, kind, evidence, proposals',
      input.messageId
    )
    const proposal = row?.proposals?.[input.index]
    if (!row || row.kind !== 'reply' || proposal?.kind !== 'note') return { ok: false, error: 'That proposal isn’t available to you.' }
    const projectId = await projectOf(ctx.supabase, row.conversation_id)
    if (!(await rpc<boolean>(ctx.supabase, 'collaboration_evidence_project_visible', { p_conversation: row.conversation_id, p_evidence: row.evidence }))) {
      return { ok: false, error: NOT_COMMON }
    }
    await rpc(ctx.supabase, 'collaboration_update_proposal', { p_message: row.id, p_index: input.index, p_status: 'sending' })
    try {
      const { noteId } = await createProjectNote(ctx.supabase, ctx.profile, {
        projectId,
        recipientType: proposal.recipientType,
        recipientUserId: proposal.recipientUserId ?? undefined,
        subject: input.subject,
        body: input.body,
      })
      await rpc(ctx.supabase, 'collaboration_update_proposal', { p_message: row.id, p_index: input.index, p_status: 'sent', p_result: { noteId } })
      return { ok: true, noteId }
    } catch (err) {
      const error = err instanceof ProjectValidationError ? err.message : 'The note couldn’t be sent.'
      await rpc(ctx.supabase, 'collaboration_update_proposal', { p_message: row.id, p_index: input.index, p_status: 'failed', p_result: { error } }).catch(() => {})
      return { ok: false, error }
    }
  } catch (err) {
    return { ok: false, error: message(err) }
  }
}

// Publishes the conversation's summary, as reviewed, as a Project note to
// the project team.
export async function publishSummaryAction(input: { conversationId: string; summaryId: string; subject: string; body: string }): Promise<Result> {
  if (!collaborationEnabled()) return { ok: false, error: 'Not available.' }
  const ctx = await requireUser()
  try {
    const projectId = await projectOf(ctx.supabase, input.conversationId)
    const summary = await readRow<{ id: string; conversation_id: string; evidence: SharedEvidence[]; published_note_id: string | null }>(
      ctx.supabase,
      'collaboration_summaries',
      'id, conversation_id, evidence, published_note_id',
      input.summaryId
    )
    if (!summary || summary.conversation_id !== input.conversationId) return { ok: false, error: 'That summary isn’t available to you.' }
    if (summary.published_note_id) return { ok: false, error: 'This summary was already published.' }
    if (!(await rpc<boolean>(ctx.supabase, 'collaboration_evidence_project_visible', { p_conversation: input.conversationId, p_evidence: summary.evidence }))) {
      return { ok: false, error: NOT_COMMON }
    }
    const { noteId } = await createProjectNote(ctx.supabase, ctx.profile, {
      projectId,
      recipientType: 'project_team',
      subject: input.subject,
      body: input.body,
    })
    await rpc(ctx.supabase, 'collaboration_mark_summary_published', { p_summary: summary.id, p_note: noteId })
    return { ok: true, noteId }
  } catch (err) {
    if (err instanceof ProjectValidationError) return { ok: false, error: err.message }
    return { ok: false, error: message(err) }
  }
}
