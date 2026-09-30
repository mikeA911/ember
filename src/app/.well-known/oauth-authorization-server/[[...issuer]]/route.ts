import { NextResponse } from 'next/server'
import { fetchAuthorizationServerMetadata } from '@/lib/mcp/discovery-metadata'

export async function GET() {
  const metadata = await fetchAuthorizationServerMetadata()
  if (!metadata) return NextResponse.json({ error: 'Authorization server metadata unavailable' }, { status: 502 })
  return NextResponse.json(metadata, { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=3600' } })
}
