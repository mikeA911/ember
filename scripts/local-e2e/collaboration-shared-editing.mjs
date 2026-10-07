// Shared workspace sessions, Phase 2: two people edit the Project and a
// Workstream together in two separate browser contexts, through the real
// forms, against the local stack in scripts/local-e2e/README.md. Prints
// pass/FAIL per step; exits 1 on any failure. Resets only the
// collaboration tables and the seeded Project's editable fields of the
// LOCAL database.
import { createRequire } from 'node:module'
import pg from 'pg'
import { applyNetwork, contextOptions, network, device, slower } from './network.mjs'
const require = createRequire(`${process.env.PLAYWRIGHT_DIR ?? process.cwd()}/`)
const { chromium } = require('playwright-core')
const BASE = process.env.E2E_BASE_URL ?? 'http://localhost:3100'
const P = 'b0000000-0000-4000-8000-000000000001'
const W1 = 'c0000000-0000-4000-8000-000000000001'
const GIL = 'a0000000-0000-4000-8000-000000000002'
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
// Seeded memberships, whatever an earlier (failed) run left behind.
await db.query("update project_members set status = 'active', role = 'viewer' where project_id = 'b0000000-0000-4000-8000-000000000001' and user_id in ('a0000000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-000000000004')")
await db.query('update projects set goal = null, objective = $2, starter_prompt = null where id = $1', [P, 'Replace the CAD system at the harbour dispatch centre'])
await db.query(`update project_workstreams set summary = null, deliverables = '[{"label":"Call flow","completed":false},{"label":"Staffing plan","completed":false}]' where id = $1`, [W1])
await db.query("update project_members set role = 'viewer' where project_id = $1 and user_id = $2", [P, GIL])

// The database reaching a value, within a few seconds (the other browser
// may show the same text as a draft before the save commits).
const eventually = async (query, params, expected, label) => {
  const until = Date.now() + 5000
  let value
  while (Date.now() < until) {
    value = await sql(query, params)
    if (value === expected) return
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`${label}: ${JSON.stringify(value)}`)
}

let failures = 0
const step = async (label, fn) => {
  const t = Date.now()
  try {
    const extra = await fn()
    console.log(`pass  ${label}${extra ? ` (${extra})` : ''} [${Date.now() - t} ms]`)
  } catch (e) {
    failures++
    console.log(`FAIL  ${label}: ${process.env.E2E_VERBOSE ? e.message : String(e.message).split("\n")[0]}`)
    if (SHOTS) for (const [who, pg_] of [['hana', hana.page], ['gil', gil.page]]) await pg_.screenshot({ path: `${SHOTS}/p2-fail-${failures}-${who}.png` }).catch(() => {})
  }
}
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
async function signIn(email) {
  // E2E_NETWORK / E2E_DEVICE (network.mjs): a simulated network or screen.
  const ctx = await browser.newContext(network || device ? contextOptions() : { viewport: { width: 1280, height: 1000 } })
  const page = await ctx.newPage()
  await applyNetwork(page)
  await page.goto(`${BASE}/login`)
  await page.locator('input').nth(0).fill(email)
  await page.locator('input').nth(1).fill('local-only')
  await page.locator('form button').first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: slower(30000) })
  return { ctx, page }
}
const bar = (page) => page.getByLabel('Live collaboration')
const shared = (page, field) => page.locator(`[data-shared-field="${field}"]`)
const waitPath = (page, path, timeout = 15000) => page.waitForURL((u) => u.pathname === path, { timeout })
const routerNav = (page, path) => page.evaluate((p) => window.next.router.push(p), path)

const hana = await signIn('hana@e2e.local')
const gil = await signIn('gil@e2e.local')
let t0

await step('a live session starts (Hana in control on the Project page)', async () => {
  await gil.page.goto(`${BASE}/dashboard`)
  await hana.page.goto(`${BASE}/projects/${P}`)
  await hana.page.getByRole('button', { name: 'Collaborate' }).click()
  await hana.page.getByRole('button', { name: /Gil Guest/ }).click()
  await hana.page.getByRole('button', { name: 'Send invitation' }).click()
  await bar(gil.page).getByRole('button', { name: 'Accept' }).click({ timeout: slower(20000) })
  await waitPath(gil.page, `/projects/${P}`)
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: slower(20000) })
})

await step('Hana writes the goal as a shared draft; Gil sees it as she types, marked unsaved', async () => {
  await shared(hana.page, 'project_goal').getByRole('button', { name: '+ Add goal' }).click()
  const box = shared(hana.page, 'project_goal').locator('textarea')
  await box.waitFor({ timeout: slower(10000) })
  t0 = Date.now()
  await box.pressSequentially('Replace the CAD by March', { delay: 20 })
  await shared(gil.page, 'project_goal').getByText('Hana Host is editing — not saved yet').waitFor({ timeout: slower(10000) })
  await shared(gil.page, 'project_goal').getByText('Replace the CAD by March').waitFor({ timeout: slower(10000) })
  if (await shared(gil.page, 'project_goal').locator('textarea').count()) throw new Error('observer got an editable box')
  await bar(gil.page).getByText('Unsaved: Goal').waitFor({ timeout: slower(5000) })
  if (SHOTS) await gil.page.screenshot({ path: `${SHOTS}/p2-1-observer-sees-draft.png` })
  return `Gil saw the finished text ${Date.now() - t0} ms after Hana started typing`
})

await step('Hana saves; the goal is saved once and both pages show it', async () => {
  await shared(hana.page, 'project_goal').getByRole('button', { name: 'Save goal' }).click()
  await shared(gil.page, 'project_goal').getByText('Replace the CAD by March').waitFor({ timeout: slower(10000) })
  await shared(gil.page, 'project_goal').getByText('is editing').waitFor({ state: 'detached', timeout: slower(10000) })
  await eventually('select goal from projects where id = $1', [P], 'Replace the CAD by March', 'not saved')
  const saves = await sql("select count(*)::int from collaboration_saves where field = 'project_goal'")
  if (saves !== 1) throw new Error(`${saves} saves`)
})

await step('an edit made outside the session meanwhile is a conflict; Hana keeps her text deliberately', async () => {
  await shared(hana.page, 'project_goal').getByRole('button', { name: 'Edit' }).click()
  const box = shared(hana.page, 'project_goal').locator('textarea')
  await box.fill('Replace the CAD by April')
  await hana.page.waitForTimeout(800)
  await sql('update projects set goal = $2 where id = $1', [P, 'Changed in another tab'])
  await shared(hana.page, 'project_goal').getByText('This was changed outside the session').waitFor({ timeout: slower(10000) })
  await shared(hana.page, 'project_goal').getByText('Changed in another tab').waitFor()
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/p2-2-conflict.png` })
  if (await shared(hana.page, 'project_goal').getByRole('button', { name: 'Save goal' }).isEnabled()) throw new Error('save allowed during conflict')
  if ((await sql('select goal from projects where id = $1', [P])) !== 'Changed in another tab') throw new Error('overwritten')
  await shared(hana.page, 'project_goal').getByRole('button', { name: /Keep my text/ }).click()
  await shared(hana.page, 'project_goal').getByText('This was changed outside the session').waitFor({ state: 'detached', timeout: slower(10000) })
  await shared(hana.page, 'project_goal').getByRole('button', { name: 'Save goal' }).click()
  await shared(gil.page, 'project_goal').getByText('Replace the CAD by April').waitFor({ timeout: slower(10000) })
  await eventually('select goal from projects where id = $1', [P], 'Replace the CAD by April', 'not saved')
})

let granted
await step('in control, Gil (a Project viewer) can edit nothing; made a curator, he can edit the description but not the goal', async () => {
  await bar(gil.page).getByRole('button', { name: 'Ask for control' }).click()
  await bar(hana.page).getByRole('button', { name: 'Give control' }).click({ timeout: slower(10000) })
  await bar(gil.page).getByText('You’re in control').waitFor({ timeout: slower(10000) })
  await gil.page.waitForTimeout(2500)
  if (await gil.page.locator('[data-shared-field] button', { hasText: /^(Edit|\+ Add)/ }).count()) throw new Error('viewer offered an edit')
  await sql("update project_members set role = 'curator' where project_id = $1 and user_id = $2", [P, GIL])
  await shared(gil.page, 'project_objective').getByRole('button', { name: 'Edit' }).waitFor({ timeout: slower(10000) })
  if (await shared(gil.page, 'project_goal').getByRole('button', { name: 'Edit' }).count()) throw new Error('curator offered the goal')
  granted = true
})

await step('Gil drafts the description and hands control back without saving; Hana inherits his draft and saves it', async () => {
  if (!granted) throw new Error('needs the previous step')
  await shared(gil.page, 'project_objective').getByRole('button', { name: 'Edit' }).click()
  const box = shared(gil.page, 'project_objective').locator('textarea')
  await box.fill('Cut over to the new CAD with no missed calls')
  // Ask and give immediately: the typing must go out before control moves.
  await bar(hana.page).getByRole('button', { name: 'Ask for control' }).click()
  await bar(gil.page).getByRole('button', { name: 'Give control' }).click({ timeout: slower(10000) })
  await bar(hana.page).getByText('You’re in control').waitFor({ timeout: slower(10000) })
  const hanaBox = shared(hana.page, 'project_objective').locator('textarea')
  await hanaBox.waitFor({ timeout: slower(10000) })
  const inherited = await hanaBox.inputValue()
  if (inherited !== 'Cut over to the new CAD with no missed calls') throw new Error(`inherited "${inherited}"`)
  await shared(hana.page, 'project_objective').getByRole('button', { name: 'Save description' }).click()
  // Gil already sees this text as the draft; wait until it shows as saved.
  await shared(gil.page, 'project_objective').getByText('is editing').waitFor({ state: 'detached', timeout: slower(10000) })
  await shared(gil.page, 'project_objective').getByText('Cut over to the new CAD with no missed calls').waitFor({ timeout: slower(10000) })
  await eventually('select objective from projects where id = $1', [P], 'Cut over to the new CAD with no missed calls', 'not saved')
})

await step('on a workstream, Hana ticks a deliverable; it saves at once and Gil sees it ticked, read-only', async () => {
  await routerNav(hana.page, `/projects/${P}/workstreams/${W1}`)
  await waitPath(gil.page, `/projects/${P}/workstreams/${W1}`)
  const hanaBox = shared(hana.page, 'workstream_deliverables').locator('li', { hasText: 'Call flow' }).locator('input')
  await hanaBox.waitFor({ timeout: slower(10000) })
  t0 = Date.now()
  await hanaBox.click()
  const gilBox = shared(gil.page, 'workstream_deliverables').locator('li', { hasText: 'Call flow' }).locator('input')
  await gil.page.waitForFunction((el) => el.checked, await gilBox.elementHandle(), { timeout: slower(10000) })
  const latency = Date.now() - t0
  if (!(await gilBox.isDisabled())) throw new Error('observer can tick')
  const items = await sql('select deliverables from project_workstreams where id = $1', [W1])
  if (!items[0].completed || items[1].completed) throw new Error(JSON.stringify(items))
  return `Gil saw the tick ${latency} ms later`
})

await step('an unsaved summary is listed in the bar; ending warns, and the draft is never saved', async () => {
  await shared(hana.page, 'workstream_summary').getByRole('button', { name: '+ Add summary' }).click()
  await shared(hana.page, 'workstream_summary').locator('textarea').fill('Call flow mapped; staffing pending')
  await bar(gil.page).getByText('Unsaved: Summary (Call intake)').waitFor({ timeout: slower(10000) })
  await routerNav(hana.page, `/projects/${P}`)
  await waitPath(gil.page, `/projects/${P}`)
  await bar(hana.page).getByText('Unsaved: Summary (Call intake)').waitFor({ timeout: slower(10000) })
  await bar(hana.page).getByRole('button', { name: 'End session' }).click()
  await bar(hana.page).getByText('Unsaved Summary (Call intake) will not be saved.').waitFor()
  if (SHOTS) await hana.page.screenshot({ path: `${SHOTS}/p2-3-end-warning.png` })
  await bar(hana.page).getByRole('button', { name: 'End session' }).click()
  await bar(gil.page).getByText('The host ended the live session').waitFor({ timeout: slower(15000) })
  if ((await sql('select summary from project_workstreams where id = $1', [W1])) !== null) throw new Error('draft was saved')
  if ((await sql("select status from collaboration_drafts where field = 'workstream_summary'")) !== 'abandoned') throw new Error('draft not kept as abandoned')
})

await step('after the session the ordinary forms are back', async () => {
  await shared(hana.page, 'project_goal').waitFor({ state: 'detached', timeout: slower(10000) })
  await hana.page.locator('#goal').getByRole('button', { name: 'Edit' }).waitFor({ timeout: slower(10000) })
})

await browser.close()
await db.end()
console.log(failures ? `\n${failures} step(s) failed` : '\nAll shared-editing steps passed.')
process.exit(failures ? 1 : 0)
