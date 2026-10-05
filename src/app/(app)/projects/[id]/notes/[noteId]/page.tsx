import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProjectNote, listNoteReplies } from '@/lib/projects/notes'
import { ProjectNoteThread } from '@/components/projects/ProjectNoteThread'
import { AccessRequestDecisionActions } from '@/components/projects/AccessRequestDecisionActions'
import type { ResourceAccessRequest } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  open: 'bg-amber-100 text-amber-800',
  resolved: 'bg-green-100 text-green-800',
}

// Context is a polymorphic (type, id) pair with no FK -- only a couple of
// types are resolved to a real link today; every other type (or an unknown
// one) degrades to a plain, non-linked label rather than a broken link.
// workstream_artifact has no standalone page -- it resolves to its parent
// workstream page, deep-linked to the artifact's card (see the `id={a.id}`
// anchor on each card in workstreams/[workstreamId]/page.tsx).
async function contextLink(
  supabase: Awaited<ReturnType<typeof createClient>>,
  contextType: string | null,
  contextId: string | null,
  projectId: string,
): Promise<{ href: string | null; label: string; request?: ResourceAccessRequest } | null> {
  if (!contextType || !contextId) return null
  if (contextType === 'eval_run') return { href: `/evals/runs/${contextId}`, label: 'Eval run' }
  if (contextType === 'knowledge_gap') return { href: `/projects/${projectId}#knowledge-gaps`, label: 'Knowledge gaps' }
  if (contextType === 'workstream') return { href: `/projects/${projectId}/workstreams/${contextId}`, label: 'Workstream' }
  if (contextType === 'workstream_artifact') {
    const { data: artifact } = await supabase.from('workstream_artifacts').select('workstream_id, title').eq('id', contextId).maybeSingle()
    if (!artifact) return { href: null, label: 'Artifact (deleted or not visible)' }
    return { href: `/projects/${projectId}/workstreams/${artifact.workstream_id}#${contextId}`, label: `Artifact: ${artifact.title}` }
  }
  if (contextType === 'resource_access_request') {
    // resource_access_requests_select_own_or_manager already scopes this to
    // the requester or the decider -- whoever is reading this note. The
    // resource's own title needs the admin client regardless: the whole
    // premise of this note is that the requester (very likely this viewer)
    // does NOT have has_evidence_access on it yet. Only knowledge_source is
    // produced by requestResourceAccess today (src/lib/projects/access-
    // requests.ts) -- the other two EvidenceResourceType values degrade to
    // the plain resource_type label below if this ever expands.
    const { data: request } = await supabase.from('resource_access_requests').select('*').eq('id', contextId).maybeSingle()
    if (!request) return { href: null, label: 'Access request (deleted)' }
    let title = request.resource_type.replace('_', ' ')
    if (request.resource_type === 'knowledge_source') {
      const { data: source } = await createAdminClient().from('knowledge_sources').select('title').eq('id', request.resource_id).maybeSingle()
      if (source) title = source.title
    }
    // Only link through once approved -- before that, the whole point is
    // the viewer (very likely the requester) can't open it yet.
    return { href: request.status === 'approved' ? `/sources/${request.resource_id}` : null, label: `Access request: ${title}`, request }
  }
  return { href: null, label: contextType }
}

export default async function ProjectNoteDetailPage({ params }: { params: Promise<{ id: string; noteId: string }> }) {
  const { id, noteId } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const note = await getProjectNote(supabase, noteId)
  if (!note || note.project_id !== id) notFound()

  const [replies, { data: viewerProfile }, { data: viewerMembership }] = await Promise.all([
    listNoteReplies(supabase, noteId),
    supabase.from('profiles').select('role').eq('id', user.id).single(),
    supabase.from('project_members').select('role').eq('project_id', id).eq('user_id', user.id).maybeSingle(),
  ])

  const canCurate = viewerProfile?.role === 'admin' || viewerMembership?.role === 'owner' || viewerMembership?.role === 'curator'
  const canResolve =
    note.author_id === user.id || (note.recipient_type === 'user' && note.recipient_user_id === user.id) || canCurate

  const ctx = await contextLink(supabase, note.context_type, note.context_id, id)
  // can_manage_project's exact boundary (owner or platform admin), not
  // canCurate above -- resource_access_requests_update_manager and
  // resource_access_grants_manage_owner don't grant a project-curator role
  // that access either, so a curator here would just hit an RLS rejection.
  const canDecideAccessRequest = viewerProfile?.role === 'admin' || viewerMembership?.role === 'owner'

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/notes`} className="text-sm underline">
          &larr; Notes
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{note.subject}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            {note.author?.email ?? 'Unknown'} · {new Date(note.created_at).toLocaleString()}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[note.status]}`}>{note.status}</span>
      </div>

      <div className="rounded border border-zinc-200 bg-white p-4">
        <p className="whitespace-pre-wrap text-sm text-zinc-700">{note.body}</p>
        {ctx && (
          <p className="mt-3 text-xs text-zinc-500">
            Attached to:{' '}
            {ctx.href ? (
              <Link href={ctx.href} className="underline">
                {ctx.label}
              </Link>
            ) : (
              <span>
                {ctx.label} · {note.context_id}
              </span>
            )}
          </p>
        )}
      </div>

      {ctx?.request && canDecideAccessRequest && ctx.request.status === 'pending' && (
        <AccessRequestDecisionActions projectId={id} requestId={ctx.request.id} />
      )}

      <ProjectNoteThread noteId={note.id} status={note.status} canResolve={canResolve} replies={replies} />
    </div>
  )
}
