import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { toCollaborationError } from './errors'

// Shared workspace sessions, Phase 4: the administrators' overview and
// recovery actions (collaboration_admin_* in
// 20261028100001_collaboration_operations.sql). Platform admins only; the
// database refuses everyone else.

type Client = SupabaseClient<Database>

export interface CollaborationOverview {
  since: string
  live: {
    id: string
    conversationId: string
    projectId: string
    projectName: string
    hostName: string
    guestName: string
    controllerName: string
    startedAt: string
    hostPresent: boolean
    guestPresent: boolean
    hostAway: boolean
    guestAway: boolean
    endsAt: string
    overdue: boolean
    endingReason: string
    watching: number
    turnsWaiting: number
    turnRunning: boolean
    openDrafts: number
  }[]
  counts: {
    invitations: Record<string, number>
    sessionsStarted: number
    sessionsEnded: Record<string, number>
    controlChanges: number
    saves: number
    draftsAbandoned: number
    turns: Record<string, number>
    turnsRetried: number
    answerSecondsMedian: number | null
    answerSecondsP90: number | null
    comments: number
    summaries: number
    notesSent: number
  }
  problems: {
    stalledTurns: { id: string; status: 'queued' | 'running'; conversationId: string; projectName: string; requestedByName: string; createdAt: string; attempts: number; leaseExpiresAt: string | null }[]
    failedTurns: { id: string; conversationId: string; projectName: string; requestedByName: string; error: string | null; attempts: number; finishedAt: string }[]
    stuckNotes: { messageId: string; index: number; byName: string; since: string; conversationId: string }[]
    overdueSessions: number
  }
}

export interface CollaborationRollout {
  mode: 'all' | 'selected'
  updatedAt: string | null
  updatedByName: string | null
  projects: { projectId: string; projectName: string; enabled: boolean; updatedAt: string; updatedByName: string | null }[]
  recent: { change: string; projectName: string | null; byName: string | null; at: string }[]
}

async function call<T>(client: Client, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await (client.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw toCollaborationError(error)
  return data as T
}

export const collaborationAdminApi = {
  overview: (c: Client, hours: number) => call<CollaborationOverview>(c, 'collaboration_admin_overview', { p_hours: hours }),
  endSession: (c: Client, sessionId: string) => call<{ status: string }>(c, 'collaboration_admin_end_session', { p_session: sessionId }),
  cancelTurn: (c: Client, turnId: string) => call<{ status: string }>(c, 'collaboration_admin_cancel_turn', { p_turn: turnId }),
  releaseNote: (c: Client, messageId: string, index: number) =>
    call<{ status: string }>(c, 'collaboration_admin_release_note', { p_message: messageId, p_index: index }),
  settleAll: (c: Client) => call<number>(c, 'collaboration_admin_settle_all', {}),
  // Rollout (20261029100001).
  rollout: (c: Client) => call<CollaborationRollout>(c, 'collaboration_admin_rollout', {}),
  setRolloutMode: (c: Client, mode: 'all' | 'selected') => call<CollaborationRollout>(c, 'collaboration_admin_set_rollout_mode', { p_mode: mode }),
  setProjectEnabled: (c: Client, projectId: string, enabled: boolean) =>
    call<CollaborationRollout>(c, 'collaboration_admin_set_project_enabled', { p_project: projectId, p_enabled: enabled }),
}
