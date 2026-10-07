// Shared workspace sessions, Phase 3: the shared Ember chat in three
// browsers -- Hana and Gil in a live session, Vera as the conversation's
// viewer -- against the local stack in scripts/local-e2e/README.md, with
// scripts/local-e2e/fake-model.mjs standing in for the AI model. Prints
// pass/FAIL per step; exits 1 on any failure. Resets only the
// collaboration tables of the LOCAL database, and points its default chat
// provider at the stand-in model.
import { createRequire } from 'node:module'
import pg from 'pg'
const require = createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`)
const { chromium } = require('playwright-core')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const MODEL_URL = process.env.FAKE_MODEL_URL ?? 'http://localhost:54340/v1'
const P = 'b0000000-0000-4000-8000-000000000001'
const HANA = 'a0000000-0000-4000-8000-000000000001'
const GIL = 'a0000000-0000-4000-8000-000000000002'
const VERA = 'a0000000-0000-4000-8000-000000000004'
const SHOTS = process.env.SHOTS
const dbUrl = process.env.E2E_DATABASE_URL ?? ''
const dbHost = new URL(dbUrl).hostname || new URL(dbUrl).searchParams.get('host') || ''
if (!['localhost', '127.0.0.1', ''].includes(dbHost) && !dbHost.startsWith('/')) throw new Error('Local databases only.')
const db = new pg.Client({ connectionString: dbUrl })
await db.connect()
const sql = async (q, params = []) => {
  const { rows } = await db.query(q, params)
  return rows.length ? Object.values(rows[0])[0] : null
}
await db.query(
  'truncate collaboration_turns, collaboration_messages, collaboration_saves, collaboration_drafts, collaboration_events, collaboration_watchers, collaboration_viewers, collaboration_participants, collaboration_invitations, collaboration_sessions, collaboration_conversations'
)
// The default chat model's provider answers from the stand-in.
await db.query(
  "update ai_providers set base_url = $1 where id = (select provider_id from ai_models where model_type = 'generation' and is_default and enabled limit 1)",
  [MODEL_URL]
)
// A source only Hana and Gil may open (restricted evidence), for the
// hidden-answer step.
const restrictedSource = await sql(`
  with kb as (
    insert into knowledge_bases(id, name, project_id, classification, visibility_scope) values ('e2e-pricing', 'Pricing', '${P}', 'project', 'project_private')
    on conflict (id) do update set name = excluded.name returning id
  ), link as (
    insert into project_knowledge_bases(project_id, knowledge_base_id) select '${P}', id from kb
    where not exists (select 1 from project_knowledge_bases where knowledge_base_id = 'e2e-pricing')
  )
  insert into knowledge_sources(knowledge_base_id, title) select id, 'Vendor pricing' from kb returning id`)
const policy = await sql(
  "insert into resource_access_policies(project_id, resource_type, resource_id, classification) values ($1, 'knowledge_source', $2, 'internal_confidential') returning id",
  [P, restrictedSource]
)
await db.query(
  'insert into resource_access_grants(resource_access_policy_id, project_member_id) select $1, id from project_members where project_id = $2 and user_id in ($3, $4)',
  [policy, P, HANA, GIL]
)

const eventually = async (query, params, expected, label, ms = 15000) => {
  const until = Date.now() + ms
  let value
  while (Date.now() < until) {
    value = await sql(query, params)
    if (value === expected) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`)
}

let failures = 0
const people = {}
const step = async (label, fn) => {
  const t = Date.now()
  try {
    const extra = await fn()
    console.log(`pass  ${label}${extra ? ` (${extra})` : ''} [${Date.now() - t} ms]`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${label}: ${String(e.message).split('\n')[0]}`)
    if (SHOTS) for (const [who, p] of Object.entries(people)) await p.page.screenshot({ path: `${SHOTS}/p3-fail-${failures}-${who}.png` }).catch(() => {})
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
async function signIn(email) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/login`)
  await page.locator('input').nth(0).fill(email)
  await page.locator('input').nth(1).fill('local-only')
  await page.locator('form button').first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  return { ctx, page }
}
const bar = (page) => page.getByLabel('Live collaboration')
const chat = (page) => page.getByLabel('Shared Ember chat')
const waitPath = (page, path, timeout = 15000) => page.waitForURL((u) => u.pathname === path, { timeout })
async function ask(page, text) {
  await chat(page).getByLabel('Message to Ember').fill(text)
  await chat(page).getByRole('button', { name: 'Ask Ember' }).click()
}

const hana = (people.hana = await signIn('hana@e2e.local'))
const gil = (people.gil = await signIn('gil@e2e.local'))
const vera = (people.vera = await signIn('vera@e2e.local'))
let conversationId
let t0

await step('a live session starts; Vera is added as a viewer', async () => {
  await gil.page.goto(`${BASE}/dashboard`)
  await hana.page.goto(`${BASE}/projects/${P}`)
  await hana.page.getByRole('button', { name: 'Collaborate' }).click()
  await hana.page.getByRole('button', { name: /Gil Guest/ }).click()
  await hana.page.getByRole('button', { name: 'Send invitation' }).click()
  await bar(gil.page).getByRole('button', { name: 'Accept' }).click({ timeout: 20000 })
  await waitPath(gil.page, `/projects/${P}`)
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 20000 })
  conversationId = await sql('select id from collaboration_conversations limit 1')
  await db.query("insert into collaboration_viewers(conversation_id, user_id, added_by) values ($1, $2, $3)", [conversationId, VERA, HANA])
})

await step('Hana opens Ember chat from the bar and asks; both see the question and one answer', async () => {
  await bar(hana.page).getByRole('button', { name: /^Ember chat/ }).click()
  await bar(gil.page).getByRole('button', { name: /^Ember chat/ }).click()
  t0 = Date.now()
  await ask(hana.page, 'What is the call flow?')
  await chat(gil.page).getByText('What is the call flow?', { exact: true }).waitFor({ timeout: 10000 })
  await chat(gil.page).getByText('Test answer to "What is the call flow?"').waitFor({ timeout: 20000 })
  const gilSaw = Date.now() - t0
  await chat(hana.page).getByText('Test answer to "What is the call flow?"').waitFor({ timeout: 10000 })
  await eventually("select count(*)::int from collaboration_messages where kind = 'reply'", [], 1, 'replies')
  if (SHOTS) await gil.page.screenshot({ path: `${SHOTS}/p3-1-shared-answer.png` })
  return `Gil saw the answer ${gilSaw} ms after Hana asked`
})

await step('questions from both are answered one at a time, in order, each under its question', async () => {
  await ask(gil.page, 'A slow question about staffing')
  await chat(hana.page).getByText('A slow question about staffing', { exact: true }).waitFor({ timeout: 10000 })
  await ask(hana.page, 'And radio?')
  await chat(hana.page).getByText(/Ember is answering|waiting/).first().waitFor({ timeout: 10000 })
  await chat(gil.page).getByText('Test answer to "And radio?"').waitFor({ timeout: 30000 })
  const order = await db.query(
    "select m.content, t.started_at from collaboration_turns t join collaboration_messages m on m.id = t.prompt_id where m.content in ('A slow question about staffing', 'And radio?') order by t.started_at"
  )
  if (order.rows.map((r) => r.content).join('|') !== 'A slow question about staffing|And radio?') throw new Error('turns ran out of order')
  const running = await sql("select count(*)::int from collaboration_turns where status = 'running'")
  if (running !== 0) throw new Error(`${running} still running`)
  // In the chat, each answer sits right after its question.
  const texts = await chat(gil.page).locator('li').allInnerTexts()
  const i = texts.findIndex((t) => t.includes('A slow question about staffing'))
  if (!texts[i + 1]?.includes('Test answer to "A slow question about staffing"')) throw new Error('answer not under its question')
  return 'the second answer also says it was shown both earlier answers: ' + (texts.join(' ').includes('Earlier answers shown: 2') ? 'yes' : 'no')
})

await step('Ember searches the Project knowledge (the only tool it has here)', async () => {
  await ask(hana.page, 'Please search the knowledge for dispatch')
  await chat(gil.page).getByText(/Test answer to "Please search the knowledge for dispatch" \(searched: \d+ results\)/).waitFor({ timeout: 20000 })
  const tools = await (await fetch(`${MODEL_URL.replace(/\/v1$/, '')}/log`)).json()
  const offered = new Set(tools.flatMap((r) => r.tools))
  if ([...offered].some((t) => t !== 'search_project_knowledge')) throw new Error(`offered ${[...offered]}`)
})

await step('a failed answer shows to both; Ask again answers it once', async () => {
  // Unique per run: the stand-in fails a question's first attempt only.
  const question = `Please fail once (run ${Date.now()})`
  await ask(hana.page, question)
  await chat(gil.page).getByText(/couldn’t get a response/).waitFor({ timeout: 30000 })
  await chat(gil.page).getByRole('button', { name: 'Ask again' }).click()
  await chat(hana.page).getByText(`Test answer to "${question}"`, { exact: false }).waitFor({ timeout: 20000 })
  await eventually(
    'select count(*)::int from collaboration_messages m join collaboration_turns t on t.reply_id = m.id join collaboration_messages q on q.id = t.prompt_id where q.content = $1',
    [question],
    1,
    'replies to the failed question'
  )
})

await step('a reload mid-answer neither loses nor repeats it', async () => {
  await ask(hana.page, 'Another slow one')
  await chat(hana.page).getByText(/Ember is answering|Waiting for Ember/).first().waitFor({ timeout: 10000 })
  await hana.page.reload()
  await bar(hana.page).getByRole('button', { name: /Ember chat/ }).click({ timeout: 20000 })
  await chat(hana.page).getByText('Test answer to "Another slow one"').waitFor({ timeout: 30000 })
  await eventually("select count(*)::int from collaboration_messages m join collaboration_turns t on t.reply_id = m.id join collaboration_messages q on q.id = t.prompt_id where q.content = 'Another slow one'", [], 1, 'replies')
})

await step('Vera, a viewer, reads the chat on the conversation page and comments; no polling while she reads', async () => {
  let polls = 0
  vera.page.on('request', (r) => {
    if (/\/rest\/v1\/rpc\/collaboration_(chat|watch_status)/.test(r.url())) polls++
  })
  await vera.page.goto(`${BASE}/projects/${P}/shared/${conversationId}`)
  await chat(vera.page).getByText('Test answer to "What is the call flow?"').waitFor({ timeout: 15000 })
  const before = polls
  await vera.page.waitForTimeout(6000)
  if (polls !== before) throw new Error(`${polls - before} chat requests while idle`)
  await chat(vera.page).getByLabel('Comment').fill('Ask about radio coverage at night')
  await chat(vera.page).getByRole('button', { name: 'Post comment' }).click()
  await chat(hana.page).getByText('Ask about radio coverage at night', { exact: true }).waitFor({ timeout: 10000 })
  await chat(hana.page).getByText('Comment from Vera Viewer').waitFor()
  if ((await sql("select count(*)::int from collaboration_turns t join collaboration_messages m on m.id = t.prompt_id where m.kind = 'comment'")) !== 0) throw new Error('Ember answered a comment by itself')
  if (await chat(vera.page).getByRole('button', { name: 'Ask Ember' }).count()) throw new Error('viewer can ask Ember')
})

await step('Gil passes the comment on; Ember answers it, attributed to Vera and Gil', async () => {
  await chat(gil.page).getByRole('button', { name: 'Ask Ember to respond' }).click({ timeout: 10000 })
  await chat(hana.page).getByText('Ember · answering Vera Viewer’s comment, passed on by Gil Guest').waitFor({ timeout: 20000 })
  await chat(hana.page).getByText('Test answer to "Ask about radio coverage at night"').waitFor()
  await chat(vera.page).getByRole('button', { name: 'Refresh' }).click()
  await chat(vera.page).getByText('Test answer to "Ask about radio coverage at night"').waitFor({ timeout: 10000 })
  if (SHOTS) await vera.page.screenshot({ path: `${SHOTS}/p3-2-viewer-recap.png` })
})

await step('an answer drawn from a source Vera can’t open is hidden from her, shown to the pair with its source', async () => {
  // Recorded the way the runner records it, with the restricted source as
  // evidence (the stand-in model can't retrieve real vectors).
  const session = await sql("select id from collaboration_sessions where status = 'active'")
  const question = await sql(
    "insert into collaboration_messages(conversation_id, seq, kind, author_id, session_id, content) select $1, max(seq) + 1, 'message', $2, $3, 'What does the vendor charge?' from collaboration_messages where conversation_id = $1 returning id",
    [conversationId, HANA, session]
  )
  const turn = await sql("insert into collaboration_turns(conversation_id, session_id, prompt_id, requested_by, status, lease_id, lease_expires_at) values ($1, $2, $3, $4, 'running', gen_random_uuid(), now() + interval '1 minute') returning id", [conversationId, session, question, HANA])
  const lease = await sql('select lease_id from collaboration_turns where id = $1', [turn])
  await db.query('select collaboration_complete_turn($1, $2, $3, $4, $5, $6)', [turn, lease, 'About 40k a year.', JSON.stringify([{ type: 'knowledge_source', id: restrictedSource, title: 'Vendor pricing' }]), 'test', 'test'])
  await chat(gil.page).getByText('About 40k a year.').waitFor({ timeout: 10000 })
  await chat(gil.page).getByRole('link', { name: 'Vendor pricing' }).waitFor()
  await chat(vera.page).getByRole('button', { name: 'Refresh' }).click()
  await chat(vera.page).getByText('Hidden — this answer drew on sources you can’t open.').waitFor({ timeout: 10000 })
  if (await chat(vera.page).getByText('About 40k').count()) throw new Error('viewer sees restricted text')
  // Later answers don't pass it on: Ember's next context leaves it out.
  await ask(hana.page, 'Summarise so far')
  await chat(hana.page).getByText('Test answer to "Summarise so far"').waitFor({ timeout: 20000 })
  const log = await (await fetch(`${MODEL_URL.replace(/\/v1$/, '')}/log`)).json()
  const last = log.filter((r) => r.question === 'Summarise so far').at(-1)
  if (JSON.stringify(last.messages).includes('40k')) throw new Error('restricted answer reached the model')
  if (SHOTS) await vera.page.screenshot({ path: `${SHOTS}/p3-3-hidden-for-viewer.png` })
})

await step('when Gil leaves, Hana can no longer ask; the chat stays in the conversation', async () => {
  await bar(gil.page).getByRole('button', { name: /^Leave/ }).click()
  await chat(hana.page).getByText('Ember answers in this chat while you’re both in a live session').waitFor({ timeout: 20000 })
  if (await chat(hana.page).getByLabel('Message to Ember').count()) throw new Error('composer still shown')
  await hana.page.goto(`${BASE}/projects/${P}/shared/${conversationId}`)
  await chat(hana.page).getByText('Test answer to "Summarise so far"').waitFor({ timeout: 15000 })
  const replies = await sql("select count(*)::int from collaboration_messages where kind = 'reply'")
  return `${replies} answers kept`
})

await browser.close()
await db.end()
console.log(failures ? `\n${failures} step(s) failed` : '\nAll shared-chat steps passed.')
process.exit(failures ? 1 : 0)
