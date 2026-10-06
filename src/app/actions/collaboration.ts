'use server'

import { requireUser } from '@/lib/auth'
import { collaborationCommand, type SharedSnapshot, type SharedHistoryItem } from '@/lib/collaboration/contracts'

// The RPC rechecks actual membership for both users (no admin bypass) and
// performs row-locked transitions. Never substitute a service-role client.
export async function collaborationAction(input: unknown): Promise<
  { data: SharedSnapshot | SharedHistoryItem[]; error?: never } | { error: string; data?: never }
> {
  if (process.env.NEXT_PUBLIC_EMBER_COLLABORATION !== 'true') return { error: 'Collaboration is not enabled.' }
  const parsed = collaborationCommand.safeParse(input)
  if (!parsed.success) return { error: 'Invalid collaboration request.' }
  const { supabase } = await requireUser()
  const v = parsed.data
  const { data, error } = await supabase.rpc('collaboration_command', {
    p_command: v.command, p_id: v.id, p_project: v.project, p_guest: v.guest,
    p_connection: v.connection, p_revision: v.revision, p_generation: v.generation,
    p_workstream: v.workstream ?? undefined,
    p_session: v.session,
  })
  if (error) {
    // Only return the intentionally authored RPC errors, never database details.
    const safe = [
      'Collaboration access denied', 'Both participants must be active Project members',
      'Invitation is not available', 'Accept the invitation first', 'Join a live session first',
      'This account is already joined in another browser tab', 'Connection expired; rejoin the session',
      'Workspace changed; refresh before retrying', 'Both participants must be connected',
      'Only the host may end the session', 'Only the host may reclaim control',
      'You already have control', 'No control request to grant', 'Request control before navigating',
      'Workstream is outside this Project',
      'Session changed; reopen the conversation',
      'Only the controller may decline a request',
    ]
    return { error: safe.includes(error.message) ? error.message : 'Collaboration is unavailable. Try again later.' }
  }
  return { data: data as SharedSnapshot | SharedHistoryItem[] }
}
