// A stand-in AI model for the local end-to-end stack: OpenAI-compatible
// /v1/chat/completions and /v1/embeddings on localhost, with predictable
// answers, so the shared Ember chat (Phase 3) can be exercised without a
// real model or any network. Local use only.
//
//   FAKE_MODEL_PORT=54340 node scripts/local-e2e/fake-model.mjs
//
// Point the app at it: the default chat provider's base_url (an
// openai_compatible/groq row in the LOCAL database) set to
// http://localhost:54340/v1 with any API key, and OPENAI_BASE_URL for
// embeddings. Behaviour, from the latest user message:
// - contains "search": first calls search_project_knowledge, then answers
//   saying how many results came back;
// - contains "slow": answers after 4 seconds;
// - contains "fail once": the first attempt fails (HTTP 500 to the SDK's
//   first request and its two automatic retries), the next one answers;
// - contains "propose a note" / "propose a goal": first calls
//   propose_project_note (to the project team) / propose_field_edit
//   (the Project goal), then answers;
// - a summary request (a single message starting "There is no summary
//   yet." or "Summary so far"): "Test summary of N earlier messages.";
// - otherwise answers at once: Test answer to "<first line of the question>".
// Every answer says how many earlier answers it was shown (to check what
// reached the model), and GET /log lists the requests received.
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_MODEL_PORT ?? 54340)
// Failed requests per question (the OpenAI SDK retries a 500 twice).
const failures = new Map()
const log = []

function lastUser(messages) {
  for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'user') return { index: i, text: String(messages[i].content ?? '') }
  return { index: -1, text: '' }
}
// The question without its "[Name]" label line.
function question(text) {
  const lines = text.split('\n').filter((l) => l.trim() && !/^\[.*\]$/.test(l.trim()) && !/^\(.*passed this comment on/.test(l.trim()))
  return (lines[0] ?? '').trim()
}

function completion(model, message) {
  return {
    id: `fake-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
  }
}

const server = createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && req.url === '/log') return send(200, log)
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : {}

  if (req.url?.endsWith('/embeddings')) {
    // The request's dimensions, else the vector columns' size.
    const dims = body.dimensions ?? Number(process.env.FAKE_EMBED_DIMS ?? 1536)
    const values = Array.from({ length: dims }, () => 0.01)
    // The OpenAI SDK asks for base64 (little-endian float32) unless told otherwise.
    const embedding = body.encoding_format === 'base64' ? Buffer.from(new Float32Array(values).buffer).toString('base64') : values
    return send(200, { object: 'list', data: [{ object: 'embedding', index: 0, embedding }], model: body.model, usage: { prompt_tokens: 1, total_tokens: 1 } })
  }
  if (!req.url?.endsWith('/chat/completions')) return send(404, { error: { message: 'not found' } })

  const messages = body.messages ?? []
  const conversation = messages.filter((m) => m.role !== 'system')
  const first = String(conversation[0]?.content ?? '')
  if (conversation.length === 1 && /^(There is no summary yet\.|Summary so far)/.test(first)) {
    log.push({ at: new Date().toISOString(), question: '(summary)', messages: [{ role: 'user', content: first.slice(0, 4000) }], tools: [] })
    const count = (first.split('Messages since then:')[1] ?? '').split('\n\n').filter((l) => l.trim()).length
    return send(200, completion(body.model, { role: 'assistant', content: `Test summary of ${count} earlier messages.` }))
  }
  const { index, text } = lastUser(messages)
  const q = question(text)
  const toolResults = messages.slice(index + 1).filter((m) => m.role === 'tool')
  const earlierAnswers = messages.slice(0, index).filter((m) => m.role === 'assistant' && m.content).length
  log.push({ at: new Date().toISOString(), question: q, messages: messages.map((m) => ({ role: m.role, content: String(m.content ?? '').slice(0, 200) })), tools: (body.tools ?? []).map((t) => t.function?.name) })

  if (/fail once/i.test(q) && (failures.get(q) ?? 0) < 3) {
    failures.set(q, (failures.get(q) ?? 0) + 1)
    return send(500, { error: { message: 'fake model failure', type: 'server_error' } })
  }
  if (/slow/i.test(q)) await new Promise((r) => setTimeout(r, 4000))
  const offered = (body.tools ?? []).map((t) => t.function?.name)
  const call = (name, args) =>
    send(200, completion(body.model, { role: 'assistant', content: null, tool_calls: [{ id: `call-${Date.now()}`, type: 'function', function: { name, arguments: JSON.stringify(args) } }] }))
  if (/propose a note/i.test(q) && toolResults.length === 0 && offered.includes('propose_project_note')) {
    return call('propose_project_note', { toProjectTeam: true, subject: 'Call flow update', body: 'The call flow is mapped; staffing is next.' })
  }
  if (/propose a goal/i.test(q) && toolResults.length === 0 && offered.includes('propose_field_edit')) {
    return call('propose_field_edit', { field: 'project_goal', text: 'Replace the CAD by March' })
  }
  if (/search/i.test(q) && toolResults.length === 0 && (body.tools ?? []).some((t) => t.function?.name === 'search_project_knowledge')) {
    return send(
      200,
      completion(body.model, {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: `call-${Date.now()}`, type: 'function', function: { name: 'search_project_knowledge', arguments: JSON.stringify({ query: q, limit: 3 }) } }],
      })
    )
  }
  const firstResult = toolResults.length ? JSON.parse(toolResults[0].content) : null
  const searched = firstResult?.results ? ` (searched: ${firstResult.results.length} results)` : firstResult?.proposed ? ' (proposed)' : ''
  return send(200, completion(body.model, { role: 'assistant', content: `Test answer to "${q}"${searched}. Earlier answers shown: ${earlierAnswers}.` }))
})

server.listen(PORT, () => console.log(`fake model on http://localhost:${PORT}/v1`))
