// Local stand-in for a Supabase project's HTTP surface, for e2e only:
// /rest/v1/* -> PostgREST; /auth/v1 issues and reads HS256 JWTs for seeded
// users (ANY password -- never point this at real data). Storage is absent.
//   E2E_JWT_SECRET=... E2E_DATABASE_URL=postgres://postgres@localhost/ember_e2e \
//     node scripts/local-e2e/gateway.mjs       (listens on 54321)
// `node scripts/local-e2e/gateway.mjs keys` prints anon/service keys.
import http from 'node:http'
import crypto from 'node:crypto'
import pg from 'pg'
const SECRET = process.env.E2E_JWT_SECRET
if (!SECRET || SECRET.length < 32) throw new Error('Set E2E_JWT_SECRET (32+ characters, same as PostgREST jwt-secret).')
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
export function sign(payload) {
  const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64(payload)
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`
}
function verify(token) {
  const [h, p, s] = (token ?? '').split('.')
  if (!s || crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  return claims.exp > Date.now() / 1000 ? claims : null
}
if (process.argv[2] === 'keys') {
  const exp = Math.floor(Date.now() / 1000) + 86400 * 30
  console.log(`ANON=${sign({ role: 'anon', iss: 'supabase', exp })}`)
  console.log(`SERVICE=${sign({ role: 'service_role', iss: 'supabase', exp })}`)
  process.exit(0)
}
const dbUrl = process.env.E2E_DATABASE_URL ?? ''
const dbHost = new URL(dbUrl).hostname || new URL(dbUrl).searchParams.get('host') || ''
if (!['localhost', '127.0.0.1', ''].includes(dbHost) && !dbHost.startsWith('/')) throw new Error('Local databases only.')
const db = new pg.Client({ connectionString: dbUrl })
await db.connect()
const POSTGREST = process.env.E2E_POSTGREST_URL ?? 'http://127.0.0.1:54330'
const userJson = (row) => ({ id: row.id, aud: 'authenticated', role: 'authenticated', email: row.email, app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() })
async function session(row) {
  const now = Math.floor(Date.now() / 1000)
  const access_token = sign({ sub: row.id, role: 'authenticated', aud: 'authenticated', email: row.email, iat: now, exp: now + 3600 })
  return { access_token, token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: `r.${row.id}`, user: userJson(row) }
}
const send = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); res.end(JSON.stringify(body)) }
http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  if (req.method === 'OPTIONS') return send(res, 200, {})
  // A client that drops the connection mid-request (the lossy network
  // profile does) must not take the gateway down.
  req.on('error', () => {})
  res.on('error', () => {})
  let raw
  try {
    const chunks = []; for await (const c of req) chunks.push(c); raw = Buffer.concat(chunks)
  } catch {
    return
  }
  try {
    if (url.pathname.startsWith('/auth/v1/')) {
      const route = url.pathname.slice(9)
      if (route === 'token') {
        const body = JSON.parse(raw.toString() || '{}')
        const id = url.searchParams.get('grant_type') === 'refresh_token' ? body.refresh_token?.slice(2) : null
        const { rows } = id
          ? await db.query('select id, email from auth.users where id = $1', [id])
          : await db.query('select id, email from auth.users where email = $1', [body.email])
        if (!rows[0]) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' })
        return send(res, 200, await session(rows[0]))
      }
      if (route === 'user') {
        const claims = verify(req.headers.authorization?.replace(/^Bearer /, ''))
        if (!claims?.sub) return send(res, 401, { msg: 'invalid JWT' })
        const { rows } = await db.query('select id, email from auth.users where id = $1', [claims.sub])
        return send(res, 200, userJson(rows[0]))
      }
      if (route === 'logout') return send(res, 204, {})
      return send(res, 404, { msg: 'not in e2e gateway' })
    }
    if (url.pathname.startsWith('/rest/v1/')) {
      const target = `${POSTGREST}/${url.pathname.slice(9)}${url.search}`
      const headers = { ...req.headers }; delete headers.host; delete headers['content-length']
      if (!headers.authorization && headers.apikey) headers.authorization = `Bearer ${headers.apikey}`
      const r = await fetch(target, { method: req.method, headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : raw })
      const out = Buffer.from(await r.arrayBuffer())
      const h = {}; r.headers.forEach((v, k) => { if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(k)) h[k] = v })
      h['access-control-allow-origin'] = '*'; h['access-control-allow-headers'] = '*'; h['access-control-expose-headers'] = '*'
      res.writeHead(r.status, h); return res.end(out)
    }
    if (url.pathname.startsWith('/storage/v1/')) return send(res, 400, { statusCode: '404', error: 'not_found', message: 'not in e2e gateway' })
    send(res, 404, { msg: 'not in e2e gateway' })
  } catch (e) { send(res, 500, { msg: String(e) }) }
}).listen(54321, () => console.log('gateway on 54321'))
