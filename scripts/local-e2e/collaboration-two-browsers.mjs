// Shared workspace sessions, Phase 1: two people in two separate browser
// contexts (separate sign-ins), plus a viewer in a third, drive the real UI against the local stack
// in scripts/local-e2e/README.md. Prints pass/FAIL per step; exits 1 on
// any failure. Resets only the collaboration tables of the LOCAL database.
import { createRequire } from 'node:module'
import pg from 'pg'
import { applyNetwork, contextOptions, network, device } from './network.mjs'
const require = createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`)
const { chromium } = require('playwright-core')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const P = 'b0000000-0000-4000-8000-000000000001'
const W1 = 'c0000000-0000-4000-8000-000000000001', W2 = 'c0000000-0000-4000-8000-000000000002'
const HANA = 'a0000000-0000-4000-8000-000000000001', GIL = 'a0000000-0000-4000-8000-000000000002'
const SHOTS = process.env.SHOTS
const dbUrl = process.env.E2E_DATABASE_URL ?? ''
const dbHost = new URL(dbUrl).hostname || new URL(dbUrl).searchParams.get('host') || ''
if (!['localhost', '127.0.0.1', ''].includes(dbHost) && !dbHost.startsWith('/')) throw new Error('Local databases only.')
const db = new pg.Client({ connectionString: dbUrl })
await db.connect()
const sql = async (q) => {
  const { rows } = await db.query(q)
  return rows.length ? String(Object.values(rows[0])[0]) : ''
}
await db.query('truncate collaboration_proposal_uses, collaboration_summaries, collaboration_turns, collaboration_messages, collaboration_saves, collaboration_drafts, collaboration_events, collaboration_watchers, collaboration_viewers, collaboration_participants, collaboration_invitations, collaboration_sessions, collaboration_conversations')
let failures = 0
const step = async (label, fn) => {
  const t = Date.now()
  try { const extra = await fn(); console.log(`pass  ${label}${extra ? ` (${extra})` : ''} [${Date.now() - t} ms]`) }
  catch (e) {
    failures++; console.log(`FAIL  ${label}: ${String(e.message).split('\n')[0]}`)
    if (SHOTS) for (const [who, pg] of Object.entries(pages)) { try { await pg().screenshot({ path: `${SHOTS}/fail-${failures}-${who}.png` }); console.log(`      ${who} at ${new URL(pg().url()).pathname}`) } catch {} }
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
async function signIn(email) {
  // E2E_NETWORK / E2E_DEVICE (network.mjs): a simulated network or screen.
  const ctx = await browser.newContext(network || device ? contextOptions() : { viewport: { width: 1280, height: 900 } })
  const page = await ctx.newPage()
  await applyNetwork(page)
  await page.goto(`${BASE}/login`)
  await page.locator('input').nth(0).fill(email)
  await page.locator('input').nth(1).fill('local-only')
  await page.locator('button[type=submit], form button').first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  return { ctx, page }
}
const pages = {}
const bar = (page) => page.getByLabel('Live collaboration')
// Simulates someone not touching their tab for a while: the browser can't
// wait 10 minutes, so their recorded last activity is moved back.
const inactiveFor = (user, minutes) =>
  sql(`update collaboration_participants p set last_active_at = now() - interval '${minutes} minutes'
       from collaboration_sessions s where s.id = p.session_id and s.status = 'active' and p.user_id = '${user}'`)
// Pretends a tab is in the background (headless pages are always visible).
const setHidden = (page, hidden) =>
  page.evaluate((h) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (h ? 'hidden' : 'visible') })
    document.dispatchEvent(new Event('visibilitychange'))
  }, hidden)
const waitPath = (page, path, timeout = 15000) => page.waitForURL((u) => u.pathname === path, { timeout })
// A real in-app link when one is on screen (client-side navigation);
// otherwise Next's router if exposed; otherwise a full page load.
const navKinds = []
const clientNav = async (page, path) => {
  const link = page.locator(`main a[href="${path}"]:visible`).first()
  if (await link.count()) { navKinds.push('link'); return link.click() }
  const viaRouter = await page.evaluate((p) => { const r = window.next?.router; if (r?.push) { r.push(p); return true } return false }, path)
  navKinds.push(viaRouter ? 'router' : 'reload')
  if (!viaRouter) await page.goto(`${BASE}${path}`)
}

const hana = await signIn('hana@e2e.local')
const gil = await signIn('gil@e2e.local')
const vera = await signIn('vera@e2e.local')
pages.vera = () => vera.page; pages.hana = () => hana.page; pages.gil = () => (gil2 && !gil2.isClosed() ? gil2 : gil.page)
let gil2, t0
await gil.page.goto(`${BASE}/dashboard`)

await step('Collaborate button on the Project page invites Gil after a confirmation step', async () => {
  await hana.page.goto(`${BASE}/projects/${P}`)
  await hana.page.getByRole('button', { name: 'Collaborate' }).click()
  await hana.page.getByRole('button', { name: /Gil Guest/ }).click()
  await hana.page.getByText('Invite Gil Guest to a live session').waitFor()
  await hana.page.getByRole('button', { name: 'Send invitation' }).click()
  t0 = Date.now()
  await hana.page.getByText('Invitation sent to Gil Guest').waitFor()
  await bar(hana.page).getByText('Waiting for Gil Guest to accept').waitFor({ timeout: 20000 })
})
if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/1-host-waiting.png` })

await step('Gil (using Ember) sees the invitation within seconds, and in the tab title while the tab is in the background', async () => {
  await bar(gil.page).getByText('Hana Host invited you').waitFor({ timeout: 20000 })
  const seenAfter = Date.now() - t0
  if (seenAfter > 8000) throw new Error(`took ${seenAfter} ms`)
  if (SHOTS) await gil.page.screenshot({ path: `${SHOTS}/2-guest-invited.png` })
  const before = await gil.page.title()
  await setHidden(gil.page, true)
  const hiddenTitle = await gil.page.title()
  if (!hiddenTitle.startsWith('(1) Invitation')) throw new Error(`hidden title "${hiddenTitle}"`)
  await setHidden(gil.page, false)
  if ((await gil.page.title()) !== before) throw new Error('title not restored')
  return `invitation shown ${seenAfter} ms after sending`
})

await step('Gil accepts; his browser goes to the shared Project page', async () => {
  await bar(gil.page).getByRole('button', { name: 'Accept' }).click()
  await waitPath(gil.page, `/projects/${P}`)
})

await step('both bars show the live session with Hana in control and both connected', async () => {
  for (const { page } of [hana, gil]) {
    await bar(page).getByText('Live · Harbour Dispatch Upgrade').waitFor({ timeout: 20000 })
    await bar(page).getByText('In control', { exact: true }).waitFor()
  }
  await bar(gil.page).getByRole('button', { name: 'Ask for control' }).waitFor()
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 10000 })
})
if (SHOTS) { await hana.page.screenshot({ path: `${SHOTS}/3-host-in-control.png` }); await gil.page.screenshot({ path: `${SHOTS}/4-guest-following.png` }) }

await step('Hana opens a workstream (client-side navigation); Gil follows', async () => {
  t0 = Date.now()
  await clientNav(hana.page, `/projects/${P}/workstreams/${W1}`)
  await waitPath(hana.page, `/projects/${P}/workstreams/${W1}`)
  await waitPath(gil.page, `/projects/${P}/workstreams/${W1}`)
  return `follow latency ${Date.now() - t0} ms incl. page render`
})

await step('Hana reloads the page (same tab): still in control, no second-tab conflict', async () => {
  await hana.page.reload()
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 20000 })
})

await step('Gil cannot move the shared view: wandering off stops following, Follow again brings him back', async () => {
  await gil.page.locator('header').getByRole('link', { name: 'Projects', exact: true }).click()
  await waitPath(gil.page, '/projects')
  await bar(gil.page).getByText('stepped away from the shared view').waitFor({ timeout: 10000 })
  await gil.page.reload()
  await bar(gil.page).getByText('stepped away from the shared view').waitFor({ timeout: 15000 })
  if (new URL(gil.page.url()).pathname !== '/projects') throw new Error('reload pulled Gil back')
  if ((await sql(`select location_workstream_id from collaboration_sessions where status='active'`)) !== W1) throw new Error('observer moved the shared location')
  await bar(gil.page).getByRole('button', { name: /Follow Hana Host again/ }).click()
  await waitPath(gil.page, `/projects/${P}/workstreams/${W1}`)
})

await step('Gil asks for control, Hana gives it; Gil now moves Hana', async () => {
  await bar(gil.page).getByRole('button', { name: 'Ask for control' }).click()
  await bar(hana.page).getByText('Gil Guest is asking for control').waitFor({ timeout: 10000 })
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/5-host-request.png` })
  await bar(hana.page).getByRole('button', { name: 'Give control' }).click()
  await bar(gil.page).getByText('You’re in control').waitFor({ timeout: 10000 })
  t0 = Date.now()
  await clientNav(gil.page, `/projects/${P}/workstreams/${W2}`)
  await waitPath(hana.page, `/projects/${P}/workstreams/${W2}`)
  return `follow latency ${Date.now() - t0} ms`
})

await step('Hana asks for control back; Gil declines', async () => {
  await bar(hana.page).getByRole('button', { name: 'Ask for control' }).click()
  await bar(gil.page).getByText('Hana Host is asking for control').waitFor({ timeout: 10000 })
  await bar(gil.page).getByRole('button', { name: 'Decline' }).click()
  await bar(hana.page).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 10000 })
})

await step('Hana takes control back as host', async () => {
  await bar(hana.page).getByRole('button', { name: 'Take control back' }).click()
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 10000 })
  await bar(gil.page).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 10000 })
})

await step('Gil shows as away after 10 minutes without input, and back as soon as he touches his tab', async () => {
  await inactiveFor(GIL, 11)
  await bar(hana.page).getByText(/\(away 1[01] min\)/).waitFor({ timeout: 10000 })
  await bar(hana.page).getByText('Gil Guest has been away for').waitFor()
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/7-guest-away.png` })
  t0 = Date.now()
  await gil.page.mouse.move(200, 300)
  await gil.page.mouse.move(400, 500)
  await bar(hana.page).getByText(/\(away/).waitFor({ state: 'detached', timeout: 10000 })
  return `back for Hana ${Date.now() - t0} ms after Gil moved`
})

await step('while Hana (in control) is away, Gil can take control; Hana takes it back when she returns', async () => {
  await bar(gil.page).getByRole('button', { name: 'Take control', exact: true }).waitFor({ state: 'detached', timeout: 1000 }).catch(() => {})
  if (await bar(gil.page).getByRole('button', { name: 'Take control', exact: true }).count()) throw new Error('offered while Hana is active')
  await inactiveFor(HANA, 11)
  await bar(gil.page).getByRole('button', { name: 'Take control', exact: true }).click({ timeout: 10000 })
  await bar(gil.page).getByText('You’re in control').waitFor({ timeout: 10000 })
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/8-host-returns.png` })
  await bar(hana.page).getByRole('button', { name: 'Take control back' }).click()
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 10000 })
  const events = await sql(`select string_agg(event, ',' order by id) from collaboration_events where event in ('control_taken_while_away', 'control_reclaimed')`)
  if (!events.includes('control_taken_while_away')) throw new Error(`events: ${events}`)
})

await step('both see a warning 5 minutes before an inactivity end; "I’m still here" clears it', async () => {
  await inactiveFor(HANA, 26)
  await inactiveFor(GIL, 26)
  await bar(hana.page).getByText(/Nobody has been active for a while — the session ends in [1-5] minutes?/).waitFor({ timeout: 10000 })
  await bar(gil.page).getByText(/the session ends in [1-5] minutes?/).waitFor({ timeout: 10000 })
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/9-ending-warning.png` })
  await bar(hana.page).getByRole('button', { name: 'I’m still here' }).click()
  await bar(hana.page).getByText(/the session ends in/).waitFor({ state: 'detached', timeout: 10000 })
})

await step('Hana adds Vera as a viewer on the conversation page; both bars list her', async () => {
  await bar(hana.page).getByRole('link', { name: 'Add viewers' }).click()
  await hana.page.getByRole('heading', { name: 'Viewers' }).waitFor({ timeout: 15000 })
  await hana.page.getByRole('button', { name: 'Add a viewer' }).click()
  await hana.page.getByRole('button', { name: /Add Vera Viewer/ }).click()
  await hana.page.locator('#viewers').getByText('Vera Viewer').waitFor({ timeout: 10000 })
  await bar(hana.page).getByText('Viewers: Vera Viewer').waitFor({ timeout: 10000 })
  await bar(gil.page).getByText('Viewers: Vera Viewer').waitFor({ timeout: 10000 })
  await clientNav(hana.page, `/projects/${P}/workstreams/${W2}`)
  await waitPath(gil.page, `/projects/${P}/workstreams/${W2}`)
})

let veraStatusCalls = []
vera.page.on('request', (r) => {
  const m = /rpc\/(collaboration_[a-z_]+)/.exec(r.url())
  if (m) veraStatusCalls.push({ fn: m[1], at: Date.now() })
})
await step('Vera is told the session is live, without watching; Watch makes her tab follow Hana, with no controls', async () => {
  await vera.page.goto(`${BASE}/dashboard`)
  await bar(vera.page).getByText('Hana Host and Gil Guest are live on Harbour Dispatch Upgrade').waitFor({ timeout: 15000 })
  if (veraStatusCalls.some((c) => c.fn === 'collaboration_watch_status')) throw new Error('polled the session before Watch')
  if (SHOTS) await vera.page.screenshot({ path: `${SHOTS}/10-viewer-watch-offer.png` })
  await bar(vera.page).getByRole('button', { name: 'Watch' }).click()
  await waitPath(vera.page, `/projects/${P}/workstreams/${W2}`)
  await bar(vera.page).getByText('Watching live · Harbour Dispatch Upgrade').waitFor({ timeout: 10000 })
  await bar(hana.page).getByText('Vera Viewer (watching)').waitFor({ timeout: 10000 })
  t0 = Date.now()
  await clientNav(hana.page, `/projects/${P}/workstreams/${W1}`)
  await waitPath(vera.page, `/projects/${P}/workstreams/${W1}`)
  const latency = Date.now() - t0
  for (const name of ['Ask for control', 'Take control', 'Leave', 'End session']) {
    if (await bar(vera.page).getByRole('button', { name, exact: true }).count()) throw new Error(`viewer offered ${name}`)
  }
  if (SHOTS) await vera.page.screenshot({ path: `${SHOTS}/11-viewer-watching.png` })
  return `viewer followed in ${latency} ms`
})

await step('Vera sees the conversation as a viewer; wandering off and Follow again work for her too', async () => {
  await bar(vera.page).getByRole('link', { name: 'Shared conversation' }).click()
  await vera.page.getByText('You’re a viewer of this conversation.').waitFor({ timeout: 15000 })
  await vera.page.getByRole('heading', { name: 'Hana Host & Gil Guest' }).waitFor()
  if (await vera.page.getByRole('button', { name: /resume/ }).count()) throw new Error('viewer offered resume')
  await bar(vera.page).getByText('stepped away from the shared view').waitFor({ timeout: 10000 })
  await bar(vera.page).getByRole('button', { name: 'Follow again' }).click()
  await waitPath(vera.page, `/projects/${P}/workstreams/${W1}`)
})

await step('Vera stops watching: Hana no longer sees her watching, and her tab stops polling the session', async () => {
  await bar(vera.page).getByRole('button', { name: 'Stop watching' }).click()
  await bar(vera.page).getByRole('button', { name: 'Watch' }).waitFor({ timeout: 10000 })
  await bar(hana.page).getByText('Vera Viewer (watching)').waitFor({ state: 'detached', timeout: 10000 })
  const stoppedAt = Date.now()
  await vera.page.waitForTimeout(6000)
  const after = veraStatusCalls.filter((c) => c.at > stoppedAt + 500 && c.fn === 'collaboration_watch_status')
  if (after.length) throw new Error(`${after.length} session polls after stopping`)
  const general = veraStatusCalls.filter((c) => c.at > stoppedAt && c.fn === 'collaboration_status').length
  return `${general} general status check(s) in 6 s, no session polls`
})

await step('a page that is not shared is never mirrored', async () => {
  const gilWasAt = new URL(gil.page.url()).pathname
  await clientNav(hana.page, `/projects/${P}/members`)
  await waitPath(hana.page, `/projects/${P}/members`)
  await bar(hana.page).getByText('This page isn’t shared').waitFor({ timeout: 10000 })
  await gil.page.waitForTimeout(4000)
  if (new URL(gil.page.url()).pathname !== gilWasAt) throw new Error(`Gil moved to ${gil.page.url()}`)
  await clientNav(hana.page, `/projects/${P}`)
  await waitPath(gil.page, `/projects/${P}`)
})

await step('a second tab for Gil must take over explicitly; the old tab then stands down', async () => {
  gil2 = await gil.ctx.newPage()
  await applyNetwork(gil2)
  await gil2.goto(`${BASE}/projects/${P}`)
  await bar(gil2).getByText('open in another of your tabs').waitFor({ timeout: 20000 })
  await bar(gil2).getByRole('button', { name: 'Use this tab instead' }).click()
  await bar(gil2).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 10000 })
  await bar(gil.page).getByText('open in another of your tabs').waitFor({ timeout: 10000 })
  await gil.page.close()
})

await step('Gil leaves; Hana sees it; Gil rejoins', async () => {
  await bar(gil2).getByRole('button', { name: 'Leave' }).click()
  await bar(hana.page).getByText('Gil Guest left the session').waitFor({ timeout: 10000 })
  await bar(gil2).getByRole('button', { name: 'Rejoin' }).click()
  await bar(gil2).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 10000 })
})

await step('when Gil closes his tab, Hana sees "not connected" at once; a new tab joins without a take-over prompt', async () => {
  t0 = Date.now()
  await gil2.close({ runBeforeUnload: true })
  await bar(hana.page).getByText('Gil Guest isn’t connected right now').waitFor({ timeout: 10000 })
  const shown = Date.now() - t0
  gil2 = await gil.ctx.newPage()
  await applyNetwork(gil2)
  await gil2.goto(`${BASE}/dashboard`)
  await waitPath(gil2, `/projects/${P}`, 20000)
  await bar(gil2).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 10000 })
  return `shown ${shown} ms after closing (presence window is 90 s)`
})

await step('Hana ends the session (with confirmation); both see it ended; conversation in both histories', async () => {
  await bar(hana.page).getByRole('button', { name: 'End session' }).click()
  await bar(hana.page).getByText('End for both of you?').waitFor()
  await bar(hana.page).getByRole('button', { name: 'End session' }).click()
  await bar(gil2).getByText('The host ended the live session').waitFor({ timeout: 15000 })
  await bar(hana.page).getByText('The host ended the live session').waitFor({ timeout: 15000 })
  await bar(gil2).getByRole('link', { name: 'Open shared conversation' }).click()
  await gil2.getByRole('heading', { name: 'With Hana Host' }).waitFor({ timeout: 15000 })
  await gil2.getByText('ended by the host').waitFor()
  if (SHOTS) await gil2.screenshot({ path: `${SHOTS}/6-shared-conversation.png` })
  const rows = await sql(`select count(*) from collaboration_conversations`)
  if (rows !== '1') throw new Error(`expected one conversation, found ${rows}`)
})

await step('Gil invites Hana to resume from the shared conversation; Hana accepts; Gil hosts', async () => {
  await gil2.getByRole('button', { name: 'Invite Hana Host to resume' }).click()
  await bar(hana.page).getByText('Gil Guest invited you').waitFor({ timeout: 20000 })
  await bar(hana.page).getByRole('button', { name: 'Accept' }).click()
  await waitPath(hana.page, `/projects/${P}`)
  await bar(hana.page).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 20000 })
  // Gil is on the conversation page, which isn't shared; his bar says so.
  await bar(gil2).getByText('This page isn’t shared').waitFor({ timeout: 10000 })
  await gil2.getByText('· live now').waitFor({ timeout: 10000 })
  const host = await sql(`select host_id from collaboration_sessions where status='active'`)
  if (host !== 'a0000000-0000-4000-8000-000000000002') throw new Error(`host is ${host}`)
})

await step('a session where one person has been inactive for an hour ends on its own; both are told why', async () => {
  await inactiveFor(HANA, 61)
  await bar(gil2).getByText('one of you was inactive for an hour').waitFor({ timeout: 15000 })
  await bar(hana.page).getByText('one of you was inactive for an hour').waitFor({ timeout: 40000 })
  await gil2.reload()
  await gil2.getByText('· ended after one of you was inactive').waitFor({ timeout: 10000 })
  // Resume for the next step.
  await gil2.getByRole('button', { name: 'Invite Hana Host to resume' }).click()
  await bar(hana.page).getByRole('button', { name: 'Accept' }).click({ timeout: 20000 })
  await bar(hana.page).getByRole('button', { name: 'Ask for control' }).waitFor({ timeout: 20000 })
})

await step('removing Gil from the Project ends the session for Hana', async () => {
  await sql(`update project_members set status='inactive' where user_id='a0000000-0000-4000-8000-000000000002'`)
  await bar(hana.page).getByText('no longer has access').waitFor({ timeout: 15000 })
  await sql(`update project_members set status='active' where user_id='a0000000-0000-4000-8000-000000000002'`)
})

await step('nothing was deleted: every session, participant and invitation row is still there', async () => {
  const counts = await sql(`select (select count(*) from collaboration_sessions)||'/'||(select count(*) from collaboration_participants)||'/'||(select count(*) from collaboration_invitations)`)
  if (counts !== '3/6/3') throw new Error(`sessions/participants/invitations = ${counts}`)
  return counts
})

await browser.close()
await db.end()
console.log('navigation kinds used:', navKinds.join(','))
console.log(failures ? `\n${failures} step(s) failed` : '\nAll two-browser steps passed.')
process.exit(failures ? 1 : 0)
