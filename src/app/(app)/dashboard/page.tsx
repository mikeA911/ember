import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SectionHero } from '@/components/SectionHero'
import { UnpublishedWikiWidget } from '@/components/wiki/UnpublishedWikiWidget'
import { NotesForYouWidget, type NoteForYouRow } from '@/components/projects/NotesForYouWidget'
import { SharedLinksWidget } from '@/components/trending/SharedLinksWidget'
import { listUnpublishedArticles, getWikiStats } from '@/lib/wiki/queries'
import { getProjectStats } from '@/lib/projects/queries'
import { getEvalStats } from '@/lib/eval/queries'
import { getAgentStats } from '@/lib/agent/queries'
import { getTrendingStats, listRecentSharedLinks } from '@/lib/trending/queries'
import { listNotesForUser } from '@/lib/projects/notes'
import { getNeedsAttention } from '@/lib/dashboard/needs-attention'
import { listUpcomingScheduledPresentations } from '@/lib/workbench/presentations'
import { ScheduledPresentationsWidget } from '@/components/dashboard/ScheduledPresentationsWidget'
import { hasRequiredRole } from '@/lib/auth'
import { env } from '@/lib/env'
import { listMemberProjectOptions, listActiveProjectsForDashboard } from '@/lib/projects/queries'
import { listRecentConversations } from '@/lib/chat/conversations'
import { EmberHome } from '@/components/dashboard/EmberHome'
import { MyProjectsWidget } from '@/components/dashboard/MyProjectsWidget'
import { ProjectsAwaitingApprovalWidget } from '@/components/projects/ProjectsAwaitingApprovalWidget'
import { listProjectsAwaitingApproval } from '@/lib/workbench/project-approval'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view } = await searchParams
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  // Agency curators (their builders' new projects) and platform admins.
  const projectsAwaitingApproval =
    user && profile && (profile.role === 'admin' || profile.role === 'curator')
      ? await listProjectsAwaitingApproval({ user, profile, supabase } as unknown as WorkbenchCallerContext)
      : []
  const canSeeWikiQueue = profile ? hasRequiredRole(profile.role, 'curator') : false
  const canSeeNotes = !!user && profile?.role !== 'anonymous'
  // Every active signed-in user, not just curators -- unlike the widgets
  // above, per the doc's own acceptance criterion #1.
  const canSeeSharedLinks = !!user && profile?.role !== 'anonymous'
  const isAdmin = profile?.role === 'admin'
  // Ember-first home (docs/dev-request-ember-role-directed-product-
  // experience.md, refining docs/dev-request-role-aware-project-views-and-
  // ember-first-workspace.md's View 3) -- ordinary members and consultants
  // land here instead of the Workbench dashboard. Admin/curator keep
  // today's Workbench dashboard, but can deliberately open the same Ember
  // experience via ?view=ember ("Open Ember as a team member" below)
  // without it changing their actual role.
  const isEmberFirst = profile?.role === 'consultant' || profile?.role === 'member' || view === 'ember'

  const [
    unpublishedWikiArticles,
    projectStats,
    wikiStats,
    evalStats,
    agentStats,
    trendingStats,
    needsAttention,
    scheduledPresentations,
    notesForUser,
    sharedLinks,
    emberProjects,
    myProjects,
    myRecentConversations,
  ] = await Promise.all([
    canSeeWikiQueue ? listUnpublishedArticles(supabase) : Promise.resolve([]),
    getProjectStats(supabase),
    getWikiStats(supabase),
    getEvalStats(supabase),
    getAgentStats(supabase),
    getTrendingStats(supabase),
    canSeeWikiQueue ? getNeedsAttention(supabase) : Promise.resolve([]),
    canSeeWikiQueue ? listUpcomingScheduledPresentations(supabase) : Promise.resolve([]),
    canSeeNotes ? listNotesForUser(supabase, user!.id) : Promise.resolve([]),
    canSeeSharedLinks ? listRecentSharedLinks(supabase) : Promise.resolve([]),
    isEmberFirst ? listMemberProjectOptions(supabase, user!.id) : Promise.resolve([]),
    // "Your projects" / "Continue where you left off" (2026-09-04) -- the
    // admin/curator equivalent of the isEmberFirst branch's project picker
    // (EmberHome/ChatSession fetch their own recent-conversations History
    // client-side, so there's nothing to fetch server-side for that branch
    // any more), so that role tier also lands somewhere useful instead of a
    // bare stat-card dashboard.
    user && !isEmberFirst ? listActiveProjectsForDashboard(supabase, user.id) : Promise.resolve([]),
    user && !isEmberFirst ? listRecentConversations(supabase, user.id, { limit: 10 }) : Promise.resolve([]),
  ])

  // Same "projects this user actually belongs to" query as trending/new/page.tsx
  // -- the Add-link form's project picker. A separate step, same pattern as
  // notesForYou's project-name lookup below.
  const { data: memberProjects } = canSeeSharedLinks
    ? await supabase.from('project_members').select('project_id').eq('user_id', user!.id)
    : { data: [] }
  const memberProjectIds = (memberProjects ?? []).map((m) => m.project_id)
  const { data: sharedLinkProjects } =
    memberProjectIds.length > 0
      ? await supabase.from('projects').select('id, name').in('id', memberProjectIds).order('name')
      : { data: [] }

  const projectIds = [...new Set(notesForUser.map((n) => n.project_id))]
  const { data: noteProjects } =
    projectIds.length > 0 ? await supabase.from('projects').select('id, name').in('id', projectIds) : { data: [] }
  const projectNameById = new Map((noteProjects ?? []).map((p) => [p.id, p.name]))

  const notesForYou: NoteForYouRow[] = notesForUser.map((n) => ({
    id: n.id,
    projectId: n.project_id,
    projectName: projectNameById.get(n.project_id) ?? 'Unknown project',
    subject: n.subject,
    authorEmail: n.author?.email ?? null,
    createdAt: n.created_at,
  }))

  const summaryCards = [
    { label: 'Projects', href: '/projects', value: projectStats.total, subtitle: `${projectStats.active} active` },
    { label: 'Knowledge', href: '/wiki', value: wikiStats.total, subtitle: `${wikiStats.approved} approved` },
    { label: 'Evaluations', href: '/evals', value: evalStats.totalRuns, subtitle: `${evalStats.needReview} need review` },
    { label: 'Agents', href: '/agents', value: agentStats.total, subtitle: `${agentStats.active} active` },
    { label: 'Trending', href: '/trending', value: trendingStats.total, subtitle: `${trendingStats.active} active` },
  ]

  const attentionItems = needsAttention.filter((item) => item.count > 0)

  // The most recent conversation bound to a Project this viewer still
  // belongs to -- listRecentConversations is already ordered newest-first,
  // so the first project-bound one found is "last worked on." Sorted to the
  // front of myProjects rather than shown only in the callout, so it's not
  // duplicated work if the viewer scans the grid instead.
  const lastWorkedProjectId = myRecentConversations.find((c) => c.project_id)?.project_id ?? null
  const sortedMyProjects =
    lastWorkedProjectId && myProjects.some((p) => p.id === lastWorkedProjectId)
      ? [myProjects.find((p) => p.id === lastWorkedProjectId)!, ...myProjects.filter((p) => p.id !== lastWorkedProjectId)]
      : myProjects

  return (
    <div className="flex flex-col gap-8">
      <SectionHero image="/images/sections/kb-sandbox.png" height="compact" priority />

      <ProjectsAwaitingApprovalWidget projects={projectsAwaitingApproval} />

      {isEmberFirst ? (
        <EmberHome projects={emberProjects} productMode={env.productMode()} />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <h1 className="text-xl font-semibold">Workbench</h1>
            <div className="flex items-center gap-3">
              {/* Ember Role-Directed Product Experience, Experience 3 --
                  lets a curator/admin deliberately experience/validate the
                  member journey without changing their actual role; the
                  page's own isEmberFirst check above (`view === 'ember'`)
                  is what makes this link actually render the Ember-first
                  branch instead of this Workbench one. */}
              <Link href="/dashboard?view=ember" className="text-sm underline">
                Open Ember as a team member
              </Link>
              <Link href="/upload" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
                Sources &amp; Curation
              </Link>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {summaryCards.map((card) => (
              <Link key={card.label} href={card.href} className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400">
                <div className="text-xs uppercase tracking-wide text-zinc-500">{card.label}</div>
                <div className="mt-1 text-3xl font-semibold">{card.value}</div>
                <div className="mt-1 text-sm text-zinc-600">{card.subtitle}</div>
              </Link>
            ))}
          </div>

          <MyProjectsWidget projects={sortedMyProjects} lastWorkedProjectId={lastWorkedProjectId} />
        </>
      )}

      {canSeeWikiQueue && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Needs attention</h2>
          {attentionItems.length === 0 ? (
            <p className="text-sm text-zinc-500">Nothing needs attention right now.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {attentionItems.map((item) => (
                <li key={item.label}>
                  <Link href={item.href} className="text-zinc-700 hover:underline">
                    <span className="font-medium">{item.count}</span> {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {canSeeWikiQueue && <UnpublishedWikiWidget articles={unpublishedWikiArticles} />}
      {canSeeWikiQueue && <ScheduledPresentationsWidget presentations={scheduledPresentations} />}
      {canSeeSharedLinks && <SharedLinksWidget links={sharedLinks} projects={sharedLinkProjects ?? []} isAdmin={isAdmin} />}
      {canSeeNotes && <NotesForYouWidget notes={notesForYou} />}
    </div>
  )
}
