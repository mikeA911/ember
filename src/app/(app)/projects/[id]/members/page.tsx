import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { MembersManager } from '@/components/projects/MembersManager'
import type { UserRole } from '@/types/database'

function platformRoleOf(role: UserRole | undefined) {
  return role && role !== 'anonymous' ? role : null
}

export default async function ProjectMembersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: project } = await supabase.from('projects').select('id, name, owner_id').eq('id', id).single()
  if (!project) notFound()

  // RLS (is_project_member) already gated the project select above; members
  // select is gated the same way, so this list is only ever what the viewer
  // is legitimately allowed to see.
  const { data: members } = await supabase.from('project_members').select('*').eq('project_id', id).order('created_at')

  const { data: viewerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
  const viewerMembership = (members ?? []).find((m) => m.user_id === user.id)
  const viewerIsAdmin = viewerProfile?.role === 'admin'
  // Curator = the department head (or their assistant) running this
  // project's own team -- confirmed by Mike 2026-09-03, they know their
  // staff and need to invite them directly. Matches can_curate_project
  // (owner/curator) on the DB side, see 20260903100001_curator_manages_
  // project_members.sql -- transferring ownership itself stays owner/admin
  // only (see canTransferOwnership below).
  const canManage = viewerIsAdmin || viewerMembership?.role === 'owner' || viewerMembership?.role === 'curator'
  if (!canManage) redirect(`/projects/${id}`)
  const canTransferOwnership = viewerIsAdmin || viewerMembership?.role === 'owner'

  // Member emails/platform roles are for display only -- project_members
  // itself (fetched above, RLS-checked) is the real authorization boundary.
  // profiles RLS only lets a caller see their own row or staff see everyone,
  // so a consultant-platform-role project owner can't read a co-member's
  // email/role through the normal client; the admin client here only ever
  // returns id+email+role, same narrow pattern as resolveUserIdsByEmail in
  // projects.ts. Showing platform role alongside Project role directly
  // addresses OL-005 (2026-08-31 builder-journey report): the two are easy
  // to conflate ("Platform Curator" vs "Project Curator" are different
  // things), and this page is already gated to owner/curator/admin viewers.
  const admin = createAdminClient()
  const { data: profiles } = await admin
    .from('profiles')
    .select('id, email, role')
    .in('id', (members ?? []).map((m) => m.user_id))
  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]))

  return (
    <MembersManager
      projectId={id}
      projectName={project.name}
      members={(members ?? []).map((m) => ({
        ...m,
        email: profileById.get(m.user_id)?.email ?? m.user_id,
        // 'anonymous' isn't an assignable platform role in the members UI.
        platformRole: platformRoleOf(profileById.get(m.user_id)?.role),
      }))}
      currentUserId={user.id}
      viewerIsAdmin={viewerIsAdmin}
      canTransferOwnership={canTransferOwnership}
    />
  )
}
