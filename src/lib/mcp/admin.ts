import 'server-only'
import { AuthError } from '@/lib/auth'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { McpAccessLogEntry, McpApprovedClient, McpClientSensitivity } from '@/types/database'
import { normalizeRedirect } from './redirects'

// Managing who may connect an AI app to Ember's MCP server, and which apps.
// Every write goes through the caller's own RLS client -- the
// mcp_access_users / mcp_approved_clients policies (is_admin) are the real
// gate; requireAdmin only gives a clearer error than an empty RLS result.

function requireAdmin(ctx: WorkbenchCallerContext) {
  if (ctx.profile.role !== 'admin') throw new AuthError('Requires admin role')
}

export interface McpAccessUserRow {
  userId: string
  email: string | null
  note: string | null
  createdAt: string
}

export async function listMcpAccessUsers(ctx: WorkbenchCallerContext): Promise<McpAccessUserRow[]> {
  requireAdmin(ctx)
  const { data, error } = await ctx.supabase.from('mcp_access_users').select('user_id, note, created_at').order('created_at')
  if (error) throw error
  const ids = (data ?? []).map((r) => r.user_id)
  const { data: profiles } = ids.length ? await ctx.supabase.from('profiles').select('id, email').in('id', ids) : { data: [] }
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))
  return (data ?? []).map((r) => ({ userId: r.user_id, email: emailById.get(r.user_id) ?? null, note: r.note, createdAt: r.created_at }))
}

export async function addMcpAccessUser(ctx: WorkbenchCallerContext, email: string, note: string | null): Promise<void> {
  requireAdmin(ctx)
  const { data: profile, error } = await ctx.supabase.from('profiles').select('id, role, is_active').ilike('email', email.trim()).maybeSingle()
  if (error) throw error
  if (!profile) throw new Error(`No Ember account found for ${email.trim()}`)
  if (profile.role === 'anonymous') throw new Error('Anonymous accounts cannot connect AI apps')
  if (!profile.is_active) throw new Error('That account is deactivated')
  const { error: insertError } = await ctx.supabase
    .from('mcp_access_users')
    .upsert({ user_id: profile.id, note: note?.trim() || null, added_by: ctx.user.id }, { onConflict: 'user_id', ignoreDuplicates: true })
  if (insertError) throw insertError
}

export async function removeMcpAccessUser(ctx: WorkbenchCallerContext, userId: string): Promise<void> {
  requireAdmin(ctx)
  const { error } = await ctx.supabase.from('mcp_access_users').delete().eq('user_id', userId)
  if (error) throw error
}

export async function listMcpApprovedClients(ctx: WorkbenchCallerContext): Promise<McpApprovedClient[]> {
  const { data, error } = await ctx.supabase.from('mcp_approved_clients').select('*').order('label')
  if (error) throw error
  return data ?? []
}

export async function saveMcpApprovedClient(
  ctx: WorkbenchCallerContext,
  input: { redirectUri: string; label: string; maxSensitivity: McpClientSensitivity }
): Promise<void> {
  requireAdmin(ctx)
  const normalized = normalizeRedirect(input.redirectUri.trim())
  if (!normalized) throw new Error('Redirect URI must be an https:// URL (or http://localhost for a local tool)')
  if (!input.label.trim()) throw new Error('Label is required')
  const { error } = await ctx.supabase
    .from('mcp_approved_clients')
    .upsert({ redirect_uri: normalized, label: input.label.trim(), max_sensitivity: input.maxSensitivity, created_by: ctx.user.id }, { onConflict: 'redirect_uri' })
  if (error) throw error
}

export async function removeMcpApprovedClient(ctx: WorkbenchCallerContext, redirectUri: string): Promise<void> {
  requireAdmin(ctx)
  const { error } = await ctx.supabase.from('mcp_approved_clients').delete().eq('redirect_uri', redirectUri)
  if (error) throw error
}

export interface McpActivityRow extends Pick<McpAccessLogEntry, 'id' | 'tool' | 'status' | 'args_summary' | 'result_count' | 'withheld_count' | 'created_at' | 'error'> {
  email: string | null
}

// RLS limits a non-admin to their own rows; an admin sees everyone's.
export async function listMcpActivity(ctx: WorkbenchCallerContext, opts: { ownOnly: boolean; limit?: number }): Promise<McpActivityRow[]> {
  let query = ctx.supabase
    .from('mcp_access_log')
    .select('id, user_id, tool, status, args_summary, result_count, withheld_count, created_at, error')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 25)
  if (opts.ownOnly) query = query.eq('user_id', ctx.user.id)
  const { data, error } = await query
  if (error) throw error
  const ids = [...new Set((data ?? []).map((r) => r.user_id).filter((id): id is string => !!id))]
  const { data: profiles } = ids.length ? await ctx.supabase.from('profiles').select('id, email').in('id', ids) : { data: [] }
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))
  return (data ?? []).map(({ user_id, ...row }) => ({ ...row, email: user_id ? (emailById.get(user_id) ?? null) : null }))
}
