// Shared workspace sessions, Phase 4: what happens when a connection drops
// -- two browsers against the local stack in scripts/local-e2e/README.md,
// one going offline for a short and a long time, the person in control
// going offline, and an administrator ending a session from the Admin
// page. Combine with E2E_NETWORK=slow|lossy (network.mjs) to run it on a
// poor network as well. Prints pass/FAIL per step; exits 1 on any failure.
// Resets only the collaboration tables of the LOCAL database, and makes
// Olu a platform admin for the run (put back afterwards).
import { createRequire } from 'node:module'
import pg from 'pg'
import { applyNetwork, contextOptions, network, device } from './network.mjs'
const require = createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`)
const { chromium } = require('playwright-core')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const P = 'b0000000-0000-4000-8000-000000000001'
const W1 = 'c0000000-0000-4000-8000-000000000001'
const W2 = 'c0000000-0000-4000-8000-000000000002'
const OLU = 'a0000000-0000-4000-8000-000000000003'
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
  'truncate collaboration_proposal_uses, collaboration_summaries, collaboration_turns, collaboration_messages, collaboration_saves, collaboration_drafts, collaboration_events, collaboration_watchers, collaboration_viewers, collaboration_participants, collaboration_invitations, collaboration_sessions, collaboration_conversations'
)
const oluRole = await sql('select role from profiles where id = $1', [OLU])
await db.query("update profiles set role = 'admin' where id = $1", [OLU])

let failures = 0
const people = {}
const step = async (label, fn) => {
  const t = Date.now()
  try {
    for (const p of Object.values(people)) await p.ctx.setOffline(false)
    const extra = await fn()
    console.log(`pass  ${label}${extra ? ` (${extra})` : ''} [${Date.now() - t} ms]`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${label}: ${String(e.message).split('\n')[0]}`)
    if (SHOTS) for (const [who, p] of Object.entries(people)) await p.page.screenshot({ path: `${SHOTS}/net-fail-${failures}-${who}.png` }).catch(() => {})
  } finally {
    // A failed step never leaves anyone offline for the next one.
    for (const p of Object.values(people)) await p.ctx.setOffline(false).catch(() => {})
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
async function signIn(email) {
  const ctx = await browser.newContext(network || device ? contextOptions() : { viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  await applyNetwork(page)
  await page.goto(`${BASE}/login`)
  await page.locator('input').nth(0).fill(email)
  await page.locator('input').nth(1).fill('local-only')
  await page.locator('form button').first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
  return { ctx, page }
}
const bar = (page) => page.getByLabel('Live collaboration')
const waitPath = (page, path, timeout = 30000) => page.waitForURL((u) => u.pathname === path, { timeout })
const routerNav = (page, path) => page.evaluate((p) => window.next.router.push(p), path)
const controller = () => sql("select p.email from collaboration_sessions s join profiles p on p.id = s.controller_id where s.status = 'active'")
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const hana = (people.hana = await signIn('hana@e2e.local'))
const gil = (people.gil = await signIn('gil@e2e.local'))
let t0

try {
  await step('a live session starts (Hana in control)', async () => {
    await gil.page.goto(`${BASE}/dashboard`)
    await hana.page.goto(`${BASE}/projects/${P}`)
    await hana.page.getByRole('button', { name: 'Collaborate' }).click()
    await hana.page.getByRole('button', { name: /Gil Guest/ }).click()
    await hana.page.getByRole('button', { name: 'Send invitation' }).click()
    await bar(gil.page).getByRole('button', { name: 'Accept' }).click({ timeout: 30000 })
    await waitPath(gil.page, `/projects/${P}`)
    await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 30000 })
  })

  await step('Gil drops offline for 30 s while Hana moves on: he stays "connected", sees he is reconnecting, then catches up at once', async () => {
    await gil.ctx.setOffline(true)
    await routerNav(hana.page, `/projects/${P}/workstreams/${W1}`)
    await waitPath(hana.page, `/projects/${P}/workstreams/${W1}`)
    await bar(gil.page).getByText('Connection lost — reconnecting…').waitFor({ timeout: 30000 })
    await sleep(Math.max(0, 30000 - 5000))
    // Within the 90-second presence window: no "not connected" for Hana.
    if (await bar(hana.page).getByText('not connected').count()) throw new Error('shown as not connected after 30 s')
    t0 = Date.now()
    await gil.ctx.setOffline(false)
    await waitPath(gil.page, `/projects/${P}/workstreams/${W1}`)
    await bar(gil.page).getByText('Connection lost').waitFor({ state: 'detached', timeout: 15000 })
    if ((await controller()) !== 'hana@e2e.local') throw new Error('control moved')
    return `caught up ${Date.now() - t0} ms after reconnecting`
  })

  await step('Gil offline for over 90 s: Hana sees him "not connected", keeps control; he catches up when back', async () => {
    await gil.ctx.setOffline(true)
    await bar(hana.page).getByText('not connected').first().waitFor({ timeout: 120000 })
    await routerNav(hana.page, `/projects/${P}/workstreams/${W2}`)
    await waitPath(hana.page, `/projects/${P}/workstreams/${W2}`)
    if ((await controller()) !== 'hana@e2e.local') throw new Error('control moved')
    t0 = Date.now()
    await gil.ctx.setOffline(false)
    await waitPath(gil.page, `/projects/${P}/workstreams/${W2}`)
    await bar(hana.page).getByText('not connected').first().waitFor({ state: 'detached', timeout: 15000 })
    return `back and following ${Date.now() - t0} ms after reconnecting`
  })

  await step('Hana (in control) goes offline: control stays with her until Gil chooses to take it; she can take it back', async () => {
    await hana.ctx.setOffline(true)
    await bar(gil.page).getByText('not connected').first().waitFor({ timeout: 120000 })
    if ((await controller()) !== 'hana@e2e.local') throw new Error('control moved on its own')
    await bar(gil.page).getByRole('button', { name: 'Take control', exact: true }).click({ timeout: 10000 })
    await bar(gil.page).getByText('You’re in control').waitFor({ timeout: 15000 })
    await routerNav(gil.page, `/projects/${P}`)
    await waitPath(gil.page, `/projects/${P}`)
    await hana.ctx.setOffline(false)
    // Back online, Hana follows Gil and isn't in control any more.
    await waitPath(hana.page, `/projects/${P}`)
    await bar(hana.page).getByRole('button', { name: 'Take control back' }).click({ timeout: 15000 })
    await bar(hana.page).getByText('You’re in control').waitFor({ timeout: 15000 })
    if ((await controller()) !== 'hana@e2e.local') throw new Error('host could not take it back')
    const taken = await sql("select count(*)::int from collaboration_events where event = 'control_taken_while_away'")
    if (taken !== 1) throw new Error(`${taken} take-over events`)
  })

  await step('an administrator sees the session on Admin → Live collaboration and ends it; both bars say so', async () => {
    const olu = (people.olu = await signIn('olu@e2e.local'))
    await olu.page.goto(`${BASE}/admin`)
    await olu.page.getByRole('button', { name: 'Live collaboration' }).click({ timeout: 30000 })
    const card = olu.page.locator('[data-admin-session]').first()
    await card.getByText('Hana Host (connected) · Gil Guest (connected)').waitFor({ timeout: 30000 })
    if (SHOTS) await olu.page.screenshot({ path: `${SHOTS}/net-admin-overview.png`, fullPage: true })
    await card.getByRole('button', { name: 'End session…' }).click()
    await card.getByRole('button', { name: 'End session', exact: true }).click()
    await olu.page.getByText('Session ended.').waitFor({ timeout: 15000 })
    for (const p of [hana.page, gil.page]) await bar(p).getByText('An administrator ended the live session.').waitFor({ timeout: 30000 })
    const ended = await sql("select end_reason from collaboration_sessions order by started_at desc limit 1")
    if (ended !== 'ended_by_admin') throw new Error(ended)
    if ((await sql("select count(*)::int from collaboration_events e join profiles p on p.id = e.actor_id where e.event = 'ended:ended_by_admin' and p.email = 'olu@e2e.local'")) !== 1) throw new Error('not recorded')
  })

  await step('nobody else can open the admin view', async () => {
    await hana.page.goto(`${BASE}/admin`)
    await hana.page.waitForURL((u) => !u.pathname.startsWith('/admin'), { timeout: 15000 })
  })
} finally {
  await db.query('update profiles set role = $2 where id = $1', [OLU, oluRole])
  await browser.close()
  await db.end()
}
console.log(failures ? `\n${failures} step(s) failed` : `\nAll network steps passed${network ? ` (${network} network)` : ''}.`)
process.exit(failures ? 1 : 0)
