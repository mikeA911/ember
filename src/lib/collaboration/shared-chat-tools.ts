import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { SharedProposal, SharedTextFieldName } from './types'

// Shared workspace sessions, Phase 3: the tools Ember has in a shared
// conversation besides search_project_knowledge. Each was reviewed for who
// acts, who sees the result and who confirms (the plan's tool rule):
// - list_workstreams / list_project_members: read-only, and every reader of
//   a shared conversation is an active Project member, who can see all of
//   the Project's workstreams and members anyway.
// - propose_project_note / propose_field_edit: Ember only proposes. The
//   proposal is stored on its answer (so it's hidden wherever the answer
//   is) and a person acts on it with their own rights: one of the pair
//   sends the note as themselves; the person in control puts the text into
//   the shared draft and saves it under the Phase 2 rules. Before either,
//   the app checks every Project member can open the answer's evidence.
// The model-facing validation here is pure, so it's unit-tested.

export const PROPOSE_PROJECT_NOTE_TOOL_NAME = 'propose_project_note'
export const PROPOSE_FIELD_EDIT_TOOL_NAME = 'propose_field_edit'
export const MAX_PROPOSALS = 3

const NoteInput = z.object({
  recipientUserId: z.string().optional(),
  toProjectTeam: z.boolean().optional(),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(4000),
})

const FIELDS = ['project_goal', 'project_objective', 'project_starter_prompt', 'workstream_summary'] as const
const FieldInput = z.object({
  field: z.enum(FIELDS),
  workstreamId: z.string().optional(),
  text: z.string().min(1).max(20000),
})

export const PROPOSE_PROJECT_NOTE_TOOL: ToolSpec = {
  name: PROPOSE_PROJECT_NOTE_TOOL_NAME,
  description:
    "Propose a Project Note for one of the two people working live to send. You do not send it: it appears under your answer with a Send button, and the person who sends it is its author. Address it either to one active member (recipientUserId, from list_project_members in this turn -- never invent one) or to the whole project team (toProjectTeam: true). Only propose a note when someone asks for one.",
  parameters: z.toJSONSchema(NoteInput),
}

export const PROPOSE_FIELD_EDIT_TOOL: ToolSpec = {
  name: PROPOSE_FIELD_EDIT_TOOL_NAME,
  description:
    "Propose new text for one of the Project's fields (project_goal, project_objective = the description, project_starter_prompt) or a workstream's summary (workstream_summary, with workstreamId from list_workstreams). You do not change anything: the person in control can put the text into the shared draft, review it and save. Give the complete new text, not a diff. Only propose when someone asks you to draft or rewrite a field.",
  parameters: z.toJSONSchema(FieldInput),
}

export interface ProposalContext {
  projectId: string
  members: { userId: string; displayLabel: string }[]
  workstreams: { id: string; name: string }[]
}

// Validates a proposal tool call into a stored proposal, or explains what's
// wrong (sent back to the model as the tool result).
export function toProposal(name: string, raw: unknown, ctx: ProposalContext): { proposal: SharedProposal } | { error: string } {
  if (name === PROPOSE_PROJECT_NOTE_TOOL_NAME) {
    const parsed = NoteInput.safeParse(raw)
    if (!parsed.success) return { error: 'A note needs a subject (up to 200 characters) and a body (up to 4000).' }
    const input = parsed.data
    if (input.toProjectTeam) {
      return { proposal: { kind: 'note', recipientType: 'project_team', recipientUserId: null, recipientName: 'the project team', subject: input.subject.trim(), body: input.body.trim() } }
    }
    const member = ctx.members.find((m) => m.userId === input.recipientUserId)
    if (!member) return { error: 'recipientUserId must be an active member from list_project_members, or set toProjectTeam: true.' }
    return { proposal: { kind: 'note', recipientType: 'user', recipientUserId: member.userId, recipientName: member.displayLabel, subject: input.subject.trim(), body: input.body.trim() } }
  }
  if (name === PROPOSE_FIELD_EDIT_TOOL_NAME) {
    const parsed = FieldInput.safeParse(raw)
    if (!parsed.success) return { error: `field must be one of ${FIELDS.join(', ')}, with the complete new text.` }
    const input = parsed.data
    const field: SharedTextFieldName = input.field
    if (field === 'workstream_summary') {
      const ws = ctx.workstreams.find((w) => w.id === input.workstreamId)
      if (!ws) return { error: 'workstream_summary needs a workstreamId from list_workstreams.' }
      return { proposal: { kind: 'field', field, targetId: ws.id, targetName: ws.name, text: input.text.trim() } }
    }
    return { proposal: { kind: 'field', field, targetId: ctx.projectId, targetName: null, text: input.text.trim() } }
  }
  return { error: `${name} isn't a proposal tool.` }
}
