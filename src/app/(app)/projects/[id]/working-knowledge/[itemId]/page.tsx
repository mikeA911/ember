import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWorkingKnowledgeItem, listWorkingKnowledgeSources, listWorkingKnowledgeShares } from '@/lib/projects/working-knowledge'
import { archiveWorkingKnowledgeItemAction } from '@/app/actions/working-knowledge'
import { WorkingKnowledgeEditForm } from '@/components/projects/WorkingKnowledgeEditForm'
import { WorkingKnowledgeShareManager } from '@/components/projects/WorkingKnowledgeShareManager'
import { WorkingKnowledgePromoteForm } from '@/components/projects/WorkingKnowledgePromoteForm'

const TYPE_LABEL: Record<string, string> = {
  research_notebook: 'Research notebook',
  working_note: 'Working note',
}

// Working Knowledge & Research Notebooks Stage 1+2. Single-record detail
// page, mirroring /projects/[id]/notes/[noteId]/page.tsx's exact shape --
// RLS (can_view_working_knowledge_item) is the real access check; this page
// just re-authorizes on every load like every other direct route in this
// app (dev request acceptance criterion 26).
export default async function WorkingKnowledgeDetailPage({ params }: { params: Promise<{ id: string; itemId: string }> }) {
  const { id, itemId } = await params
  const ctx = await requireUser()
  if (!ctx.user) redirect('/login')

  const item = await getWorkingKnowledgeItem(ctx, itemId)
  if (!item || item.project_id !== id) notFound()

  const isOwner = item.owner_id === ctx.user.id
  const [sources, shares] = await Promise.all([
    listWorkingKnowledgeSources(ctx, itemId),
    isOwner ? listWorkingKnowledgeShares(ctx, itemId) : Promise.resolve([]),
  ])

  let candidates: { userId: string; email: string | null }[] = []
  if (isOwner) {
    const { data: members } = await ctx.supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', id)
      .eq('status', 'active')
      .neq('user_id', ctx.user.id)
    const memberIds = (members ?? []).map((m) => m.user_id)
    // Candidate emails are for display/selection only -- shareWorkingKnowledgeItem
    // re-validates active membership server-side regardless. profiles RLS
    // only lets a caller see their own row or staff see everyone, so a
    // consultant/member-role owner can't read a co-member's email through the
    // normal client; the admin client here only ever returns id+email, same
    // narrow pattern as resolveUserIdsByEmail (projects.ts) and the Members
    // page's own profile lookup (projects/[id]/members/page.tsx).
    const admin = createAdminClient()
    const { data: profiles } = memberIds.length > 0 ? await admin.from('profiles').select('id, email').in('id', memberIds) : { data: [] }
    candidates = (profiles ?? []).map((p) => ({ userId: p.id, email: p.email }))
  }

  // Promotion targets: the notebook's own Project first (a note belongs to
  // the Project it was written in), then the operator's Organization Home
  // Project (OR-036) when one exists and differs. Each needs at least one
  // active attached knowledge base -- submitWorkingKnowledgeSource re-checks
  // membership, attachment and ownership server-side regardless. Safe,
  // narrow metadata-only lookups via the admin client (name + attached KBs,
  // never content), same pattern as getOrganizationPortfolio/
  // listDiscoverableProjects. Every account is already auto-enrolled in the
  // Organization Home as a viewer (enrollInOrganizationHome).
  const promoteTargets: { projectId: string; projectName: string; knowledgeBases: { id: string; name: string }[] }[] = []
  if (isOwner && item.trust_status !== 'archived') {
    const admin = createAdminClient()
    const [{ data: ownProject }, { data: orgHome }] = await Promise.all([
      admin.from('projects').select('id, name').eq('id', id).maybeSingle(),
      admin.from('projects').select('id, name').eq('is_organization_home', true).maybeSingle(),
    ])
    for (const project of [ownProject, orgHome && orgHome.id !== id ? orgHome : null]) {
      if (!project) continue
      const { data: links } = await admin.from('project_knowledge_bases').select('knowledge_base_id').eq('project_id', project.id)
      const kbIds = (links ?? []).map((l) => l.knowledge_base_id)
      const { data: kbs } =
        kbIds.length > 0
          ? await admin.from('knowledge_bases').select('id, name').in('id', kbIds).eq('lifecycle_status', 'active').order('name')
          : { data: [] }
      if (kbs && kbs.length > 0) promoteTargets.push({ projectId: project.id, projectName: project.name, knowledgeBases: kbs })
    }
  }

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm underline">
          &larr; Project
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{item.title}</h1>
          <p className="mt-1 text-sm text-zinc-500">{TYPE_LABEL[item.type] ?? item.type}</p>
        </div>
        <span className="shrink-0 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          Working — not company-approved
        </span>
      </div>

      <WorkingKnowledgeEditForm projectId={id} itemId={item.id} objective={item.objective} content={item.content} canEdit={isOwner} />

      {sources.length > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>
          <ul className="flex flex-col gap-2">
            {sources.map((s) => (
              <li key={s.id} className="rounded border border-zinc-200 bg-white p-2 text-sm">
                <a href={s.url} target="_blank" rel="noreferrer" className="font-medium text-blue-700 underline">
                  {s.title || s.url}
                </a>
                <div className="text-xs text-zinc-500">
                  {s.domain ?? new URL(s.url).hostname} · retrieved {new Date(s.retrieved_at).toLocaleDateString()}
                  {s.published_date ? ` · published ${s.published_date}` : ''}
                </div>
                {s.excerpt && <p className="mt-1 text-xs text-zinc-600">{s.excerpt}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {isOwner && <WorkingKnowledgeShareManager projectId={id} itemId={item.id} candidates={candidates} shares={shares} />}

      {promoteTargets.map((target) => (
        <WorkingKnowledgePromoteForm
          key={target.projectId}
          workingKnowledgeItemId={item.id}
          targetProjectId={target.projectId}
          targetProjectName={target.projectName}
          knowledgeBases={target.knowledgeBases}
        />
      ))}

      {isOwner && item.trust_status !== 'archived' && (
        <form action={async () => {
          'use server'
          await archiveWorkingKnowledgeItemAction(id, item.id)
        }}>
          <button type="submit" className="self-start rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50">
            Archive
          </button>
        </form>
      )}
    </div>
  )
}
