'use server'

import { requireUser } from '@/lib/auth'
import { runAssistantTurn, type ModelSelection } from '@/lib/chat/loop'
import { getLatestActivityLabel, listRecentConversations, listMessages, toDisplayMessages } from '@/lib/chat/conversations'
import { getProjectContext, describeProjectKnowledgeScope } from '@/lib/chat/project-context'
import { listChatCapableModels, listProviders, listModels } from '@/lib/ai'
import { getAssistantDescriptor } from '@/lib/workbench/assistant-descriptor'
import { parseDocument } from '@/lib/parsing'
import { attachmentMimeType, truncateAttachmentText, MAX_ATTACHMENT_BYTES, type ChatAttachment } from '@/lib/chat/attachments'

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
): Promise<{ attachment: ChatAttachment; error?: never } | { attachment?: never; error: string }> {
  await requireUser()
  const file = formData.get('file')
  if (!(file instanceof File)) return { error: 'No file provided' }
  if (file.size > MAX_ATTACHMENT_BYTES) return { error: 'File exceeds the 5MB attachment limit' }
  const mimeType = attachmentMimeType(file.name)
  if (!mimeType) return { error: 'Unsupported file type (pdf, docx, txt, md, csv only)' }

  try {
    const parsed = await parseDocument(Buffer.from(await file.arrayBuffer()), mimeType)
    const { text, truncated } = truncateAttachmentText(parsed.pages.map((p) => p.text).join('\n\n'))
    if (!text) return { error: 'No readable text found in that file' }
    return { attachment: { name: file.name, text, truncated } }
  } catch {
    return { error: 'Could not read that file' }
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
  return { ...context, knowledgeScope: describeProjectKnowledgeScope(context) }
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
