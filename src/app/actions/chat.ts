'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, AuthError } from '@/lib/auth'
import { runAssistantTurn, type ModelSelection } from '@/lib/chat/loop'
import { getLatestActivityLabel, listRecentConversations, listMessages, toDisplayMessages } from '@/lib/chat/conversations'
import { getProjectContext, describeProjectKnowledgeScope } from '@/lib/chat/project-context'
import { aiHostingForProject, listChatCapableModels, listProviders, listModels } from '@/lib/ai'
import { getAssistantDescriptor } from '@/lib/workbench/assistant-descriptor'
import { createWorkingKnowledgeItem } from '@/lib/projects/working-knowledge'
import { ProjectValidationError } from '@/lib/projects/errors'
import { conversationToTranscript, isTranscriptRow, messagePreview } from '@/lib/chat/transcript'
import {
  isZipFileName,
  findingsContentForAttachment,
  findingsNotesForAttachment,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_CHARS,
  totalAttachmentChars,
  type ChatAttachment,
} from '@/lib/chat/attachments'
import { attachArtifact } from '@/lib/workbench/workstreams'
import { getActiveProjectRole } from '@/lib/workbench/context'
import { listWorkstreams } from '@/lib/projects/workstreams'
import { readAttachmentFile, AttachmentReadError } from '@/lib/chat/attachment-reader'
import { readZipAttachments, ZipAttachmentError } from '@/lib/chat/zip-attachments'

// projectId is only consulted for a brand-new conversation (conversationId
// null) -- see runAssistantTurn's own comment. Passing it for an existing
// conversation is harmless (ignored), not an error, since binding is
// immutable at the DB level regardless.
export async function sendChatMessageAction(
  conversationId: string | null,
  message: string,
  modelSelection?: ModelSelection,
  projectId?: string | null
) {
  const ctx = await requireUser()
  return runAssistantTurn(ctx, conversationId, message, modelSelection, projectId)
}

// Ember composer's "Attach file" -- parse only, nothing is stored; the
// returned text rides along in the next sendChatMessageAction message (see
// src/lib/chat/attachments.ts). Validation failures come back as a value,
// not a throw, so the reason survives Next's production error masking.
export async function extractChatAttachmentAction(
  formData: FormData
): Promise<{ attachments: ChatAttachment[]; skipped: string[]; error?: never } | { attachments?: never; skipped?: never; error: string }> {
  await requireUser()
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file provided' }
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: 'File exceeds the 5MB attachment limit' }

  const bytes = Buffer.from(await file.arrayBuffer())
  if (isZipFileName(file.name)) {
    try {
      return await readZipAttachments(bytes)
    } catch (err) {
      return { error: err instanceof ZipAttachmentError ? err.message : 'Could not read that zip file' }
    }
  }

  try {
    return { attachments: [await readAttachmentFile(file.name, bytes)], skipped: [] }
  } catch (err) {
    return { error: err instanceof AttachmentReadError ? `This file ${err.message}` : 'Could not read that file' }
  }
}

// Files attached in a project chat can also be saved as Findings artifacts
// in one of the project's workstreams, so they don't only live inside the
// conversation -- and from there can be submitted to a knowledge base or
// drafted into a Wiki article like any other artifact. Saving needs the same
// project role as attaching evidence anywhere (workstream_artifacts'
// insert RLS: owner, curator or consultant, or platform admin), so the
// composer only offers it when canSave.
export async function listFindingsTargetsAction(
  projectId: string
): Promise<{ canSave: boolean; workstreams: { id: string; name: string }[] }> {
  const ctx = await requireUser()
  const role = ctx.profile.role === 'admin' ? 'admin' : await getActiveProjectRole(ctx, projectId)
  const canSave = role === 'admin' || role === 'owner' || role === 'curator' || role === 'consultant'
  if (!canSave) return { canSave: false, workstreams: [] }
  const workstreams = await listWorkstreams(ctx.supabase, projectId)
  return { canSave, workstreams: workstreams.map((w) => ({ id: w.id, name: w.name })) }
}

export async function saveAttachmentsAsFindingsAction(input: {
  projectId: string
  workstreamId: string
  attachments: ChatAttachment[]
}): Promise<{ saved: number; workstreamName: string; error?: never } | { saved?: never; workstreamName?: never; error: string }> {
  const ctx = await requireUser()
  if (input.attachments.length === 0) return { error: 'Nothing to save' }
  if (totalAttachmentChars(input.attachments) > MAX_TOTAL_ATTACHMENT_CHARS) return { error: 'Attachments are too large to save together' }

  const { data: workstream } = await ctx.supabase.from('project_workstreams').select('id, name, project_id').eq('id', input.workstreamId).maybeSingle()
  if (!workstream || workstream.project_id !== input.projectId) return { error: 'That workstream is not in this project' }

  let saved = 0
  try {
    for (const attachment of input.attachments) {
      await attachArtifact(ctx, {
        workstreamId: workstream.id,
        artifactType: 'findings',
        title: attachment.name.split('/').pop() || attachment.name,
        content: findingsContentForAttachment(attachment),
        notes: findingsNotesForAttachment(attachment),
      })
      saved++
    }
  } catch (err) {
    const reason =
      err instanceof AuthError || err instanceof ProjectValidationError
        ? err.message
        : err && typeof err === 'object' && 'code' in err && err.code === '42501'
          ? "Saving files to a workstream needs this project's owner, curator or consultant role"
          : 'Could not save the files'
    return { error: saved > 0 ? `${reason} (${saved} of ${input.attachments.length} were saved)` : reason }
  }
  revalidatePath(`/projects/${input.projectId}/workstreams/${workstream.id}`)
  revalidatePath(`/projects/${input.projectId}`)
  return { saved, workstreamName: workstream.name }
}

// Ember header's "Save as note" -- the whole visible conversation becomes a
// private Working Knowledge working_note in the chosen project, through the
// same createWorkingKnowledgeItem path (and RLS: owner + strict project
// member) as the project page's own note form and Ember's
// save_working_knowledge tool. Errors come back as a value, same reason as
// extractChatAttachmentAction above.
//
// The picker lists the same rows the transcript would include, by id, so
// what the user ticks is exactly what gets saved.
export async function listConversationNoteMessagesAction(
  conversationId: string
): Promise<{ id: string; role: 'user' | 'assistant'; preview: string }[]> {
  const ctx = await requireUser()
  // RLS scopes chat_messages to the caller's own conversation.
  const rows = await listMessages(ctx.supabase, conversationId)
  return rows.filter(isTranscriptRow).map((r) => ({ id: r.id, role: r.role, preview: messagePreview(r.content) }))
}

export async function saveConversationAsNoteAction(input: {
  conversationId: string
  projectId: string
  title: string
  messageIds: string[]
}): Promise<{ itemId: string; error?: never } | { itemId?: never; error: string }> {
  const ctx = await requireUser()
  // RLS only returns the caller's own conversation.
  const { data: conversation } = await ctx.supabase.from('conversations').select('id').eq('id', input.conversationId).maybeSingle()
  if (!conversation) return { error: 'Conversation not found' }

  const selected = new Set(input.messageIds)
  const rows = (await listMessages(ctx.supabase, input.conversationId)).filter((r) => selected.has(r.id))
  const content = conversationToTranscript(rows)
  if (!content) return { error: 'Pick at least one message to save' }

  try {
    const { itemId } = await createWorkingKnowledgeItem(ctx.supabase, { id: ctx.user.id, role: ctx.profile.role }, {
      projectId: input.projectId,
      type: 'working_note',
      title: input.title,
      content,
      sourceConversationId: input.conversationId,
    })
    revalidatePath(`/projects/${input.projectId}`)
    return { itemId }
  } catch (err) {
    if (err instanceof AuthError || err instanceof ProjectValidationError) return { error: err.message }
    if (err && typeof err === 'object' && 'code' in err && err.code === '42501') {
      return { error: 'You can only save notes to a project you are a member of' }
    }
    return { error: 'Could not save the note' }
  }
}

export async function listChatModelsAction() {
  const ctx = await requireUser()
  return listChatCapableModels(ctx.supabase)
}

// RLS (chat_messages_owner) already scopes this to the caller's own
// conversation -- a mismatched/foreign conversationId just returns null,
// no separate ownership check needed here.
export async function getChatActivityAction(conversationId: string) {
  const ctx = await requireUser()
  return getLatestActivityLabel(ctx.supabase, conversationId)
}

// Durable "is a turn still in flight" check, surviving a page refresh --
// see runAssistantTurn's set/clear of pending_turn_started_at. ChatPanel
// polls this after resuming a conversation whose last-known state was
// mid-turn, instead of only trusting its own in-memory isPending (which a
// remount always resets to false regardless of what's actually happening
// server-side).
export async function getConversationPendingStatusAction(conversationId: string) {
  const ctx = await requireUser()
  const { data } = await ctx.supabase.from('conversations').select('pending_turn_started_at').eq('id', conversationId).maybeSingle()
  return data?.pending_turn_started_at ?? null
}

// An empty result is the first-use signal ChatPanel checks for. Global
// history -- every conversation of the caller's, project-bound or not.
export async function listRecentConversationsAction() {
  const ctx = await requireUser()
  return listRecentConversations(ctx.supabase, ctx.user.id)
}

// The project page's own "recent conversations" list -- this project's
// conversations only, so a member can resume one instead of always starting
// fresh. RLS (conversations_owner) already scopes this to the caller's own
// conversations; a project a caller can't see just yields nothing shareable
// to navigate to, not a leak.
export async function listProjectConversationsAction(projectId: string) {
  const ctx = await requireUser()
  return listRecentConversations(ctx.supabase, ctx.user.id, { projectId })
}

// Backs the project-scoped ChatPanel's banner ("this project knows about
// X, Y") -- same is_project_member bar as viewing the project page itself.
// Returns null for a project the caller can't see (RLS-driven, same as
// every other resolver in this app) rather than throwing.
export async function getProjectContextAction(projectId: string) {
  const ctx = await requireUser()
  const context = await getProjectContext(ctx, projectId)
  if (!context) return null
  // 'self_hosted_only' for a Live client Project -- the chat
  // panel then offers only Sandz-hosted models and shows a badge; the loop
  // enforces it regardless (src/lib/ai/hosting-policy.ts).
  return { ...context, knowledgeScope: describeProjectKnowledgeScope(context), aiHosting: await aiHostingForProject(projectId) }
}

// RLS scopes listMessages to the caller's own conversation -- a
// mismatched/foreign conversationId just returns an empty array, which
// ChatPanel treats as "gracefully show nothing," not an error.
export async function getConversationMessagesAction(conversationId: string) {
  const ctx = await requireUser()
  const [rows, providers, models] = await Promise.all([
    listMessages(ctx.supabase, conversationId),
    listProviders(ctx.supabase),
    listModels(ctx.supabase),
  ])
  const providerNameById = new Map(providers.map((p) => [p.id, p]))
  const displayNameByKey = new Map(
    models.map((m) => {
      const provider = providerNameById.get(m.provider_id)
      return [
        `${provider?.name}::${m.model_id}`,
        { providerDisplayName: provider?.display_name ?? provider?.name ?? 'Unknown provider', modelDisplayName: m.display_name },
      ] as const
    })
  )
  return toDisplayMessages(rows, displayNameByKey, ctx)
}

// Ordinary-user-safe subset of the Assistant descriptor, for the chat
// panel's compact "How this Assistant works" popover. Deliberately never
// includes tool parametersSchema, the raw system prompt text, or
// enforcedBy provenance strings -- those are curator/admin-only and only
// ever shown on the full /agents/workbench-assistant page, not here.
export async function getAssistantOverviewAction() {
  await requireUser()
  const descriptor = getAssistantDescriptor()
  return {
    name: descriptor.name,
    purpose: descriptor.purpose,
    promptVersion: descriptor.promptVersion,
    plainLanguageExplanation: descriptor.plainLanguageExplanation,
    tools: descriptor.tools.map((t) => ({ name: t.name, description: t.description })),
    guardrails: descriptor.guardrails.map((g) => ({ label: g.label, description: g.description })),
  }
}
