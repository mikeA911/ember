import 'server-only'
import { AuthError, requireUser } from '@/lib/auth'
import { env } from '@/lib/env'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { findApprovedClient, type ApprovedClientRow } from './redirects'

// Server-side decision for the OAuth consent page (src/app/(auth)/oauth/
// consent). Supabase Auth runs the OAuth 2.1 server and redirects the user
// here with ?authorization_id=; this decides whether Ember will let that
// request through. Called both to render the page and again inside the
// Allow/Deny actions -- the actions never trust what the page showed.

export type ConsentState =
  | { kind: 'disabled' }
  | { kind: 'signed_out' }
  | { kind: 'error'; message: string }
  | { kind: 'unapproved_client'; clientName: string; redirectUri: string }
  | { kind: 'not_allowed'; clientLabel: string; email: string }
  | { kind: 'already_approved'; redirectUrl: string }
  | {
      kind: 'needs_consent'
      authorizationId: string
      clientName: string
      clientLabel: string
      clientUri: string | null
      maxSensitivity: ApprovedClientRow['max_sensitivity']
      email: string
    }

export async function isMcpAllowlisted(ctx: WorkbenchCallerContext): Promise<boolean> {
  if (ctx.profile.role === 'anonymous') return false
  const { data, error } = await ctx.supabase.from('mcp_access_users').select('user_id').eq('user_id', ctx.user.id).maybeSingle()
  if (error) throw error
  return data !== null
}

export async function listApprovedClients(ctx: WorkbenchCallerContext): Promise<ApprovedClientRow[]> {
  const { data, error } = await ctx.supabase.from('mcp_approved_clients').select('redirect_uri, label, max_sensitivity')
  if (error) throw error
  return data ?? []
}

export async function evaluateConsent(authorizationId: string): Promise<{ state: ConsentState; ctx: WorkbenchCallerContext | null }> {
  if (!env.mcpEnabled()) return { state: { kind: 'disabled' }, ctx: null }

  let ctx: WorkbenchCallerContext
  try {
    ctx = await requireUser()
  } catch (err) {
    if (err instanceof AuthError) return { state: { kind: 'signed_out' }, ctx: null }
    throw err
  }

  const { data, error } = await ctx.supabase.auth.oauth.getAuthorizationDetails(authorizationId)
  if (error || !data) {
    return { state: { kind: 'error', message: error?.message ?? 'This sign-in request was not found or has expired.' }, ctx }
  }

  const approved = await listApprovedClients(ctx)
  const allowlisted = await isMcpAllowlisted(ctx)

  // Already consented earlier: Supabase hands back the final redirect
  // straight away. Still apply both checks -- someone removed from the
  // allowlist, or a client whose redirect URI has since been un-approved,
  // must not be waved through on the strength of an old consent.
  if (!('authorization_id' in data)) {
    const client = findApprovedClient(data.redirect_url, approved)
    if (!client) return { state: { kind: 'unapproved_client', clientName: 'Unknown app', redirectUri: data.redirect_url.split('?')[0] }, ctx }
    if (!allowlisted) return { state: { kind: 'not_allowed', clientLabel: client.label, email: ctx.user.email ?? '' }, ctx }
    return { state: { kind: 'already_approved', redirectUrl: data.redirect_url }, ctx }
  }

  const client = findApprovedClient(data.redirect_uri, approved)
  if (!client) {
    return { state: { kind: 'unapproved_client', clientName: data.client.name || 'Unknown app', redirectUri: data.redirect_uri }, ctx }
  }
  if (!allowlisted) return { state: { kind: 'not_allowed', clientLabel: client.label, email: data.user.email }, ctx }

  return {
    state: {
      kind: 'needs_consent',
      authorizationId: data.authorization_id,
      clientName: data.client.name || client.label,
      clientLabel: client.label,
      clientUri: data.client.uri || null,
      maxSensitivity: client.max_sensitivity,
      email: data.user.email,
    },
    ctx,
  }
}
