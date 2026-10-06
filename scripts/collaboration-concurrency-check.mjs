// Races the shared-workspace session functions over real, parallel
// Postgres connections -- the lock behaviour the in-memory PGlite tests
// (src/lib/collaboration/database.test.ts) can't show, since PGlite has a
// single connection.
//
// LOCAL, DISPOSABLE DATABASES ONLY. It seeds its own users and Project and
// never cleans up. It refuses any host other than localhost or a Unix
// socket, so it can't be pointed at the shared Supabase backend.
//
//   COLLAB_CHECK_DATABASE_URL=postgres://postgres@localhost:5432/ember_scratch \
//     node scripts/collaboration-concurrency-check.mjs
//
// The database needs every migration in supabase/migrations applied, plus
// stand-ins for Supabase's auth schema where auth.uid() reads the
// request.jwt.claim.sub setting and auth.jwt() reads request.jwt.claims
// (as PostgREST sets them).
import pg from 'pg'
import { randomUUID } from 'node:crypto'

const url = process.env.COLLAB_CHECK_DATABASE_URL
if (!url) throw new Error('Set COLLAB_CHECK_DATABASE_URL to a local, disposable database.')
const host = new URL(url).hostname || new URL(url).searchParams.get('host') || ''
if (!['localhost', '127.0.0.1', '::1', ''].includes(host) && !host.startsWith('/')) {
  throw new Error(`Refusing to run against ${host}: local disposable databases only.`)
}

const ROUNDS = Number(process.env.COLLAB_CHECK_ROUNDS ?? 20)
let failures = 0
const check = (ok, label) => {
  if (!ok) failures++
  console.log(`${ok ? 'pass' : 'FAIL'}  ${label}`)
}

const admin = new pg.Client({ connectionString: url })
await admin.connect()

async function seedUsers(n, projectId) {
  const ids = Array.from({ length: n }, () => randomUUID())
  for (const id of ids) {
    await admin.query('insert into auth.users(id, email) values ($1, $2)', [id, `${id}@collab-check.local`])
    await admin.query('insert into profiles(id, email, full_name) values ($1, $2, $3) on conflict (id) do nothing', [id, `${id}@collab-check.local`, `Check ${id.slice(0, 4)}`])
    await admin.query("insert into project_members(project_id, user_id, role) values ($1, $2, 'viewer') on conflict do nothing", [projectId, id])
  }
  return ids
}

async function seedProject() {
  const id = randomUUID()
  await admin.query("insert into projects(id, name, project_type) values ($1, $2, 'learning')", [id, `Collaboration check ${id.slice(0, 8)}`])
  const ws = randomUUID()
  await admin.query('insert into project_workstreams(id, project_id, name, slug) values ($1, $2, $3, $4)', [ws, id, 'Check workstream', `check-${ws.slice(0, 8)}`])
  return { id, workstream: ws }
}

// One connection per actor, signed in the way PostgREST does it.
async function connectAs(userId) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  await c.query("select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
    userId,
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  return c
}

async function rpc(client, fn, ...args) {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await client.query(`select public.${fn}(${params}) as r`, args)
  return rows[0].r
}
const settle = (promises) => Promise.allSettled(promises)

async function startSession(project, hostId, guestId, hostClient, guestClient) {
  const inv = await rpc(hostClient, 'collaboration_invite', project.id, guestId)
  const guestTab = randomUUID()
  const hostTab = randomUUID()
  const { sessionId } = await rpc(guestClient, 'collaboration_respond_invitation', inv.id, true, guestTab)
  const snap = await rpc(hostClient, 'collaboration_join', sessionId, hostTab, false)
  return { sessionId, hostTab, guestTab, snap }
}

try {
  const project = await seedProject()

  // 1. A double-clicked accept on two connections: one session.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [h, g] = await seedUsers(2, project.id)
      const [ch, cg1, cg2] = await Promise.all([connectAs(h), connectAs(g), connectAs(g)])
      const inv = await rpc(ch, 'collaboration_invite', project.id, g)
      const results = await settle([
        rpc(cg1, 'collaboration_respond_invitation', inv.id, true, randomUUID()),
        rpc(cg2, 'collaboration_respond_invitation', inv.id, true, randomUUID()),
      ])
      const ids = new Set(results.filter((r) => r.status === 'fulfilled').map((r) => r.value.sessionId))
      const { rows } = await admin.query('select count(*)::int n from collaboration_sessions where host_id = $1', [h])
      ok &&= ids.size === 1 && rows[0].n === 1
      await Promise.all([ch.end(), cg1.end(), cg2.end()])
    }
    check(ok, `duplicate accept in parallel creates exactly one session (${ROUNDS} rounds)`)
  }

  // 2. Crossing invitations A->B and B->A accepted at the same moment: at
  //    most one live session for the pair.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [a, b] = await seedUsers(2, project.id)
      const [ca, cb] = await Promise.all([connectAs(a), connectAs(b)])
      const ab = await rpc(ca, 'collaboration_invite', project.id, b)
      const ba = await rpc(cb, 'collaboration_invite', project.id, a)
      const results = await settle([
        rpc(cb, 'collaboration_respond_invitation', ab.id, true, randomUUID()),
        rpc(ca, 'collaboration_respond_invitation', ba.id, true, randomUUID()),
      ])
      const { rows } = await admin.query(
        "select count(*)::int n from collaboration_sessions where status = 'active' and $1 in (host_id, guest_id)",
        [a]
      )
      ok &&= rows[0].n === 1 && results.filter((r) => r.status === 'fulfilled').length === 1
      await Promise.all([ca.end(), cb.end()])
    }
    check(ok, `crossing invitations accepted together give one live session (${ROUNDS} rounds)`)
  }

  // 3. The host grants control while, in parallel, the host's tab navigates
  //    on the old generation and the guest navigates on the new one. Every
  //    committed navigation was made by whoever held control at that moment.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [h, g] = await seedUsers(2, project.id)
      const [ch, ch2, cg] = await Promise.all([connectAs(h), connectAs(h), connectAs(g)])
      const s = await startSession(project, h, g, ch, cg)
      await rpc(cg, 'collaboration_request_control', s.sessionId, s.guestTab, false)
      const gen = s.snap.controlGeneration
      const [grant, hostNav, guestNav] = await settle([
        rpc(ch, 'collaboration_answer_control_request', s.sessionId, s.hostTab, gen, true),
        rpc(ch2, 'collaboration_navigate', s.sessionId, s.hostTab, gen, project.workstream),
        rpc(cg, 'collaboration_navigate', s.sessionId, s.guestTab, gen + 1, null),
      ])
      ok &&= grant.status === 'fulfilled'
      if (hostNav.status === 'fulfilled') ok &&= hostNav.value.controllerId === h && hostNav.value.controlGeneration === gen
      if (guestNav.status === 'fulfilled') ok &&= guestNav.value.controllerId === g && guestNav.value.controlGeneration === gen + 1
      if (hostNav.status === 'rejected') ok &&= /Ask for control|Control changed/.test(hostNav.reason.message)
      const { rows } = await admin.query('select controller_id, control_generation from collaboration_sessions where id = $1', [s.sessionId])
      ok &&= rows[0].controller_id === g && rows[0].control_generation === gen + 1
      await Promise.all([ch.end(), ch2.end(), cg.end()])
    }
    check(ok, `handover racing navigation never lets a stale controller move the view (${ROUNDS} rounds)`)
  }

  // 4. Grant racing the host's reclaim: one controller, one consistent generation.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [h, g] = await seedUsers(2, project.id)
      const [ch, ch2, cg] = await Promise.all([connectAs(h), connectAs(h), connectAs(g)])
      const s = await startSession(project, h, g, ch, cg)
      await rpc(cg, 'collaboration_request_control', s.sessionId, s.guestTab, false)
      const gen = s.snap.controlGeneration
      await settle([
        rpc(ch, 'collaboration_answer_control_request', s.sessionId, s.hostTab, gen, true),
        rpc(ch2, 'collaboration_reclaim_control', s.sessionId, s.hostTab),
      ])
      const { rows } = await admin.query('select controller_id, control_generation from collaboration_sessions where id = $1', [s.sessionId])
      const { rows: ev } = await admin.query(
        "select count(*)::int n from collaboration_events where session_id = $1 and event in ('control_granted', 'control_reclaimed')",
        [s.sessionId]
      )
      // Each recorded change moved the generation exactly once.
      ok &&= rows[0].control_generation === gen + ev[0].n && [h, g].includes(rows[0].controller_id)
      await Promise.all([ch.end(), ch2.end(), cg.end()])
    }
    check(ok, `grant racing reclaim leaves one controller and a matching generation (${ROUNDS} rounds)`)
  }

  // 5. Five tabs of the controller take over at once: one tab ends up
  //    current, and only it can move the view.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [h, g] = await seedUsers(2, project.id)
      const [ch, cg] = await Promise.all([connectAs(h), connectAs(g)])
      const s = await startSession(project, h, g, ch, cg)
      const tabs = Array.from({ length: 5 }, () => randomUUID())
      const clients = await Promise.all(tabs.map(() => connectAs(h)))
      await settle(tabs.map((t, k) => rpc(clients[k], 'collaboration_join', s.sessionId, t, true)))
      const { rows } = await admin.query('select connection_id, (select control_generation from collaboration_sessions where id = $1) gen from collaboration_participants where session_id = $1 and user_id = $2', [s.sessionId, h])
      const current = rows[0].connection_id
      const navs = await settle(tabs.map((t, k) => rpc(clients[k], 'collaboration_navigate', s.sessionId, t, rows[0].gen, project.workstream)))
      const succeeded = tabs.filter((_, k) => navs[k].status === 'fulfilled')
      ok &&= tabs.includes(current) && succeeded.length === 1 && succeeded[0] === current
      await Promise.all([ch.end(), cg.end(), ...clients.map((c) => c.end())])
    }
    check(ok, `parallel tab take-overs leave exactly one tab able to act (${ROUNDS} rounds)`)
  }
} finally {
  await admin.end()
}

console.log(failures === 0 ? '\nAll concurrency checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
