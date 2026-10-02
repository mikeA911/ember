import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'

export interface SelectableUser {
  email: string
  fullName: string | null
}

// Directory of active accounts for the "add member" pickers (members page,
// new-project wizard). profiles RLS only lets non-staff read their own row, so
// this goes through the admin client -- callers must already have gated the
// page to someone allowed to add members. Returns email + display name only,
// the same narrow shape the members page already shows for existing members.
export async function listSelectableUsers(): Promise<SelectableUser[]> {
  const { data, error } = await createAdminClient()
    .from('profiles')
    .select('email, full_name')
    .eq('is_active', true)
    .not('email', 'is', null)
    .order('email')
  if (error) throw new Error(error.message)
  return (data ?? []).map((p) => ({ email: p.email as string, fullName: p.full_name }))
}
