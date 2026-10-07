// Shared workspace sessions, Phase 3 (shared Ember chat), checked against
// a real Postgres with every migration -- so the evidence checks run the
// real access rules on knowledge_sources and wiki_articles (restricted
// evidence grants, project-private knowledge bases, project-scoped wiki
// articles), not a stand-in. Also races the turn queue over parallel
// connections, which the in-memory PGlite tests can't.
//
// LOCAL, DISPOSABLE DATABASES ONLY. It seeds its own users, Projects and
// sources and never cleans up. It refuses any host other than localhost
// or a Unix socket.
//
//   COLLAB_CHECK_DATABASE_URL=postgres://postgres@localhost:5432/ember_scratch \
//     node scripts/collaboration-shared-chat-check.mjs
//
// Same database setup as scripts/collaboration-concurrency-check.mjs.
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
const clients = []

async function connectAs(userId) {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  clients.push(c)
  await c.query("select set_config('role', 'authenticated', false), set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
    userId,
    JSON.stringify({ sub: userId, role: 'authenticated' }),
  ])
  return c
}
// The app server's service-role connection (claims, completes, fails turns).
async function connectService() {
  const c = new pg.Client({ connectionString: url })
  await c.connect()
  clients.push(c)
  await c.query("select set_config('role', 'service_role', false), set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false)")
  return c
}
async function rpc(client, fn, ...args) {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await client.query(`select public.${fn}(${params}) as r`, args)
  return rows[0].r
}
async function errorOf(p) {
  try {
    await p
  } catch (e) {
    return e
  }
  return { code: 'none', message: 'no error' }
}
const settle = (promises) => Promise.allSettled(promises)

async function seedUser(label) {
  const id = randomUUID()
  await admin.query('insert into auth.users(id, email) values ($1, $2)', [id, `${id}@chat-check.local`])
  await admin.query("insert into profiles(id, email, full_name, role) values ($1, $2, $3, 'member') on conflict (id) do update set role = 'member'", [
    id,
    `${id}@chat-check.local`,
    `${label} ${id.slice(0, 4)}`,
  ])
  return id
}
async function seedProject(members) {
  const id = randomUUID()
  await admin.query("insert into projects(id, name, project_type) values ($1, $2, 'learning')", [id, `Chat check ${id.slice(0, 8)}`])
  const memberIds = {}
  for (const user of members) {
    const { rows } = await admin.query("insert into project_members(project_id, user_id, role) values ($1, $2, 'viewer') returning id", [id, user])
    memberIds[user] = rows[0].id
  }
  return { id, memberIds }
}
async function seedKnowledgeBase(projectId) {
  const kb = `chat-check-${randomUUID().slice(0, 8)}`
  await admin.query("insert into knowledge_bases(id, name, project_id, classification, visibility_scope) values ($1, $1, $2, 'project', 'project_private')", [kb, projectId])
  await admin.query('insert into project_knowledge_bases(project_id, knowledge_base_id) values ($1, $2)', [projectId, kb])
  return kb
}
async function seedSource(kb, title) {
  const { rows } = await admin.query('insert into knowledge_sources(knowledge_base_id, title) values ($1, $2) returning id', [kb, title])
  return rows[0].id
}
// Restricted evidence: readable only by the named Project members.
async function restrict(projectId, sourceId, memberIds) {
  const { rows } = await admin.query(
    "insert into resource_access_policies(project_id, resource_type, resource_id, classification) values ($1, 'knowledge_source', $2, 'internal_confidential') returning id",
    [projectId, sourceId]
  )
  for (const m of memberIds) await admin.query('insert into resource_access_grants(resource_access_policy_id, project_member_id) values ($1, $2)', [rows[0].id, m])
  return rows[0].id
}
async function seedWiki(scope, projectId) {
  const slug = `chat-check-${randomUUID().slice(0, 8)}`
  const { rows } = await admin.query("insert into wiki_articles(slug, title, category, status, visibility_scope) values ($1, $1, 'foundations', 'approved', $2) returning id", [
    slug,
    scope,
  ])
  if (projectId) await admin.query('insert into project_wiki_articles(project_id, wiki_article_id) values ($1, $2)', [projectId, rows[0].id])
  return slug
}

async function startSession(projectId, hostId, guestId, hostClient, guestClient) {
  const inv = await rpc(hostClient, 'collaboration_invite', projectId, guestId)
  const guestTab = randomUUID()
  const hostTab = randomUUID()
  const { sessionId } = await rpc(guestClient, 'collaboration_respond_invitation', inv.id, true, guestTab)
  const snap = await rpc(hostClient, 'collaboration_join', sessionId, hostTab, false)
  return { sessionId, hostTab, guestTab, conversationId: snap.conversationId }
}

const ks = (id) => ({ type: 'knowledge_source', id })
const wa = (id) => ({ type: 'wiki_article', id })
const ids = (items) => items.map((e) => e.id).sort()

try {
  // Fixture: Hana and Gil share a conversation; Vera is its viewer; Olu is
  // in the Project but not the conversation. Hana alone is also in a
  // second Project.
  const [hana, gil, vera, olu] = [await seedUser('Hana'), await seedUser('Gil'), await seedUser('Vera'), await seedUser('Olu')]
  const p = await seedProject([hana, gil, vera, olu])
  const q = await seedProject([hana])
  const kbP = await seedKnowledgeBase(p.id)
  const kbQ = await seedKnowledgeBase(q.id)
  const general = await seedSource(kbP, 'Dispatch overview')
  const restricted = await seedSource(kbP, 'Vendor pricing')
  const restrictedPolicy = await restrict(p.id, restricted, [p.memberIds[hana], p.memberIds[gil]])
  const otherProject = await seedSource(kbQ, 'Other project notes')
  const platformWiki = await seedWiki('platform', null)
  const otherWiki = await seedWiki('project_private', q.id)
  const all = [ks(general), ks(restricted), ks(otherProject), wa(platformWiki), wa(otherWiki)]

  const [ch, cg, cv, co] = await Promise.all([connectAs(hana), connectAs(gil), connectAs(vera), connectAs(olu)])
  const service = await connectService()
  const s = await startSession(p.id, hana, gil, ch, cg)
  await rpc(ch, 'collaboration_add_viewer', s.conversationId, vera)

  // 1. The real access rules, per reader.
  {
    const seen = async (client) => {
      const out = []
      for (const e of all) if ((await rpc(client, 'collaboration_evidence_visible', JSON.stringify([e])))) out.push(e.id)
      return out.sort()
    }
    check(
      JSON.stringify(await seen(ch)) === JSON.stringify(ids(all)) &&
        JSON.stringify(await seen(cg)) === JSON.stringify(ids([ks(general), ks(restricted), wa(platformWiki)])) &&
        JSON.stringify(await seen(cv)) === JSON.stringify(ids([ks(general), wa(platformWiki)])),
      'fixture: each reader sees what the real policies allow (Hana everything, Gil not the other Project, Vera not the restricted source)'
    )
    const common = await rpc(ch, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all))
    check(JSON.stringify(ids(common)) === JSON.stringify(ids([ks(general), wa(platformWiki)])), 'common evidence for Hana, Gil and viewer Vera: only what all three can open')
    const fromGil = await rpc(cg, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all))
    check(JSON.stringify(ids(fromGil)) === JSON.stringify(ids(common)), 'the same answer whichever of the pair asks')
  }

  // 2. The audience changes the answer: without the viewer, the restricted
  //    source both of the pair hold becomes usable.
  {
    await rpc(ch, 'collaboration_remove_viewer', s.conversationId, vera)
    const common = await rpc(ch, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all))
    check(JSON.stringify(ids(common)) === JSON.stringify(ids([ks(general), ks(restricted), wa(platformWiki)])), 'removing the viewer widens common evidence to what the pair share')
    await rpc(ch, 'collaboration_add_viewer', s.conversationId, vera)
  }

  // 3. The caller's identity is put back, and only the pair may ask.
  {
    await ch.query('begin')
    await rpc(ch, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all))
    const { rows } = await ch.query('select auth.uid() as uid')
    await ch.query('commit')
    check(rows[0].uid === hana, "the caller's identity is restored after checking as each reader")
    const viewerErr = await errorOf(rpc(cv, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all)))
    const outsiderErr = await errorOf(rpc(co, 'collaboration_common_evidence', s.conversationId, JSON.stringify(all)))
    check(viewerErr.code === '42501' && outsiderErr.code === '42501', 'a viewer or non-member cannot run the check')
  }

  // 4. A reply is readable only by readers who can open all its evidence;
  //    losing access hides it again.
  {
    const asked = await rpc(ch, 'collaboration_ask_ember', s.sessionId, s.hostTab, 'What does the vendor charge?', randomUUID())
    const claim = await rpc(service, 'collaboration_claim_turn', s.conversationId, hana)
    await rpc(service, 'collaboration_complete_turn', claim.turnId, claim.leaseId, 'About 40k a year.', JSON.stringify([ks(restricted)]), 'test', 'test')
    const reply = async (client) => (await rpc(client, 'collaboration_chat', s.conversationId)).messages.find((m) => m.kind === 'reply')
    const [rg, rv] = [await reply(cg), await reply(cv)]
    check(claim.state === 'claimed' && claim.prompt.id === asked.messageId, 'the claimed turn is the question asked')
    check(rg?.content === 'About 40k a year.' && rv?.hidden === true && rv.content === undefined, 'Gil reads the reply; viewer Vera sees it only as hidden')
    const { rows: direct } = await cv.query('select content from collaboration_messages where conversation_id = $1', [s.conversationId])
    check(direct.length === 1, "reading the table directly, Vera gets the question but not the reply's text")
    const { rows: none } = await co.query('select 1 from collaboration_messages where conversation_id = $1', [s.conversationId])
    check(none.length === 0, 'a Project member outside the conversation reads nothing')
    await admin.query("update resource_access_grants set status = 'revoked' where resource_access_policy_id = $1 and project_member_id = $2", [
      restrictedPolicy,
      p.memberIds[gil],
    ])
    check((await reply(cg))?.hidden === true, "after Gil's access to the source is revoked, the reply is hidden from Gil too")
    const writeErr = await errorOf(ch.query("insert into collaboration_messages(conversation_id, seq, kind, content, turn_id) values ($1, 99, 'reply', 'forged', $2)", [s.conversationId, randomUUID()]))
    const claimErr = await errorOf(rpc(ch, 'collaboration_claim_turn', s.conversationId, hana))
    check(writeErr.code === '42501' && claimErr.code === '42501', "a browser can't write a reply or claim a turn")
  }

  // 5. Races.
  {
    let ok = true
    for (let i = 0; i < ROUNDS; i++) {
      const [h, g] = [await seedUser('H'), await seedUser('G')]
      const proj = await seedProject([h, g])
      const [c1, c2, c3] = await Promise.all([connectAs(h), connectAs(h), connectAs(g)])
      const [sv1, sv2] = await Promise.all([connectService(), connectService()])
      const ss = await startSession(proj.id, h, g, c1, c3)
      // Same question sent twice at once: one message, one turn.
      const request = randomUUID()
      const sent = await settle([
        rpc(c1, 'collaboration_ask_ember', ss.sessionId, ss.hostTab, 'Q1', request),
        rpc(c2, 'collaboration_ask_ember', ss.sessionId, ss.hostTab, 'Q1', request),
      ])
      const { rows: [msgs] } = await admin.query('select count(*)::int n from collaboration_messages where request_id = $1', [request])
      ok &&= sent.every((r) => r.status === 'fulfilled') && msgs.n === 1 && sent[0].value.turnId === sent[1].value.turnId
      // Two runners claim at once: one runs, the other finds it busy.
      const claims = await settle([rpc(sv1, 'collaboration_claim_turn', ss.conversationId, h), rpc(sv2, 'collaboration_claim_turn', ss.conversationId, g)])
      const states = claims.map((r) => r.status === 'fulfilled' && r.value.state).sort()
      ok &&= JSON.stringify(states) === JSON.stringify(['busy', 'claimed'])
      const won = claims.find((r) => r.value?.state === 'claimed').value
      // The same completion delivered twice at once: one reply.
      const done = await settle([
        rpc(sv1, 'collaboration_complete_turn', won.turnId, won.leaseId, 'A1', '[]', 't', 't'),
        rpc(sv2, 'collaboration_complete_turn', won.turnId, won.leaseId, 'A1', '[]', 't', 't'),
      ])
      const { rows: [replies] } = await admin.query("select count(*)::int n from collaboration_messages where turn_id = $1 and kind = 'reply'", [won.turnId])
      ok &&= done.every((r) => r.status === 'fulfilled') && replies.n === 1 && done[0].value.replyId === done[1].value.replyId
      // Five different questions at once against a queue of three.
      const tabs = await Promise.all(Array.from({ length: 5 }, () => connectAs(h)))
      const many = await settle(tabs.map((c, k) => rpc(c, 'collaboration_ask_ember', ss.sessionId, ss.hostTab, `Q${k}`, randomUUID())))
      const { rows: [open] } = await admin.query("select count(*)::int n from collaboration_turns where conversation_id = $1 and status in ('queued', 'running')", [ss.conversationId])
      ok &&= many.filter((r) => r.status === 'fulfilled').length === 3 && open.n === 3
      // Sequence numbers stay unique and gap-free.
      const { rows: seqs } = await admin.query('select seq from collaboration_messages where conversation_id = $1 order by seq', [ss.conversationId])
      ok &&= seqs.every((r, k) => Number(r.seq) === k + 1)
      if (!ok) console.log('round', i, { sent, states, done, many: many.map((r) => r.status), open: open.n })
      for (const c of [c1, c2, c3, sv1, sv2, ...tabs]) {
        await c.end()
        clients.splice(clients.indexOf(c), 1)
      }
      if (!ok) break
    }
    check(ok, `duplicate sends, two runners, duplicate completions and a full queue, in parallel (${ROUNDS} rounds)`)
  }
} finally {
  await Promise.all(clients.map((c) => c.end().catch(() => {})))
  await admin.end()
}

console.log(failures === 0 ? '\nAll shared chat checks passed.' : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
