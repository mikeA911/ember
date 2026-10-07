import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { ChatMessageRow } from '@/types/database'
import { collaborationApi } from '@/lib/collaboration/api'
import { listMessages } from './conversations'

// Shared workspace sessions, Phase 1 (docs/dev-request-shared-workspace-
// sessions.md): Ember can invite another active member of this Project to
// a live session -- the same invitation as the Project page's Collaborate
// button. Only offered while the feature flag is on, in a project-bound
// conversation.
//
// Two tools, with the confirmation enforced in code like the ontology file
// import: send_collaboration_invitation refuses unless
// preview_collaboration_invitation ran for the same person in an EARLIER
// turn, i.e. the user has sent a message since seeing who would be
// invited. Both go through the caller's own client, so the database checks
// the caller's and the invitee's membership itself; the model only passes
// a user id from list_project_members.

export const PREVIEW_COLLABORATION_INVITATION_TOOL_NAME = 'preview_collaboration_invitation'
export const SEND_COLLABORATION_INVITATION_TOOL_NAME = 'send_collaboration_invitation'

const InputSchema = z.object({ recipientUserId: z.uuid() })

export const PREVIEW_COLLABORATION_INVITATION_TOOL: ToolSpec = {
  name: PREVIEW_COLLABORATION_INVITATION_TOOL_NAME,
  description:
    'Check whether one active member of THIS project can be invited to a live collaboration session, and get their name. recipientUserId must be a userId returned by list_project_members in this conversation -- never invent one. Sends nothing.',
  parameters: z.toJSONSchema(InputSchema),
}

export const SEND_COLLABORATION_INVITATION_TOOL: ToolSpec = {
  name: SEND_COLLABORATION_INVITATION_TOOL_NAME,
  description:
    'Send the live collaboration invitation you previewed with preview_collaboration_invitation to that same person. Only after the user has explicitly confirmed in a message after the preview -- it is refused in the same turn as the preview.',
  parameters: z.toJSONSchema(InputSchema),
}

export class CollaborationInvitationToolError extends Error {}

export async function runPreviewCollaborationInvitation(
  ctx: WorkbenchCallerContext,
  projectId: string,
  rawInput: unknown
): Promise<{ recipientUserId: string; recipientName: string; projectName: string | null; canInvite: boolean; note: string }> {
  const input = InputSchema.parse(rawInput)
  if (!(await collaborationApi.projectEnabled(ctx.supabase, projectId))) {
    throw new CollaborationInvitationToolError(
      "Live collaboration isn't turned on for this Project, so nobody can be invited here. A platform administrator can turn it on (Admin → Live collaboration)."
    )
  }
  const candidates = await collaborationApi.candidates(ctx.supabase, projectId)
  const recipient = candidates.find((c) => c.userId === input.recipientUserId)
  if (!recipient) {
    throw new CollaborationInvitationToolError(
      'That person is not another active member of this project, so they cannot be invited. Call list_project_members again for current members.'
    )
  }
  const { data: project } = await ctx.supabase.from('projects').select('name').eq('id', projectId).maybeSingle()
  return {
    recipientUserId: recipient.userId,
    recipientName: recipient.name,
    projectName: project?.name ?? null,
    canInvite: true,
    note:
      'Nothing has been sent. A live session lets them see the Project and Workstream pages the user opens and ask for control; each person still only sees what their own access allows, and nothing from the user’s private Ember chats is shared. The invitation lasts an hour and they accept or decline it in Ember.',
  }
}

// The preview must be a tool result from before the user's latest message.
export function previewedInEarlierTurn(rows: ChatMessageRow[], recipientUserId: string): boolean {
  let lastUserIndex = -1
  rows.forEach((r, i) => {
    if (r.role === 'user') lastUserIndex = i
  })
  return rows.slice(0, Math.max(lastUserIndex, 0)).some((r) => {
    if (r.role !== 'tool' || r.tool_name !== PREVIEW_COLLABORATION_INVITATION_TOOL_NAME || !r.content) return false
    try {
      const output = JSON.parse(r.content) as { recipientUserId?: string; canInvite?: boolean }
      return output.canInvite === true && output.recipientUserId === recipientUserId
    } catch {
      return false
    }
  })
}

export async function runSendCollaborationInvitation(
  ctx: WorkbenchCallerContext,
  projectId: string,
  conversationId: string,
  rawInput: unknown
): Promise<{ invitationId: string; recipientName: string; status: string; expiresAt: string; note: string }> {
  const input = InputSchema.parse(rawInput)
  const rows = await listMessages(ctx.supabase, conversationId)
  if (!previewedInEarlierTurn(rows, input.recipientUserId)) {
    throw new CollaborationInvitationToolError(
      'Not sent: call preview_collaboration_invitation for this person first, tell the user who would be invited, and only send after they confirm in their next message.'
    )
  }
  const invitation = await collaborationApi.invite(ctx.supabase, {
    projectId,
    inviteeId: input.recipientUserId,
    createdVia: 'assistant',
    assistantConversationId: conversationId,
  })
  return {
    invitationId: invitation.id,
    recipientName: invitation.inviteeName,
    status: invitation.status,
    expiresAt: invitation.expiresAt,
    note: 'Sent. They will see it in a bar at the top of Ember and can accept or decline. When they accept, a live session starts with the user in control; the bar at the top of the page shows it and has the controls. The user can cancel the invitation from that bar.',
  }
}
