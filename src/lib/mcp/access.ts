import 'server-only'
import { decodeJwt } from 'jose'
import { AuthError } from '@/lib/auth'
import { env } from '@/lib/env'
import { createAdminClient } from '@/lib/supabase/admin'
import { resolveCallerIdentityFromToken } from '@/lib/workbench/identity'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { McpAccessStatus, McpClientSensitivity } from '@/types/database'
import { isMcpAllowlisted, listApprovedClients } from './consent'
import { findApprovedClient } from './redirects'
import { resourceMetadataUrl } from './discovery-metadata'

// Every /api/mcp request passes through authenticateMcpRequest before any
// tool runs. The chatbot's bearer token is an ordinary Supabase user JWT
// issued by Supabase Auth's OAuth 2.1 server, so the resulting context's
// Supabase client is RLS-scoped to that user AND carries the token's
// client_id claim -- which the restrictive oauth_clients_no_* policies
// (20261003100001_external_mcp_access.sql) turn into database-level
// read-only. The service-role client below is used for exactly three
// things, none of which read project data: looking up the OAuth client's
// registered redirect URIs, the rate-limit counter, and the audit log.

export const RATE_LIMIT_PER_MINUTE = 30
export const RATE_LIMIT_PER_DAY = 500

export interface McpCaller {
  ctx: WorkbenchCallerContext
  clientId: string
  clientLabel: string
  maxSensitivity: McpClientSensitivity
}

type AuthResult = { ok: true; caller: McpCaller } | { ok: false; response: Response; userId: string | null; clientId: string | null; reason: string }

function jsonError(status: number, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: message }), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

function unauthorized(origin: string, message: string, error = 'invalid_token') {
  return jsonError(401, message, {
    'WWW-Authenticate': `Bearer error="${error}", error_description="${message}", resource_metadata="${resourceMetadataUrl(origin)}"`,
  })
}

export function bearerToken(request: Request): string | null {
  const header = request.headers.get('authorization')
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  return match ? match[1] : null
}

// OAuth client -> its registered redirect URIs, cached briefly per server
// instance: an admin-API round trip on every tool call would dominate
// latency, and a client's redirect URIs don't change after registration.
const clientCache = new Map<string, { redirectUris: string[]; expires: number }>()
const CLIENT_CACHE_MS = 5 * 60 * 1000

async function registeredRedirectUris(clientId: string): Promise<string[]> {
  const cached = clientCache.get(clientId)
  if (cached && cached.expires > Date.now()) return cached.redirectUris
  const { data, error } = await createAdminClient().auth.admin.oauth.getClient(clientId)
  if (error || !data) return []
  clientCache.set(clientId, { redirectUris: data.redirect_uris ?? [], expires: Date.now() + CLIENT_CACHE_MS })
  return data.redirect_uris ?? []
}

export async function authenticateMcpRequest(request: Request): Promise<AuthResult> {
  const origin = new URL(request.url).origin
  const deny = (response: Response, reason: string, userId: string | null = null, clientId: string | null = null): AuthResult => ({
    ok: false,
    response,
    userId,
    clientId,
    reason,
  })

  if (!env.mcpEnabled()) return deny(jsonError(503, 'Ember MCP access is turned off on this deployment.'), 'disabled')

  const token = bearerToken(request)
  if (!token) return deny(unauthorized(origin, 'Sign in to Ember to use this connector.', 'invalid_request'), 'no_token')

  // getUser() (inside resolveCallerIdentityFromToken) validates the token
  // with Supabase Auth itself, including that its session still exists --
  // so a grant revoked from the Profile page stops working immediately,
  // not when the access token would have expired.
  let ctx: WorkbenchCallerContext
  try {
    ctx = await resolveCallerIdentityFromToken(token)
  } catch (err) {
    if (err instanceof AuthError) return deny(unauthorized(origin, 'Your Ember sign-in has expired or was revoked. Reconnect the app.'), 'invalid_token')
    throw err
  }

  // Safe to read unverified now: getUser() just verified this exact token.
  const claims = decodeJwt(token)
  const clientId = typeof claims.client_id === 'string' ? claims.client_id : null
  // Only tokens issued to an OAuth client are accepted. A browser session
  // token has no client_id, so the database's read-only policies wouldn't
  // apply to it -- refuse it here rather than rely on the tools alone.
  if (!clientId) {
    return deny(unauthorized(origin, 'This endpoint only accepts sign-ins made through an approved AI app.'), 'not_oauth_token', ctx.user.id)
  }

  if (!(await isMcpAllowlisted(ctx))) {
    return deny(jsonError(403, 'AI app access is not enabled for your Ember account. Ask an Ember administrator.'), 'not_allowlisted', ctx.user.id, clientId)
  }

  const approved = await listApprovedClients(ctx)
  const client = (await registeredRedirectUris(clientId)).map((uri) => findApprovedClient(uri, approved)).find((c) => c !== null) ?? null
  if (!client) {
    return deny(jsonError(403, 'This AI app is no longer approved for Ember.'), 'unapproved_client', ctx.user.id, clientId)
  }

  const { data: withinLimit, error: rateError } = await createAdminClient().rpc('mcp_rate_hit', {
    p_user_id: ctx.user.id,
    p_client_id: clientId,
    p_minute_limit: RATE_LIMIT_PER_MINUTE,
    p_day_limit: RATE_LIMIT_PER_DAY,
  })
  if (rateError) throw rateError
  if (!withinLimit) {
    return deny(
      jsonError(429, `Too many requests. Limits are ${RATE_LIMIT_PER_MINUTE} per minute and ${RATE_LIMIT_PER_DAY} per day.`, { 'Retry-After': '60' }),
      'rate_limited',
      ctx.user.id,
      clientId
    )
  }

  return { ok: true, caller: { ctx, clientId, clientLabel: client.label, maxSensitivity: client.max_sensitivity } }
}

export interface McpLogEntry {
  userId: string | null
  clientId: string | null
  method: string
  tool?: string | null
  projectId?: string | null
  argsSummary?: string | null
  resultCount?: number | null
  withheldCount?: number | null
  status: McpAccessStatus
  error?: string | null
  latencyMs?: number | null
  userAgent?: string | null
}

// Best-effort: an audit-write failure is logged loudly but never turns a
// successful read into an error for the user.
export async function logMcpCall(entry: McpLogEntry): Promise<void> {
  const { error } = await createAdminClient()
    .from('mcp_access_log')
    .insert({
      user_id: entry.userId,
      client_id: entry.clientId,
      method: entry.method,
      tool: entry.tool ?? null,
      project_id: entry.projectId ?? null,
      args_summary: entry.argsSummary ? entry.argsSummary.slice(0, 300) : null,
      result_count: entry.resultCount ?? null,
      withheld_count: entry.withheldCount ?? null,
      status: entry.status,
      error: entry.error ? entry.error.slice(0, 500) : null,
      latency_ms: entry.latencyMs ?? null,
      user_agent: entry.userAgent ? entry.userAgent.slice(0, 200) : null,
    })
  if (error) console.error('mcp_access_log insert failed', error)
}
