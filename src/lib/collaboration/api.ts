import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { toCollaborationError } from './errors'
import type {
  CollaborationCandidate,
  CollaborationViewer,
  SharedTextFieldName,
  WatchSnapshot,
  CollaborationInvitation,
  CollaborationStatus,
  SessionSnapshot,
  SharedChat,
  SharedEvidence,
  SharedConversationShell,
  SharedConversationSummary,
} from './types'

// Typed calls to the collaboration_* functions. The caller passes the
// signed-in user's own Supabase client (browser or server) -- never the
// admin client: every function identifies the caller from auth.uid().
//
// The browser calls these directly against Supabase rather than through
// Server Actions: Next.js runs a client's Server Actions one at a time, so
// a control handover would otherwise wait behind a long Ember turn, and
// polling would otherwise go through the app server.

type Client = SupabaseClient<Database>

async function call<T>(client: Client, fn: keyof Database['public']['Functions'], args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw toCollaborationError(error)
  return data as T
}

export const collaborationApi = {
  // active: the person used this tab since its last poll.
  status: (c: Client, connection: string | null, session: string | null, active = false) =>
    call<CollaborationStatus>(c, 'collaboration_status', { p_connection: connection, p_session: session, p_active: active }),
  // Phase 4 rollout: whether live collaboration is on for this Project.
  projectEnabled: (c: Client, projectId: string) => call<boolean>(c, 'collaboration_project_enabled', { p_project: projectId }),
  candidates: (c: Client, projectId: string) => call<CollaborationCandidate[]>(c, 'collaboration_candidates', { p_project: projectId }),
  history: (c: Client) => call<SharedConversationSummary[]>(c, 'collaboration_history', {}),
  conversation: (c: Client, conversationId: string) =>
    call<SharedConversationShell>(c, 'collaboration_conversation', { p_conversation: conversationId }),
  invite: (
    c: Client,
    input: { projectId: string; inviteeId: string; conversationId?: string | null; createdVia?: 'ui' | 'assistant'; assistantConversationId?: string | null }
  ) =>
    call<CollaborationInvitation>(c, 'collaboration_invite', {
      p_project: input.projectId,
      p_invitee: input.inviteeId,
      p_conversation: input.conversationId ?? null,
      p_created_via: input.createdVia ?? 'ui',
      p_assistant_conversation: input.assistantConversationId ?? null,
    }),
  cancelInvitation: (c: Client, invitationId: string) =>
    call<CollaborationInvitation>(c, 'collaboration_cancel_invitation', { p_invitation: invitationId }),
  respondInvitation: (c: Client, invitationId: string, accept: boolean, connection: string | null) =>
    call<{ invitation: CollaborationInvitation; sessionId: string | null }>(c, 'collaboration_respond_invitation', {
      p_invitation: invitationId,
      p_accept: accept,
      p_connection: connection,
    }),
  join: (c: Client, sessionId: string, connection: string, takeOver: boolean) =>
    call<SessionSnapshot>(c, 'collaboration_join', { p_session: sessionId, p_connection: connection, p_take_over: takeOver }),
  navigate: (c: Client, sessionId: string, connection: string, generation: number, workstreamId: string | null) =>
    call<SessionSnapshot>(c, 'collaboration_navigate', {
      p_session: sessionId,
      p_connection: connection,
      p_generation: generation,
      p_workstream: workstreamId,
    }),
  requestControl: (c: Client, sessionId: string, connection: string, withdraw: boolean) =>
    call<SessionSnapshot>(c, 'collaboration_request_control', { p_session: sessionId, p_connection: connection, p_withdraw: withdraw }),
  answerControlRequest: (c: Client, sessionId: string, connection: string, generation: number, grant: boolean) =>
    call<SessionSnapshot>(c, 'collaboration_answer_control_request', {
      p_session: sessionId,
      p_connection: connection,
      p_generation: generation,
      p_grant: grant,
    }),
  reclaimControl: (c: Client, sessionId: string, connection: string) =>
    call<SessionSnapshot>(c, 'collaboration_reclaim_control', { p_session: sessionId, p_connection: connection }),
  addViewer: (c: Client, conversationId: string, userId: string) =>
    call<CollaborationViewer[]>(c, 'collaboration_add_viewer', { p_conversation: conversationId, p_user: userId }),
  removeViewer: (c: Client, conversationId: string, userId: string) =>
    call<CollaborationViewer[]>(c, 'collaboration_remove_viewer', { p_conversation: conversationId, p_user: userId }),
  watch: (c: Client, sessionId: string, connection: string) =>
    call<WatchSnapshot>(c, 'collaboration_watch', { p_session: sessionId, p_connection: connection }),
  watchStatus: (c: Client, sessionId: string, connection: string) =>
    call<WatchSnapshot>(c, 'collaboration_watch_status', { p_session: sessionId, p_connection: connection }),
  stopWatching: (c: Client, sessionId: string, connection: string) =>
    call<null>(c, 'collaboration_stop_watching', { p_session: sessionId, p_connection: connection }),
  setDraft: (c: Client, s: { sessionId: string; connection: string; generation: number }, field: SharedTextFieldName, targetId: string, value: string, rebase = false) =>
    call<SessionSnapshot>(c, 'collaboration_set_draft', {
      p_session: s.sessionId,
      p_connection: s.connection,
      p_generation: s.generation,
      p_field: field,
      p_target: targetId,
      p_value: value,
      p_rebase: rebase,
    }),
  discardDraft: (c: Client, s: { sessionId: string; connection: string; generation: number }, field: SharedTextFieldName, targetId: string) =>
    call<SessionSnapshot>(c, 'collaboration_discard_draft', {
      p_session: s.sessionId,
      p_connection: s.connection,
      p_generation: s.generation,
      p_field: field,
      p_target: targetId,
    }),
  saveField: (c: Client, s: { sessionId: string; connection: string; generation: number }, field: SharedTextFieldName, targetId: string, requestId: string) =>
    call<SessionSnapshot>(c, 'collaboration_save_field', {
      p_session: s.sessionId,
      p_connection: s.connection,
      p_generation: s.generation,
      p_field: field,
      p_target: targetId,
      p_request: requestId,
    }),
  setDeliverable: (
    c: Client,
    s: { sessionId: string; connection: string; generation: number },
    workstreamId: string,
    index: number,
    label: string,
    completed: boolean,
    requestId: string
  ) =>
    call<SessionSnapshot>(c, 'collaboration_set_deliverable', {
      p_session: s.sessionId,
      p_connection: s.connection,
      p_generation: s.generation,
      p_workstream: workstreamId,
      p_index: index,
      p_label: label,
      p_completed: completed,
      p_request: requestId,
    }),
  takeControl: (c: Client, sessionId: string, connection: string) =>
    call<SessionSnapshot>(c, 'collaboration_take_control', { p_session: sessionId, p_connection: connection }),
  leave: (c: Client, sessionId: string) => call<SessionSnapshot>(c, 'collaboration_leave', { p_session: sessionId }),
  end: (c: Client, sessionId: string) => call<SessionSnapshot>(c, 'collaboration_end', { p_session: sessionId }),
  // Phase 3: the shared chat.
  chat: (c: Client, conversationId: string) => call<SharedChat>(c, 'collaboration_chat', { p_conversation: conversationId }),
  askEmber: (c: Client, sessionId: string, connection: string, content: string, request: string) =>
    call<{ messageId: string; turnId: string }>(c, 'collaboration_ask_ember', { p_session: sessionId, p_connection: connection, p_content: content, p_request: request }),
  postComment: (c: Client, conversationId: string, content: string, request: string) =>
    call<{ messageId: string }>(c, 'collaboration_post_comment', { p_conversation: conversationId, p_content: content, p_request: request }),
  // Phase 3 completed: what happened to a proposal, and whether every
  // Project member can open some evidence (before it reaches a wider audience).
  updateProposal: (c: Client, messageId: string, index: number, status: 'applied' | 'dismissed') =>
    call<unknown>(c, 'collaboration_update_proposal', { p_message: messageId, p_index: index, p_status: status, p_result: {} }),
  projectAudienceOk: (c: Client, conversationId: string, evidence: SharedEvidence[], requirePrivate: boolean) =>
    call<boolean>(c, 'collaboration_evidence_project_visible', {
      p_conversation: conversationId,
      p_evidence: evidence.map(({ type, id }) => ({ type, id })),
      p_require_private: requirePrivate,
    }),
  // Pass a viewer's comment on to Ember, or ask again after a failed answer.
  queueTurn: (c: Client, sessionId: string, connection: string, messageId: string) =>
    call<{ messageId: string; turnId: string; status: string }>(c, 'collaboration_queue_turn', { p_session: sessionId, p_connection: connection, p_message: messageId }),
}

// Asks the app server to run waiting shared-chat turns (see
// src/app/api/collaboration/turns/route.ts). Safe to call any number of
// times: one turn runs at a time per conversation.
export async function startSharedTurnRunner(conversationId: string): Promise<void> {
  try {
    await fetch('/api/collaboration/turns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId }),
    })
  } catch {
    // The next poll notices the waiting turn and tries again.
  }
}

// Tells the database this tab is closing -- a participant's tab
// (collaboration_disconnect: the other person sees "not connected" straight
// away) or a watcher's (collaboration_stop_watching). Sent from a pagehide
// handler, where an ordinary request may be cut off: a keepalive fetch
// survives the unload. Best effort -- if it never arrives, presence lapses
// after 90 seconds.
export function sendDisconnectBeacon(input: {
  supabaseUrl: string
  anonKey: string
  accessToken: string
  sessionId: string
  connection: string
  fn?: 'collaboration_disconnect' | 'collaboration_stop_watching'
}) {
  try {
    void fetch(`${input.supabaseUrl}/rest/v1/rpc/${input.fn ?? 'collaboration_disconnect'}`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json', apikey: input.anonKey, authorization: `Bearer ${input.accessToken}` },
      body: JSON.stringify({ p_session: input.sessionId, p_connection: input.connection }),
    }).catch(() => {})
  } catch {
    // Unloading: nothing to do.
  }
}
