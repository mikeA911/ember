'use server'

import { createClient } from '@/lib/supabase/server'

// Returns the signed-in user's profile, creating one only for an anonymous
// Supabase session (profiles_insert_self_anonymous). Self-registration is
// off (20261009100001_disable_self_registration.sql): an admin creates every
// real account together with its profile (createUserAction), so a real user
// with no profile -- someone who signed up straight against Supabase Auth --
// gets null and no account. role/is_active/assigned_kbs changes only happen
// through the admin Server Actions (service-role client).
export async function ensureProfile() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) return null

  const { data: existing } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  if (existing) return existing
  if (!user.is_anonymous) return null

  const { data: created, error } = await supabase
    .from('profiles')
    .insert({
      id: user.id,
      email: user.email ?? null,
      full_name: null,
      role: 'anonymous',
      is_active: true,
      assigned_kbs: [],
    })
    .select()
    .single()

  if (error) throw error
  return created
}
