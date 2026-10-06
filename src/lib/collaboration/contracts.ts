import { z } from 'zod'

export const collaborationCommand = z.object({
  command: z.enum(['history', 'invite', 'snapshot', 'accept', 'resume', 'join', 'heartbeat', 'request', 'grant', 'decline', 'reclaim', 'navigate', 'leave', 'end']),
  id: z.uuid().optional(),
  project: z.uuid().optional(),
  guest: z.uuid().optional(),
  connection: z.uuid().optional(),
  session: z.uuid().optional(),
  revision: z.number().int().nonnegative().optional(),
  generation: z.number().int().nonnegative().optional(),
  workstream: z.uuid().nullable().optional(),
}).strict()
export type CollaborationCommand = z.infer<typeof collaborationCommand>

export interface SharedHistoryItem {
  id: string
  project_id: string
  project_name: string
  host_id: string
  guest_id: string
  other_name: string
  accepted_at: string | null
  invitation_expires_at: string
}
export interface SharedSnapshot {
  id: string
  project_id: string
  project_name: string
  host_id: string
  guest_id: string
  host_name: string
  guest_name: string
  accepted_at: string | null
  invitation_expires_at: string
  workstreams: { id: string; name: string }[]
  session: {
    id: string
    revision: number
    generation: number
    controller_id: string
    requested_by: string | null
    workstream_id: string | null
    host_online: boolean
    guest_online: boolean
    joined: boolean
  } | null
}
