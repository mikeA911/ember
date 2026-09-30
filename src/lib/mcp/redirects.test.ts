import { describe, it, expect } from 'vitest'
import { findApprovedClient, normalizeRedirect, safeNextPath, type ApprovedClientRow } from './redirects'

const approved: ApprovedClientRow[] = [
  { redirect_uri: 'https://claude.ai/api/mcp/auth_callback', label: 'Claude', max_sensitivity: 'internal' },
  { redirect_uri: 'https://chatgpt.com/connector_platform_oauth_redirect', label: 'ChatGPT', max_sensitivity: 'public' },
  { redirect_uri: 'http://localhost/callback', label: 'Claude Code', max_sensitivity: 'internal' },
]

describe('normalizeRedirect', () => {
  it('keeps origin and path, dropping query and fragment', () => {
    expect(normalizeRedirect('https://claude.ai/api/mcp/auth_callback?code=abc&state=xyz#f')).toBe('https://claude.ai/api/mcp/auth_callback')
  })

  it('rejects plain http on a real host, credentials in the URL, and junk', () => {
    expect(normalizeRedirect('http://claude.ai/api/mcp/auth_callback')).toBeNull()
    expect(normalizeRedirect('https://user:pass@claude.ai/api/mcp/auth_callback')).toBeNull()
    expect(normalizeRedirect('javascript:alert(1)')).toBeNull()
    expect(normalizeRedirect('not a url')).toBeNull()
  })
})

describe('findApprovedClient', () => {
  it('matches an exact approved redirect URI, including a full redirect_url carrying the code', () => {
    expect(findApprovedClient('https://claude.ai/api/mcp/auth_callback', approved)?.label).toBe('Claude')
    expect(findApprovedClient('https://chatgpt.com/connector_platform_oauth_redirect?code=1&state=2', approved)?.label).toBe('ChatGPT')
  })

  it('refuses look-alike hosts, paths and subdomains', () => {
    expect(findApprovedClient('https://claude.ai.evil.example/api/mcp/auth_callback', approved)).toBeNull()
    expect(findApprovedClient('https://evil.claude.ai/api/mcp/auth_callback', approved)).toBeNull()
    expect(findApprovedClient('https://claude.ai/api/mcp/auth_callback/extra', approved)).toBeNull()
    expect(findApprovedClient('https://claude.ai:8443/api/mcp/auth_callback', approved)).toBeNull()
  })

  it('lets a loopback entry match any port (local tools), but only on the same loopback host and path', () => {
    expect(findApprovedClient('http://localhost:53682/callback?code=1', approved)?.label).toBe('Claude Code')
    expect(findApprovedClient('http://localhost:53682/other', approved)).toBeNull()
    expect(findApprovedClient('http://127.0.0.1:53682/callback', approved)).toBeNull()
    expect(findApprovedClient('https://localhost:53682/callback', approved)).toBeNull()
  })
})

describe('safeNextPath', () => {
  it('allows same-site paths only', () => {
    expect(safeNextPath('/oauth/consent?authorization_id=abc')).toBe('/oauth/consent?authorization_id=abc')
    expect(safeNextPath('//evil.example')).toBeNull()
    expect(safeNextPath('/\\evil.example')).toBeNull()
    expect(safeNextPath('https://evil.example')).toBeNull()
    expect(safeNextPath(undefined)).toBeNull()
  })
})
