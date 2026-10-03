'use server'

import { revalidatePath } from 'next/cache'
import { requireRole, requireUser } from '@/lib/auth'
import { addMcpAccessUser, removeMcpAccessUser, removeMcpApprovedClient, saveMcpApprovedClient } from '@/lib/mcp/admin'
import type { McpClientSensitivity } from '@/types/database'

// Disconnect an AI app from the caller's own account. Supabase revokes the
// consent, deletes that client's sessions and invalidates its refresh
// tokens; /api/mcp validates every token against the live session, so the
// app's very next call fails.
export async function disconnectAiAppAction(clientId: string) {
  const ctx = await requireUser()
  const { error } = await ctx.supabase.auth.oauth.revokeGrant({ clientId })
  if (error) throw new Error(error.message)
  revalidatePath('/profile')
}

export async function addMcpAccessUserAction(email: string, note: string) {
  const ctx = await requireRole('admin')
  await addMcpAccessUser(ctx, email, note)
  revalidatePath('/admin')
}

export async function removeMcpAccessUserAction(userId: string) {
  const ctx = await requireRole('admin')
  await removeMcpAccessUser(ctx, userId)
  revalidatePath('/admin')
}

export async function saveMcpApprovedClientAction(redirectUri: string, label: string, maxSensitivity: McpClientSensitivity) {
  const ctx = await requireRole('admin')
  if (!['public', 'internal', 'confidential'].includes(maxSensitivity)) throw new Error('Invalid sensitivity level')
  await saveMcpApprovedClient(ctx, { redirectUri, label, maxSensitivity })
  revalidatePath('/admin')
}

export async function removeMcpApprovedClientAction(redirectUri: string) {
  const ctx = await requireRole('admin')
  await removeMcpApprovedClient(ctx, redirectUri)
  revalidatePath('/admin')
}
