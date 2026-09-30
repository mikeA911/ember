import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AuthError } from '@/lib/auth'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const mcpEnabled = vi.fn()
const requireUser = vi.fn()

vi.mock('@/lib/env', () => ({ env: { mcpEnabled: () => mcpEnabled() } }))
vi.mock('@/lib/auth', async (importOriginal) => ({ ...(await importOriginal<typeof import('@/lib/auth')>()), requireUser: () => requireUser() }))

const { evaluateConsent } = await import('./consent')

const APPROVED = [{ redirect_uri: 'https://claude.ai/api/mcp/auth_callback', label: 'Claude', max_sensitivity: 'internal' }]

function ctxWith(details: unknown, { allowlisted = true, role = 'consultant' } = {}) {
  const supabase = Object.assign(
    createFakeSupabase({
      mcp_approved_clients: [{ data: APPROVED, error: null }],
      mcp_access_users: [{ data: allowlisted ? { user_id: 'user-1' } : null, error: null }],
    }),
    { auth: { oauth: { getAuthorizationDetails: vi.fn().mockResolvedValue({ data: details, error: null }) } } }
  )
  return { user: { id: 'user-1', email: 'b@example.com' }, profile: { role }, supabase }
}

const pending = {
  authorization_id: 'auth-1',
  redirect_uri: 'https://claude.ai/api/mcp/auth_callback',
  client: { id: 'c1', name: 'Claude', uri: 'https://claude.ai', logo_uri: '' },
  user: { id: 'user-1', email: 'b@example.com' },
  scope: 'openid email',
}

beforeEach(() => {
  vi.resetAllMocks()
  mcpEnabled.mockReturnValue(true)
})

describe('evaluateConsent', () => {
  it('refuses everything while the kill switch is off', async () => {
    mcpEnabled.mockReturnValue(false)
    expect((await evaluateConsent('auth-1')).state.kind).toBe('disabled')
    expect(requireUser).not.toHaveBeenCalled()
  })

  it('asks a signed-out user to sign in first', async () => {
    requireUser.mockRejectedValue(new AuthError('Not authenticated'))
    expect((await evaluateConsent('auth-1')).state.kind).toBe('signed_out')
  })

  it('shows consent for an allowlisted user and an approved app, with the app ceiling', async () => {
    requireUser.mockResolvedValue(ctxWith(pending))
    const { state } = await evaluateConsent('auth-1')
    expect(state).toMatchObject({ kind: 'needs_consent', clientLabel: 'Claude', maxSensitivity: 'internal', authorizationId: 'auth-1' })
  })

  it('refuses an app whose redirect URI is not approved, even for an allowlisted user', async () => {
    requireUser.mockResolvedValue(ctxWith({ ...pending, redirect_uri: 'https://claude-ai.example/callback' }))
    expect((await evaluateConsent('auth-1')).state.kind).toBe('unapproved_client')
  })

  it('refuses a user who is not on the allowlist, and an anonymous account', async () => {
    requireUser.mockResolvedValue(ctxWith(pending, { allowlisted: false }))
    expect((await evaluateConsent('auth-1')).state.kind).toBe('not_allowed')
    requireUser.mockResolvedValue(ctxWith(pending, { role: 'anonymous' }))
    expect((await evaluateConsent('auth-1')).state.kind).toBe('not_allowed')
  })

  it('does not wave through an earlier consent once the user has been removed from the allowlist', async () => {
    requireUser.mockResolvedValue(ctxWith({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x&state=y' }, { allowlisted: false }))
    expect((await evaluateConsent('auth-1')).state.kind).toBe('not_allowed')
  })

  it('redirects straight back for an earlier consent that still passes both checks', async () => {
    requireUser.mockResolvedValue(ctxWith({ redirect_url: 'https://claude.ai/api/mcp/auth_callback?code=x&state=y' }))
    expect((await evaluateConsent('auth-1')).state).toEqual({
      kind: 'already_approved',
      redirectUrl: 'https://claude.ai/api/mcp/auth_callback?code=x&state=y',
    })
  })
})
