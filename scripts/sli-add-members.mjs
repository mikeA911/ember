// Adds people to an Ember SLI organisation (run scripts/sli-setup.mjs first).
// For each person in a JSON list it creates the account if needed, with a
// random temporary password they must change at first sign-in, then their
// profile (role member; an existing role is never changed), organisation
// membership and department membership. Safe to re-run.
//
//   node --env-file=.env.local scripts/sli-add-members.mjs sli-members.local.json [--org sandz] [--reset-passwords]
//
// The list (keep real lists out of git: *.local.json is ignored):
//   [{ "email": "...", "name": "...", "department": "discovery", "role": "lead" | "member", "sponsor": true }]
// department is a department code from sli-setup.mjs: discovery, marketing,
// sales, presales, engineering, delivery, support. sponsor only matters for
// the Discovery team.
//
// Temporary passwords are printed once, here, for you to hand over privately.
// They are not stored anywhere else. --reset-passwords gives existing
// accounts in the list a new temporary password too.
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

const people = JSON.parse(fs.readFileSync(file, 'utf8'))
if (!Array.isArray(people) || people.length === 0) throw new Error('The members file must be a non-empty JSON array')
for (const p of people) {
  if (!p.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email)) throw new Error(`Invalid email: ${JSON.stringify(p.email)}`)
  if (!p.department) throw new Error(`No department for ${p.email}`)
  if (p.role && !['lead', 'member'].includes(p.role)) throw new Error(`role must be lead or member for ${p.email}`)
}

// Readable but strong: three groups of five from an unambiguous alphabet.
function temporaryPassword() {
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

const handout = []
for (const p of people) {
  const email = p.email.trim().toLowerCase()
  const dept = deptByCode[p.department]
  if (!dept) throw new Error(`Unknown department "${p.department}" for ${email}. Known: ${Object.keys(deptByCode).join(', ')}`)
  const name = p.name?.trim() || null

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
  must(
    await db.from('sli_department_members').upsert(
      {
        organization_id: org.id,
        department_id: dept.id,
        user_id: user.id,
        role: p.role ?? 'member',
        can_sponsor: dept.code === 'discovery' && p.sponsor === true,
        status: 'active',
      },
      { onConflict: 'department_id,user_id' }
    ),
    `Department ${email}`
  )
  handout.push({ email, department: dept.name, role: p.role ?? 'member', password })
}

console.log(`\n${org.name}: ${handout.length} people set up.\n`)
for (const h of handout) {
  console.log(`${h.email.padEnd(36)} ${`${h.department} (${h.role})`.padEnd(28)} ${h.password ? `temporary password: ${h.password}` : 'existing account, password unchanged'}`)
}
if (handout.some((h) => h.password)) {
  console.log('\nGive each person their temporary password privately. They choose their own at first sign-in.')
  console.log('Don\'t paste this output into chats, tickets or documents.')
}
