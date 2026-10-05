import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Shared by the requirements pages: the Project (RLS returns it only to a
// member or admin) and whether the viewer can change the register -- the
// same can_curate_project bar as the write policies.
export async function loadRequirementsPageContext(supabase: SupabaseClient<Database>, projectId: string, userId: string) {
  const [{ data: project }, { data: profile }, { data: membership }] = await Promise.all([
    supabase.from('projects').select('id, name').eq('id', projectId).maybeSingle(),
    supabase.from('profiles').select('role').eq('id', userId).single(),
    supabase.from('project_members').select('role').eq('project_id', projectId).eq('user_id', userId).eq('status', 'active').maybeSingle(),
  ])
  const canCurate = profile?.role === 'admin' || membership?.role === 'owner' || membership?.role === 'curator'
  return { project, canCurate, isMember: !!membership || profile?.role === 'admin' }
}
