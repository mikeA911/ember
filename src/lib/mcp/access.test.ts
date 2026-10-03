import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthError } from '@/lib/auth'

const mcpEnabled = vi.fn()
const resolveCaller = vi.fn()
const isAllowlisted = vi.fn()
const listApproved = vi.fn()
const getClient = vi.fn()
const rpc = vi.fn()

vi.mock('@/lib/env', () => ({ env: { mcpEnabled: () => mcpEnabled(), supabaseUrl: () => 'https://proj.supabase.co' } }))
vi.mock('@/lib/workbench/identity', () => ({ resolveCallerIdentityFromToken: (t: string) => resolveCaller(t) }))
vi.mock('./consent', () => ({ isMcpAllowlisted: () => isAllowlisted(), listApprovedClients: () => listApproved() }))
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ auth: { admin: { oauth: { getClient: (id: string) => getClient(id) } } }, rpc: (...a: unknown[]) => rpc(...a) }),
}))

const { authenticateMcpRequest, bearerToken } = await import('./access')

function token(claims: Record<string, unknown>) {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'ES256', typ: 'JWT' })}.${b64({ sub: 'user-1', role: 'authenticated', ...claims })}.sig`
}

function request(auth?: string) {
  return new Request('https://ember.example/api/mcp', { method: 'POST', headers: auth ? { authorization: auth } : {} })
}

const ctx = { user: { id: 'user-1', email: 'b@example.com' }, profile: { role: 'consultant' }, supabase: {} }
const approved = [{ redirect_uri: 'https://claude.ai/api/mcp/auth_callback', label: 'Claude', max_sensitivity: 'internal' }]

let clientSeq = 0
beforeEach(() => {
  vi.resetAllMocks()
  mcpEnabled.mockReturnValue(true)
  resolveCaller.mockResolvedValue(ctx)
  isAllowlisted.mockResolvedValue(true)
  listApproved.mockResolvedValue(approved)
  getClient.mockResolvedValue({ data: { redirect_uris: ['https://claude.ai/api/mcp/auth_callback'] }, error: null })
  rpc.mockResolvedValue({ data: true, error: null })
  clientSeq += 1
})

// A fresh client id per test so access.ts's per-instance client cache never
// carries one test's redirect URIs into the next.
const clientId = () => `client-${clientSeq}`

describe('bearerToken', () => {
  it('extracts a Bearer token and ignores other schemes', () => {
    expect(bearerToken(request('Bearer abc.def.ghi'))).toBe('abc.def.ghi')
    expect(bearerToken(request('Basic abc'))).toBeNull()
    expect(bearerToken(request())).toBeNull()
  })
})

describe('authenticateMcpRequest', () => {
  it('answers 503 when the kill switch is off, before looking at the token', async () => {
    mcpEnabled.mockReturnValue(false)
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: clientId() })}`))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(503)
    expect(resolveCaller).not.toHaveBeenCalled()
  })

  it('answers 401 with resource metadata when there is no token (starts the OAuth flow)', async () => {
    const result = await authenticateMcpRequest(request())
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect(result.response.headers.get('WWW-Authenticate')).toContain(
        'resource_metadata="https://ember.example/.well-known/oauth-protected-resource/api/mcp"'
      )
    }
  })

  it('answers 401 for an expired, revoked or deactivated sign-in', async () => {
    resolveCaller.mockRejectedValue(new AuthError('Not authenticated'))
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: clientId() })}`))
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('refuses a browser session token (no client_id claim), which the database would not treat as read-only', async () => {
    const result = await authenticateMcpRequest(request(`Bearer ${token({})}`))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect(result.reason).toBe('not_oauth_token')
    }
  })

  it('answers 403 for a user not on the allowlist', async () => {
    isAllowlisted.mockResolvedValue(false)
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: clientId() })}`))
    expect(result.ok).toBe(false)
    if (!result.ok) expect([result.response.status, result.reason]).toEqual([403, 'not_allowlisted'])
  })

  it('answers 403 when the OAuth client has no approved redirect URI (e.g. un-approved since sign-in)', async () => {
    getClient.mockResolvedValue({ data: { redirect_uris: ['https://evil.example/callback'] }, error: null })
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: clientId() })}`))
    expect(result.ok).toBe(false)
    if (!result.ok) expect([result.response.status, result.reason]).toEqual([403, 'unapproved_client'])
  })

  it('answers 429 once the rate limit is exceeded', async () => {
    rpc.mockResolvedValue({ data: false, error: null })
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: clientId() })}`))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(429)
      expect(result.response.headers.get('Retry-After')).toBe('60')
    }
  })

  it('returns the caller with the approved app label and sensitivity ceiling', async () => {
    const id = clientId()
    const result = await authenticateMcpRequest(request(`Bearer ${token({ client_id: id })}`))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.caller.clientId).toBe(id)
      expect(result.caller.clientLabel).toBe('Claude')
      expect(result.caller.maxSensitivity).toBe('internal')
      expect(result.caller.ctx).toBe(ctx)
    }
    expect(rpc).toHaveBeenCalledWith('mcp_rate_hit', expect.objectContaining({ p_user_id: 'user-1', p_client_id: id }))
  })
})
