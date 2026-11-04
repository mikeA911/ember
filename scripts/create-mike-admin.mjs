// One-off: provision a permanent admin account for the real owner (not a
// throwaway test-*@kbsandbox.local account). Sets a random password
// server-side but never prints it -- the account is meant to be claimed via
// the app's own /forgot-password flow, not a chat-shared credential.
import { createClient } from '@supabase/supabase-js'
import crypto from 'node:crypto'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const email = 'mike.aguilar@gmail.com'
const throwawayPassword = crypto.randomBytes(24).toString('base64url')

async function findUserByEmail(targetEmail) {
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 })
    if (error) throw error
    const match = data.users.find((u) => u.email === targetEmail)
    if (match) return match
    if (data.users.length < 200) return null
    page++
  }
}

let userId
const { data: created, error: createError } = await admin.auth.admin.createUser({
  email,
  password: throwawayPassword,
  email_confirm: true,
})

if (createError) {
  const existing = await findUserByEmail(email)
  if (!existing) throw createError
  userId = existing.id
  console.log(`Auth user already existed (${userId}) -- leaving its password untouched.`)
} else {
  userId = created.user.id
  console.log(`Created auth user ${userId}. Use "Forgot password?" on the deployed site to set a real password.`)
}

const { error: profileError } = await admin.from('profiles').upsert(
  {
    id: userId,
    email,
    full_name: 'Mike Aguilar',
    role: 'admin',
    is_active: true,
    // No assigned_kbs: the original four (fhir, vbc, grants, billing) are
    // retained for reference only, and the database refuses new
    // assignments to them (20260824120001_knowledge_base_classification.sql).
    // Admins reach every knowledge base anyway.
  },
  { onConflict: 'id' }
)
if (profileError) throw profileError

console.log(`Profile upserted: ${email} -> role=admin, is_active=true.`)
