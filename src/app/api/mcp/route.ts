import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { authenticateMcpRequest, logMcpCall } from '@/lib/mcp/access'
import { createMcpServer } from '@/lib/mcp/server'

// Ember's external MCP server (docs/dev-request-ember-external-mcp-server.md,
// setup: docs/guides/ember-mcp-oauth-setup.md). Stateless Streamable HTTP:
// every POST is authenticated on its own and gets a fresh server, so no
// session affinity is needed on serverless hosting.

export const dynamic = 'force-dynamic'

// Unauthenticated probes (the first step of every chatbot's OAuth discovery)
// and the kill switch aren't audit events -- there is no user to attribute.
const UNLOGGED_DENIALS = new Set(['no_token', 'disabled'])

export async function POST(request: Request) {
  const userAgent = request.headers.get('user-agent')
  const auth = await authenticateMcpRequest(request)
  if (!auth.ok) {
    if (!UNLOGGED_DENIALS.has(auth.reason)) {
      await logMcpCall({
        userId: auth.userId,
        clientId: auth.clientId,
        method: 'request',
        status: auth.reason === 'rate_limited' ? 'rate_limited' : 'denied',
        error: auth.reason,
        userAgent,
      })
    }
    return auth.response
  }

  const server = createMcpServer(auth.caller, userAgent)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  try {
    return await transport.handleRequest(request)
  } finally {
    await server.close()
  }
}

function methodNotAllowed() {
  return new Response(JSON.stringify({ error: 'Method not allowed. This MCP server is stateless: use POST.' }), {
    status: 405,
    headers: { 'Content-Type': 'application/json', Allow: 'POST' },
  })
}

export const GET = methodNotAllowed
export const DELETE = methodNotAllowed
