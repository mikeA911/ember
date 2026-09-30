import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

// End to end through the real MCP SDK on both sides: the SDK client speaks
// Streamable HTTP to this route's POST handler (no network), so this proves
// the stateless server answers initialize, tools/list and tools/call, and
// that every tool call is audited. Authentication itself is covered by
// src/lib/mcp/access.test.ts.

const authenticate = vi.fn()
const logMcpCall = vi.fn()

vi.mock('@/lib/env', () => ({ env: { siteUrl: () => 'https://ember.example', mcpEnabled: () => true } }))
vi.mock('@/lib/mcp/access', () => ({
  authenticateMcpRequest: (...a: unknown[]) => authenticate(...a),
  logMcpCall: (...a: unknown[]) => logMcpCall(...a),
}))

const { POST, GET } = await import('./route')

const caller = {
  ctx: { user: { id: 'user-1', email: 'builder@example.com' }, profile: { role: 'consultant' }, supabase: {} },
  clientId: 'client-1',
  clientLabel: 'Claude',
  maxSensitivity: 'internal',
}

function connect() {
  const fetchViaRoute = async (input: string | URL | Request, init?: RequestInit) => {
    const req = input instanceof Request ? input : new Request(input, init)
    return req.method === 'POST' ? POST(req) : GET()
  }
  const transport = new StreamableHTTPClientTransport(new URL('https://ember.example/api/mcp'), { fetch: fetchViaRoute })
  const client = new Client({ name: 'test-client', version: '0.0.0' })
  return { client, transport }
}

beforeEach(() => {
  vi.resetAllMocks()
  authenticate.mockResolvedValue({ ok: true, caller })
})

describe('/api/mcp', () => {
  it('initializes, lists only the read-only tools, and answers a tool call', async () => {
    const { client, transport } = connect()
    await client.connect(transport)
    expect(client.getInstructions()).toMatch(/READ-ONLY/)

    const { tools } = await client.listTools()
    expect(tools.map((t) => t.name)).toContain('get_project_summary')
    expect(tools.map((t) => t.name)).not.toContain('create_project')
    expect(tools.every((t) => t.annotations?.readOnlyHint === true)).toBe(true)

    const result = await client.callTool({ name: 'whoami', arguments: {} })
    const text = (result.content as { type: string; text: string }[])[0].text
    expect(JSON.parse(text)).toMatchObject({ email: 'builder@example.com', connectedApp: 'Claude', access: 'read-only', maxSensitivity: 'internal' })
    expect(logMcpCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'whoami', status: 'ok', userId: 'user-1', clientId: 'client-1' }))
    await client.close()
  })

  it('reports an unknown (e.g. write) tool as an error, and audits it as denied', async () => {
    const { client, transport } = connect()
    await client.connect(transport)
    const result = await client.callTool({ name: 'create_project', arguments: { name: 'x' } })
    expect(result.isError).toBe(true)
    expect(logMcpCall).toHaveBeenCalledWith(expect.objectContaining({ tool: 'create_project', status: 'denied' }))
    await client.close()
  })

  it('returns the authentication response untouched when the caller is refused', async () => {
    authenticate.mockResolvedValue({ ok: false, reason: 'not_allowlisted', userId: 'user-1', clientId: 'client-1', response: new Response('{}', { status: 403 }) })
    const res = await POST(new Request('https://ember.example/api/mcp', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(403)
    expect(logMcpCall).toHaveBeenCalledWith(expect.objectContaining({ status: 'denied', error: 'not_allowlisted' }))
  })

  it('does not audit unauthenticated discovery probes', async () => {
    authenticate.mockResolvedValue({ ok: false, reason: 'no_token', userId: null, clientId: null, response: new Response('{}', { status: 401 }) })
    const res = await POST(new Request('https://ember.example/api/mcp', { method: 'POST', body: '{}' }))
    expect(res.status).toBe(401)
    expect(logMcpCall).not.toHaveBeenCalled()
  })

  it('refuses GET (no server-sent event stream in stateless mode)', async () => {
    expect(GET().status).toBe(405)
  })
})
