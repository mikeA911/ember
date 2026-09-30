import { NextResponse } from 'next/server'
import { protectedResourceMetadata } from '@/lib/mcp/discovery-metadata'

// Served at both /.well-known/oauth-protected-resource and
// /.well-known/oauth-protected-resource/api/mcp (RFC 9728 path form).
export function GET(request: Request) {
  return NextResponse.json(protectedResourceMetadata(new URL(request.url).origin), {
    headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' },
  })
}
