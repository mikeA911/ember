import 'server-only'
import { env } from '@/lib/env'

// OAuth discovery for the external MCP server (MCP authorization spec,
// RFC 9728 / RFC 8414). Ember is only the *resource server*; Supabase Auth's
// OAuth 2.1 server is the authorization server that signs users in.

export const MCP_PATH = '/api/mcp'

// The issuer Supabase Auth reports in its own metadata.
export function supabaseIssuer(): string {
  return `${env.supabaseUrl().replace(/\/$/, '')}/auth/v1`
}

// Derived from the request, not NEXT_PUBLIC_SITE_URL, so a preview
// deployment advertises itself rather than production.
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}${MCP_PATH}`,
    authorization_servers: [supabaseIssuer()],
    bearer_methods_supported: ['header'],
    resource_name: 'Ember',
    resource_documentation: `${origin}/wiki`,
  }
}

export function resourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_PATH}`
}

// Some MCP clients still look for authorization-server metadata on the MCP
// server's own origin (the 2025-03-26 spec revision). Serve Supabase's
// metadata unchanged -- its issuer and endpoints still point at Supabase.
export async function fetchAuthorizationServerMetadata(): Promise<Record<string, unknown> | null> {
  const base = env.supabaseUrl().replace(/\/$/, '')
  for (const url of [`${base}/.well-known/oauth-authorization-server/auth/v1`, `${base}/auth/v1/.well-known/oauth-authorization-server`]) {
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } })
      if (res.ok) return (await res.json()) as Record<string, unknown>
    } catch {
      // try the next form
    }
  }
  return null
}
