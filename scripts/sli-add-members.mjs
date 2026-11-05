// Adds people to an Ember SLI organisation (run scripts/sli-setup.mjs first).
// For each person in a JSON list it creates the account if needed, with a
// random temporary password they must change at first sign-in, then their
// profile (role member; an existing role is never changed), organisation
// membership and department membership. Safe to re-run, and works for
// accounts that already exist (for example ones created in Ember Core's
// admin pages): they are added to the organisation and departments too.
//
// The file is the truth for each listed person's departments: they end up
// in exactly the departments listed for them, and taken out of any other
// (the output says so). Someone in two departments is listed twice, once
// per department. People not in the file are never touched.
//
//   node --env-file=.env.local scripts/sli-add-members.mjs sli-members.local.json [--org sandz] [--reset-passwords] [--shared-password]
//
// The list (keep real lists out of git: *.local.json is ignored):
//   [{ "email": "...", "name": "...", "department": "discovery", "role": "lead" | "member", "sponsor": true, "decides": true }]
// department is a department code from sli-setup.mjs: discovery, marketing,
// sales, presales, engineering, delivery, support. sponsor only matters for
// the Discovery team. "decides": true makes that person the organisation's
// decision authority on Triggers (one per organisation; it replaces any
// other). A dated delegate is named by the decider on SLI Home.
//
// Temporary passwords are printed once, here, for you to hand over privately.
// They are not stored anywhere else. --reset-passwords gives existing
// accounts in the list a new temporary password too.
//
// --shared-password asks you (typed hidden, never printed) for one temporary
// password used for every new account instead. Simpler to hand out, but
// until each person changes it, anyone who knows it can sign in as them, so
// ask everyone to sign in and change it the same day.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'
import fs from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const file = process.argv[2]
if (!file || file.startsWith('--')) throw new Error('Usage: node --env-file=.env.local scripts/sli-add-members.mjs <members.json> [--org sandz] [--reset-passwords]')
const orgIndex = process.argv.indexOf('--org')
const orgSlug = orgIndex > -1 ? process.argv[orgIndex + 1] : 'sandz'
const resetPasswords = process.argv.includes('--reset-passwords')
const useSharedPassword = process.argv.includes('--shared-password')

function askHidden(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin
    if (!stdin.isTTY) return reject(new Error('Run this in a terminal so the password can be typed hidden.'))
    process.stdout.write(prompt)
    let value = ''
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        stdin.setRawMode(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (ch === '\u0003') {
        stdin.setRawMode(false)
        process.stdout.write('\n')
        process.exit(130)
      } else if (ch === '\u007f' || ch === '\b') {
        value = value.slice(0, -1)
      } else {
        value += ch
      }
    }
    stdin.on('data', onData)
  })
}

let sharedPassword = null
if (useSharedPassword) {
  sharedPassword = await askHidden('Shared temporary password (at least 12 characters): ')
  if (sharedPassword.length < 12) throw new Error('Use at least 12 characters.')
  if ((await askHidden('Type it again: ')) !== sharedPassword) throw new Error('The two entries differ. Nothing changed.')
}

const people = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!Array.isArray(people) || people.length === 0) throw new Error('The members file must be a non-empty JSON array')
for (const p of people) {
  if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new Error(`Invalid email: ${JSON.stringify(p.email)}`)
  if (!p.department) throw new Error(`No department for ${p.email}`)
  if (p.role && !['lead', 'member'].includes(p.role)) throw new Error(`role must be lead or member for ${p.email}`)
}

// Readable but strong: three groups of five from an unambiguous alphabet.
function temporaryPassword() {
  if (sharedPassword) return sharedPassword
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789'
  const group = () => Array.from(crypto.randomBytes(5), (b) => alphabet[b % alphabet.length]).join('')
  return `${group()}-${group()}-${group()}`
}

const db = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

const org = must(await db.from('organizations').select('id, name').eq('slug', orgSlug).maybeSingle(), 'Organisation')
if (!org) throw new Error(`No organisation "${orgSlug}". Run scripts/sli-setup.mjs first.`)
const departments = must(await db.from('sli_departments').select('id, code, name').eq('organization_id', org.id), 'Departments')
const deptByCode = Object.fromEntries(departments.map((d) => [d.code, d]))

const allUsers = []
for (let page = 1; ; page++) {
  const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 })
  if (error) throw error
  allUsers.push(...data.users)
  if (data.users.length < 200) break
}

// One person per email, with every department listed for them.
const byEmail = new Map()
for (const p of people) {
  const email = p.email.trim().toLowerCase()
  const dept = deptByCode[p.department]
  if (!dept) throw new Error(`Unknown department "${p.department}" for ${email}. Known: ${Object.keys(deptByCode).join(', ')}`)
  const person = byEmail.get(email) ?? { email, name: null, entries: [], decides: false }
  person.name = person.name ?? (p.name?.trim() || null)
  person.decides = person.decides || p.decides === true
  if (person.entries.some((e) => e.dept.id === dept.id)) throw new Error(`${email} is listed twice for ${dept.name}`)
  person.entries.push({ dept, role: p.role ?? 'member', sponsor: p.sponsor === true })
  byEmail.set(email, person)
}

const handout = []
for (const person of byEmail.values()) {
  const { email, name } = person

  let user = allUsers.find((u) => u.email?.toLowerCase() === email)
  let password = null
  if (!user) {
    password = temporaryPassword()
    const { data, error } = await db.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { must_change_password: true, ...(name ? { full_name: name } : {}) },
    })
    if (error) throw new Error(`Create ${email}: ${error.message}`)
    user = data.user
  } else if (resetPasswords) {
    password = temporaryPassword()
    const { error } = await db.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: { ...(user.user_metadata ?? {}), must_change_password: true },
    })
    if (error) throw new Error(`Reset ${email}: ${error.message}`)
  }

  const profile = must(await db.from('profiles').select('id, role, full_name').eq('id', user.id).maybeSingle(), `Profile ${email}`)
  if (!profile) {
    must(await db.from('profiles').insert({ id: user.id, email, full_name: name, role: 'member', is_active: true }), `Profile ${email}`)
  } else if (!profile.full_name && name) {
    must(await db.from('profiles').update({ full_name: name }).eq('id', user.id), `Profile ${email}`)
  }

  const defaults = must(await db.from('organization_members').select('organization_id').eq('user_id', user.id).eq('is_default', true), 'Default org')
  const existingMember = must(
    await db.from('organization_members').select('role').eq('organization_id', org.id).eq('user_id', user.id).maybeSingle(),
    'Membership'
  )
  must(
    await db.from('organization_members').upsert(
      {
        organization_id: org.id,
        user_id: user.id,
        role: existingMember?.role ?? 'member',
        status: 'active',
        is_default: defaults.length === 0 || defaults[0].organization_id === org.id,
      },
      { onConflict: 'organization_id,user_id' }
    ),
    `Membership ${email}`
  )
  for (const e of person.entries) {
    must(
      await db.from('sli_department_members').upsert(
        {
          organization_id: org.id,
          department_id: e.dept.id,
          user_id: user.id,
          role: e.role,
          can_sponsor: e.dept.code === 'discovery' && e.sponsor,
          status: 'active',
        },
        { onConflict: 'department_id,user_id' }
      ),
      `Department ${email}`
    )
  }
  // Out of any department not listed for them.
  const listed = new Set(person.entries.map((e) => e.dept.id))
  const current = must(
    await db.from('sli_department_members').select('department_id').eq('organization_id', org.id).eq('user_id', user.id).eq('status', 'active'),
    `Departments ${email}`
  )
  const removed = []
  for (const row of current.filter((r) => !listed.has(r.department_id))) {
    must(
      await db.from('sli_department_members').update({ status: 'inactive' }).eq('department_id', row.department_id).eq('user_id', user.id),
      `Remove ${email}`
    )
    removed.push(departments.find((d) => d.id === row.department_id)?.name ?? 'a department')
  }

  if (person.decides) {
    must(await db.from('sli_decision_authorities').delete().eq('organization_id', org.id).eq('kind', 'decider').neq('user_id', user.id), 'Decider')
    const existing = must(
      await db.from('sli_decision_authorities').select('id').eq('organization_id', org.id).eq('kind', 'decider').eq('user_id', user.id),
      'Decider'
    )
    if (existing.length === 0) {
      must(await db.from('sli_decision_authorities').insert({ organization_id: org.id, user_id: user.id, kind: 'decider' }), `Decider ${email}`)
    }
  }
  const depts = person.entries.map((e) => `${e.dept.name} (${e.role}${e.dept.code === 'discovery' && e.sponsor ? ', sponsor' : ''})`).join(', ')
  handout.push({ email, department: depts + (person.decides ? ', decides' : ''), removed, password })
}

console.log(`\n${org.name}: ${handout.length} people set up.\n`)
for (const h of handout) {
  const status = !h.password ? 'existing account, password unchanged' : sharedPassword ? 'shared temporary password' : `temporary password: ${h.password}`
  console.log(`${h.email.padEnd(36)} ${h.department.padEnd(32)} ${status}`)
  if (h.removed.length > 0) console.log(`${''.padEnd(36)} taken out of ${h.removed.join(', ')}`)
}
if (sharedPassword && handout.some((h) => h.password)) {
  console.log('\nEveryone listed as "shared temporary password" signs in with the password you typed and chooses their own at first sign-in.')
  console.log('Ask them to do it today: until they do, anyone who knows the shared password can sign in as them.')
} else if (handout.some((h) => h.password)) {
  console.log('\nGive each person their temporary password privately. They choose their own at first sign-in.')
  console.log('Don\'t paste this output into chats, tickets or documents.')
}
