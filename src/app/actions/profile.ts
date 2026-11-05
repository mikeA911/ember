'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

// Self-service, full_name only -- profiles has no client-facing update RLS
// policy at all (role/is_active/assigned_kbs stay admin-Server-Action-only,
// see 20260808190010_rls_policies.sql's comment), so this uses the
// service-role client the same way the admin actions do, just hardcoded to
// the caller's own id rather than an admin-supplied one -- there's no
// user-controlled id parameter here, so this can't touch anyone else's row.
export async function updateOwnFullNameAction(fullName: string) {
  const { user } = await requireUser()
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ full_name: fullName || null }).eq('id', user.id)
  if (error) throw error
  revalidatePath('/profile')
  revalidatePath('/sli', 'layout')
}
