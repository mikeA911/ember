// Pure redirect-URI matching for the external MCP server's OAuth consent
// page. Dynamic client registration lets anyone register an OAuth client
// against Supabase Auth, so an approved *redirect URI* (where the
// authorization code is delivered) is what identifies a trusted chatbot --
// a look-alike client registered with any other redirect URI can never
// receive a code, even if a user is tricked into clicking Allow.

export interface ApprovedClientRow {
  redirect_uri: string
  label: string
  max_sensitivity: 'public' | 'internal' | 'confidential'
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1'])

// Origin + path only: Supabase reports a consent request's redirect_uri
// without query parameters, but an already-consented request comes back as a
// full redirect_url carrying ?code=&state= -- both must compare the same way.
export function normalizeRedirect(uri: string): string | null {
  let url: URL
  try {
    url = new URL(uri)
  } catch {
    return null
  }
  if (url.username || url.password) return null
  if (url.protocol === 'https:') return `${url.origin}${url.pathname}`
  if (url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname)) return `${url.origin}${url.pathname}`
  return null
}

// Exact origin+path match. Loopback entries (local tools like Claude Code,
// which listen on a random port per sign-in) match on any port, per RFC 8252
// section 7.3 -- only ever for localhost/127.0.0.1 over http, never a real host.
export function findApprovedClient(redirectUri: string, approved: ApprovedClientRow[]): ApprovedClientRow | null {
  const target = normalizeRedirect(redirectUri)
  if (!target) return null
  const targetUrl = new URL(target)

  for (const row of approved) {
    const candidate = normalizeRedirect(row.redirect_uri)
    if (!candidate) continue
    if (candidate === target) return row

    const candidateUrl = new URL(candidate)
    if (
      candidateUrl.protocol === 'http:' &&
      LOOPBACK_HOSTS.has(candidateUrl.hostname) &&
      targetUrl.protocol === 'http:' &&
      targetUrl.hostname === candidateUrl.hostname &&
      targetUrl.pathname === candidateUrl.pathname
    ) {
      return row
    }
  }
  return null
}

// Only same-site relative paths survive a login round trip -- never
// "//evil.example" or an absolute URL (open-redirect guard for ?next=).
export function safeNextPath(next: string | null | undefined): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null
  return next
}
