import { notFound } from 'next/navigation'
import { requireUser } from '@/lib/auth'
import { listMemberProjectOptions } from '@/lib/projects/queries'
import { CollaborationWorkspace } from '@/components/collaboration/CollaborationWorkspace'
import type { SharedHistoryItem } from '@/lib/collaboration/contracts'

export default async function CollaborationPage() {
  if (process.env.NEXT_PUBLIC_EMBER_COLLABORATION !== 'true') notFound()
  const { user, supabase } = await requireUser()
  const projects = await listMemberProjectOptions(supabase, user.id)
  const { data: memberships, error } = projects.length
    ? await supabase.from('project_members').select('project_id,user_id,profiles!project_members_user_id_fkey(full_name)')
      .in('project_id', projects.map(p => p.id)).eq('status', 'active').neq('user_id', user.id)
    : { data: [], error: null }
  if (error) throw new Error('Could not load Project members')
  const members = (memberships ?? []).map(m => ({
    project: m.project_id, id: m.user_id,
    name: (m.profiles as unknown as { full_name: string | null } | null)?.full_name ?? 'Project member',
  }))
  const { data: history, error: historyError } = await supabase.rpc('collaboration_command', { p_command: 'history' })
  if (historyError) return <p>Collaboration is not available yet. Please contact the deployment administrator.</p>
  return <CollaborationWorkspace userId={user.id} projects={projects} members={members} initialHistory={history as SharedHistoryItem[]} />
}
