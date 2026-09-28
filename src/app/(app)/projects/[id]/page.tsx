import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectFindings } from '@/components/projects/ProjectFindings'
import { MemberDirectory } from '@/components/projects/MemberDirectory'
import { ProjectGoalForm } from '@/components/projects/ProjectGoalForm'
import { ProjectStarterPromptForm } from '@/components/projects/ProjectStarterPromptForm'
import { ProjectStatusSection } from '@/components/projects/ProjectStatusSection'
import { listWorkstreams } from '@/lib/projects/workstreams'
import { listProjectNotes } from '@/lib/projects/notes'
import { listAttachableKnowledgeBases } from '@/lib/knowledge-bases'
import { listKnowledgeBasesForProject, listSourcesForKnowledgeBases, getSourceReviewCounts } from '@/lib/projects/queries'
import { listArticlesForProject } from '@/lib/wiki/project-links'
import { KnowledgeBaseAttachManager, KnowledgeBaseDetachButton } from '@/components/projects/KnowledgeBaseAttachManager'
import { getOrganizationExplorer } from '@/lib/projects/explorer'
import { OrganizationExplorer } from '@/components/projects/OrganizationExplorer'
import { SubmitSourceForm } from '@/components/projects/SubmitSourceForm'
import { SourceSubmissionsReview } from '@/components/projects/SourceSubmissionsReview'
import { WorkstreamPromotionsReview } from '@/components/projects/WorkstreamPromotionsReview'
import { listPendingWorkstreamPromotionsForProject } from '@/lib/workbench/workstream-promotions'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { ProjectCategorySelector } from '@/components/projects/ProjectCategorySelector'
import { ProjectDiscoverabilitySelector } from '@/components/projects/ProjectDiscoverabilitySelector'
import { RequestToJoinButton } from '@/components/projects/RequestToJoinButton'
import { JoinRequestsReview } from '@/components/projects/JoinRequestsReview'
import { ProjectDirectory } from '@/components/projects/ProjectDirectory'
import { listDiscoverableProjects } from '@/lib/projects/directory'
import { requireUser } from '@/lib/auth'
import { listMyWorkingKnowledge, listSharedWorkingKnowledge } from '@/lib/projects/working-knowledge'
import { WorkingKnowledgePanel } from '@/components/projects/WorkingKnowledgePanel'
import { CloneProjectButton } from '@/components/projects/CloneProjectButton'
import { getOntologyMapData, computeOntologyMapLayout } from '@/lib/projects/ontology-map'
import { OntologyMapButton } from '@/components/projects/OntologyMapButton'

const TYPE_LABELS: Record<string, string> = {
  learning: 'Learning',
  experiment: 'AI Experiment',
  consulting: 'Client / Consulting',
  transformation: 'Internal Transformation',
  knowledge: 'Knowledge',
}

export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { data: project, error: projectError } = await supabase.from('projects').select('*').eq('id', id).single()
  if (!project) {
    // Every reason this could come back empty (RLS filtered it, .single()
    // errored on a genuinely missing row, a transient query failure) was
    // previously treated identically as "doesn't exist" -- undiagnosable
    // when it happens to a viewer who should have access. A platform admin
    // should never be blocked here at all (projects_select_members' RLS
    // policy has an unconditional is_admin() bypass) -- if one still hits
    // this, that's a real discrepancy worth a loud log, not a silent 404.
    // Found live: docs/test-reports/2026-08-31-orderlunch-builder-journey.md
    // (OL-001) -- an admin reported being unable to view a project that
    // genuinely exists.
    if (projectError) console.error(`ProjectPage: failed to load project ${id}`, projectError)
    if (user) {
      const { data: viewerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (viewerProfile?.role === 'admin') {
        const { data: adminProject, error: adminError } = await createAdminClient().from('projects').select('id, name').eq('id', id).maybeSingle()
        if (adminProject) {
          console.error(
            `ProjectPage: project ${id} ("${adminProject.name}") exists and the viewer (${user.id}) is a platform admin, but the RLS-scoped query still returned nothing. This should be impossible under projects_select_members -- investigate is_admin()/session state, don't assume the project is missing.`
          )
        } else if (adminError) {
          console.error(`ProjectPage: admin-client re-check for project ${id} also failed`, adminError)
        }
      }

      // OR-036: the "chicken-and-egg" discoverability fallback -- a
      // genuinely new (non-member) user hitting a Project marked
      // discoverability='platform' would otherwise 404 here forever, since
      // projects_select_members RLS is deliberately untouched (active member
      // of any role, or platform admin, same as before this feature).
      // Served the same way /projects/portfolio already serves org-wide
      // safe metadata to non-members: an explicit non-anonymous check, then
      // a narrow admin-client query for only safe columns -- never a
      // broadened RLS policy. A genuinely non-discoverable Project a
      // non-member hits still 404s below, unchanged.
      if (viewerProfile && viewerProfile.role !== 'anonymous') {
        const admin = createAdminClient()
        const { data: discoverable } = await admin
          .from('projects')
          .select('id, name, objective, project_type, status, owner_id, discoverability, is_organization_home')
          .eq('id', id)
          .maybeSingle()
        if (discoverable && discoverable.discoverability === 'platform') {
          const [{ data: owner }, { data: pendingRequest }] = await Promise.all([
            discoverable.owner_id
              ? admin.from('profiles').select('email').eq('id', discoverable.owner_id).maybeSingle()
              : Promise.resolve({ data: null }),
            supabase.from('project_join_requests').select('id').eq('project_id', id).eq('requester_id', user.id).eq('status', 'pending').maybeSingle(),
          ])
          const directoryProjects = discoverable.is_organization_home
            ? await listDiscoverableProjects(await requireUser(), { excludeProjectId: id })
            : []

          return (
            <div className="flex max-w-2xl flex-col gap-6">
              <div>
                <h1 className="text-xl font-semibold">{discoverable.name}</h1>
                <p className="mt-1 text-sm text-zinc-500">{TYPE_LABELS[discoverable.project_type] ?? discoverable.project_type}</p>
              </div>
              {discoverable.objective && <p className="text-sm text-zinc-600">{discoverable.objective}</p>}
              {owner?.email && <p className="text-xs text-zinc-500">Owner: {owner.email}</p>}
              <p className="text-sm text-zinc-600">You&rsquo;re not yet a member of this Project. Request to join to see its full workspace.</p>
              <RequestToJoinButton projectId={id} alreadyRequested={!!pendingRequest} />
              {discoverable.is_organization_home && <ProjectDirectory projects={directoryProjects} viewerIsAdmin={viewerProfile.role === 'admin'} />}
            </div>
          )
        }
      }
    }
    notFound()
  }

  const [
    knowledgeBases,
    { data: evalDatasets },
    { data: viewerProfile },
    { data: viewerMembership },
    workstreams,
    openNotes,
    { data: approvalPolicies },
    { data: activeAuthorityAssignments },
    unattachedKnowledgeBases,
    linkedArticles,
    { data: statusHistory },
    explorer,
    { data: activeMembers },
    { data: submittableArtifacts },
    { data: sourceSubmissions },
    { data: joinRequests },
    ontologyMapData,
  ] = await Promise.all([
    listKnowledgeBasesForProject(supabase, id),
    supabase.from('eval_datasets').select('id, name, status').eq('project_id', id),
    user ? supabase.from('profiles').select('role').eq('id', user.id).single() : Promise.resolve({ data: null }),
    user
      ? supabase.from('project_members').select('role').eq('project_id', id).eq('user_id', user.id).single()
      : Promise.resolve({ data: null }),
    listWorkstreams(supabase, id),
    user ? listProjectNotes(supabase, id, { status: 'open' }) : Promise.resolve([]),
    supabase.from('project_approval_policies').select('approval_type, requirement_status').eq('project_id', id),
    supabase.from('project_authority_assignments').select('approval_type').eq('project_id', id).eq('status', 'active'),
    listAttachableKnowledgeBases(supabase, id),
    listArticlesForProject(supabase, id),
    // RLS (project_status_history_select_curator) already limits this to
    // curator+ viewers -- an ungated fetch just returns empty for anyone
    // else, same as the rest of this page's queries.
    supabase.from('project_status_history').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    getOrganizationExplorer(supabase, id, user?.id ?? null),
    // Member Directory (docs/dev-request-role-aware-project-views-and-ember-
    // first-workspace.md, View 2) -- RLS (project_members_select_member)
    // already scopes this to the caller's own accessible project, same
    // is_project_member gate as everything else on this page.
    user
      ? supabase.from('project_members').select('id, user_id, role, business_function').eq('project_id', id).eq('status', 'active').order('created_at')
      : Promise.resolve({ data: null }),
    // Member-submitted knowledge sources (2026-09-04) -- only an already-
    // approved, content-bearing artifact is offered, matching
    // submitArtifactSource's own eligibility check (src/lib/workbench/
    // source-submissions.ts) so the picker never offers something the
    // submit action would just reject.
    user
      ? supabase
          .from('workstream_artifacts')
          .select('id, title, workstream:project_workstreams!inner(project_id)')
          .eq('workstream.project_id', id)
          .eq('status', 'approved')
          .not('content', 'is', null)
      : Promise.resolve({ data: null }),
    // RLS (project_source_submissions_select_own_or_curator) already scopes
    // this to the caller's own submissions, or every submission if they can
    // curate this project -- an ungated fetch just returns less for anyone
    // else, same as the rest of this page's queries.
    user
      ? supabase.from('project_source_submissions').select('*').eq('project_id', id).order('created_at', { ascending: false })
      : Promise.resolve({ data: null }),
    // OR-036: RLS (project_join_requests_select_own_or_manager) already
    // scopes this to the caller's own request or every request if they can
    // curate this project -- same ungated-fetch convention as
    // sourceSubmissions above.
    user ? supabase.from('project_join_requests').select('*').eq('project_id', id).order('created_at', { ascending: false }) : Promise.resolve({ data: null }),
    getOntologyMapData(supabase, id),
  ])
  const statusHistoryActorIds = [...new Set((statusHistory ?? []).map((h) => h.actor_id).filter((x): x is string => !!x))]
  const { data: statusHistoryActors } =
    statusHistoryActorIds.length > 0
      ? await supabase.from('profiles').select('id, email').in('id', statusHistoryActorIds)
      : { data: [] }
  const statusHistoryActorEmail = new Map((statusHistoryActors ?? []).map((p) => [p.id, p.email]))

  // Emails are for display only, same narrow admin-client pattern as
  // members/page.tsx and notes/page.tsx -- project_members itself (fetched
  // above under RLS) is the real authorization boundary.
  const memberUserIds = [
    ...new Set([
      ...(activeMembers ?? []).map((m) => m.user_id),
      ...(sourceSubmissions ?? []).map((s) => s.submitted_by),
      ...(joinRequests ?? []).map((r) => r.requester_id),
    ]),
  ]
  const { data: memberProfiles } =
    memberUserIds.length > 0 ? await createAdminClient().from('profiles').select('id, email').in('id', memberUserIds) : { data: [] }
  const memberEmailById = new Map((memberProfiles ?? []).map((p) => [p.id, p.email]))
  const directoryMembers = (activeMembers ?? []).map((m) => ({
    membershipId: m.id,
    userId: m.user_id,
    email: memberEmailById.get(m.user_id) ?? null,
    role: m.role,
    businessFunction: m.business_function,
  }))

  // Builder Ontology, Part B: cheap provenance display -- only ever fetched
  // for a genuinely cloned project, and only the name (same narrow-columns
  // convention as every other cross-row display lookup on this page).
  let clonedFromProjectName: string | null = null
  if (project.cloned_from_project_id) {
    const { data: source } = await supabase.from('projects').select('name').eq('id', project.cloned_from_project_id).maybeSingle()
    clonedFromProjectName = source?.name ?? null
  }

  const canManage = viewerProfile?.role === 'admin' || viewerMembership?.role === 'owner'
  // Workstreams are curator+ manageable, not just owner -- matches
  // project_workstreams_manage_curator's can_curate_project RLS bar exactly.
  const canCurateWorkstreams = canManage || viewerMembership?.role === 'curator'

  // Workstream Promotion: this Project's own curator/owner/admin reviews
  // promotions submitted from this Project's own workstreams -- the
  // primary review path for an ordinary team's own curator (e.g. an HR
  // Manager), who may have no /admin access at all.
  const pendingWorkstreamPromotions =
    canCurateWorkstreams && user && viewerProfile
      ? await listPendingWorkstreamPromotionsForProject(
          { user, profile: viewerProfile, supabase } as unknown as WorkbenchCallerContext,
          project.id
        )
      : []
  // Same bar as approveProjectAction's own check -- curator or admin, by
  // either role system (platform role, or project role on this project).
  const canApprove =
    viewerProfile?.role === 'admin' ||
    viewerProfile?.role === 'curator' ||
    viewerMembership?.role === 'owner' ||
    viewerMembership?.role === 'curator'
  // "Draft" means "not yet approved" -- shown only to the creator or to
  // someone who could approve it. Everyone else sees no status badge while
  // it's in draft, matching the same rule on the Projects list page.
  const showStatusBadge = project.status !== 'draft' || project.owner_id === user?.id || canApprove

  const assignedTypes = new Set((activeAuthorityAssignments ?? []).map((a) => a.approval_type))
  const missingAuthorities = (approvalPolicies ?? []).filter(
    (p) => p.requirement_status === 'required' && !assignedTypes.has(p.approval_type)
  )

  // Real, recurring RLS-visibility gap found live 2026-09-04:
  // project_knowledge_bases and project_wiki_articles both deliberately
  // have no admin bypass on SELECT (20260824210001_project_junction_
  // manage_policies_no_select_leak.sql -- closing a real leak where an
  // admin's *blanket, table-wide* bypass let them enumerate every OTHER
  // project's attachments too, not just this one). A platform admin doing
  // legitimate setup on a Project they haven't joined as a member saw a
  // misleading "nothing attached" state even when something genuinely was.
  // Fixed narrowly here, never by touching that RLS: scoped to this one
  // already-known project id (never a blanket table query, so this can
  // never let an admin discover another project's attachments), and only
  // when the primary RLS-scoped result came back empty.
  let effectiveKnowledgeBases = knowledgeBases
  let effectiveUnattachedKnowledgeBases = unattachedKnowledgeBases
  let effectiveLinkedArticles = linkedArticles
  if (viewerProfile?.role === 'admin' && !viewerMembership && (knowledgeBases.length === 0 || linkedArticles.length === 0)) {
    const admin = createAdminClient()
    if (knowledgeBases.length === 0) {
      const { data: links } = await admin.from('project_knowledge_bases').select('knowledge_base_id').eq('project_id', id)
      const kbIds = (links ?? []).map((l) => l.knowledge_base_id)
      if (kbIds.length > 0) {
        const { data: kbs } = await admin.from('knowledge_bases').select('id, name').in('id', kbIds)
        effectiveKnowledgeBases = kbs ?? []
        effectiveUnattachedKnowledgeBases = unattachedKnowledgeBases.filter((kb) => !kbIds.includes(kb.id))
      }
    }
    if (linkedArticles.length === 0) {
      const { data: links } = await admin.from('project_wiki_articles').select('id, wiki_article_id').eq('project_id', id)
      if (links && links.length > 0) {
        const { data: articles } = await admin
          .from('wiki_articles')
          .select('id, slug, title, status, visibility_scope')
          .in('id', links.map((l) => l.wiki_article_id))
        const byId = new Map((articles ?? []).map((a) => [a.id, a]))
        effectiveLinkedArticles = links.map((l) => ({ linkId: l.id, article: byId.get(l.wiki_article_id) ?? null })).filter((l) => l.article !== null)
      }
    }
  }

  // Any project member gets this, not just canManage -- RLS on
  // knowledge_sources already scopes it correctly per-source (see
  // listSourcesForKnowledgeBases' own comment).
  const sourcesByKbId = new Map<string, Awaited<ReturnType<typeof listSourcesForKnowledgeBases>>>()
  if (user && effectiveKnowledgeBases.length > 0) {
    const sources = await listSourcesForKnowledgeBases(
      supabase,
      effectiveKnowledgeBases.map((kb) => kb.id)
    )
    for (const source of sources) {
      sourcesByKbId.set(source.knowledgeBaseId, [...(sourcesByKbId.get(source.knowledgeBaseId) ?? []), source])
    }
  }
  const reviewCountsByDocumentId = await getSourceReviewCounts(
    [...sourcesByKbId.values()].flat().map((s) => s.documentId).filter((id): id is string => !!id)
  )
  // Chunk review (/review/[docId] and its approve actions) is a platform
  // curator/admin tool, so only they get the "Review" link.
  const canReviewChunks = viewerProfile?.role === 'admin' || viewerProfile?.role === 'curator'

  const ontologyMapLayout = computeOntologyMapLayout(ontologyMapData)

  return (
    <div className="flex flex-col gap-8">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{project.name}</h1>
            {viewerMembership?.role && (
              <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium capitalize text-zinc-600">{viewerMembership.role}</span>
            )}
            {project.visibility === 'public' && project.published_at && (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Published</span>
            )}
          </div>
          {canManage && (
            <div className="flex items-center gap-3">
              <Link href={`/projects/${project.id}/members`} className="text-sm underline">
                Members
              </Link>
              <Link href={`/projects/${project.id}/access`} className="text-sm underline">
                Access &amp; Evidence
              </Link>
              <Link href={`/projects/${project.id}/publish`} className="text-sm underline">
                Publish
              </Link>
              <CloneProjectButton projectId={project.id} />
            </div>
          )}
          {project.visibility === 'public' && project.public_slug && (
            <Link href={`/examples/${project.public_slug}`} className="text-sm underline text-green-700">
              View public page
            </Link>
          )}
        </div>
        <div className="mt-1 flex items-center gap-2">
          <p className="text-sm text-zinc-500">{TYPE_LABELS[project.project_type] ?? project.project_type}</p>
          <span className="text-zinc-300">·</span>
          <ProjectCategorySelector projectId={project.id} category={project.portfolio_category} canEdit={canCurateWorkstreams} />
          <span className="text-zinc-300">·</span>
          <ProjectDiscoverabilitySelector projectId={project.id} discoverability={project.discoverability} canEdit={canCurateWorkstreams} />
          {ontologyMapLayout.nodes.length > 0 && (
            <>
              <span className="text-zinc-300">·</span>
              <OntologyMapButton layout={ontologyMapLayout} projectId={project.id} projectName={project.name} />
            </>
          )}
        </div>
        {clonedFromProjectName && (
          <p className="mt-1 text-xs text-zinc-500">
            Cloned from{' '}
            <Link href={`/projects/${project.cloned_from_project_id}`} className="underline">
              {clonedFromProjectName}
            </Link>
          </p>
        )}
        {project.objective && <p className="mt-2 text-sm text-zinc-600">{project.objective}</p>}
        {Object.keys(project.details ?? {}).length > 0 && (
          <dl className="mt-3 flex flex-col gap-1 text-sm">
            {/* details has no schema ("no template engine," per the Project
                Model brief) -- a curator-authored seed can (and did, live,
                2026-09-04: "Food Outlet AI-Readiness Showcase") put a nested
                object under a key instead of a plain string. React throws
                "Objects are not valid as a React child" (error #31) on a raw
                object child, which took the whole page down with it -- this
                must render *something* for any JSON value, never assume
                string. */}
            {Object.entries(project.details as Record<string, unknown>).map(([k, v]) =>
              v ? (
                <div key={k} className="flex gap-2">
                  <dt className="shrink-0 capitalize text-zinc-500">{k.replace(/_/g, ' ')}:</dt>
                  <dd>
                    {typeof v === 'string' ? (
                      v
                    ) : (
                      <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-600">{JSON.stringify(v, null, 2)}</pre>
                    )}
                  </dd>
                </div>
              ) : null
            )}
          </dl>
        )}
      </div>

      {user && viewerMembership && <MemberDirectory projectId={project.id} members={directoryMembers} viewerUserId={user.id} />}

      {canCurateWorkstreams && (
        <JoinRequestsReview
          projectId={project.id}
          requests={(joinRequests ?? [])
            .filter((r) => r.status === 'pending')
            .map((r) => ({ id: r.id, requesterEmail: memberEmailById.get(r.requester_id) ?? r.requester_id, createdAt: r.created_at }))}
        />
      )}

      {project.is_organization_home && (
        <ProjectDirectory
          projects={await listDiscoverableProjects(await requireUser(), { excludeProjectId: project.id })}
          viewerIsAdmin={viewerProfile?.role === 'admin'}
        />
      )}

      <ProjectGoalForm projectId={project.id} goal={project.goal} canEdit={canManage} />
      <ProjectStarterPromptForm projectId={project.id} starterPrompt={project.starter_prompt} canEdit={canCurateWorkstreams} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge</h2>
        <p className="text-sm text-zinc-600">
          Platform Knowledge: <Link href="/wiki" className="underline">AI Engineering Wiki</Link>
        </p>
        {effectiveKnowledgeBases.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {effectiveKnowledgeBases.map((kb) => {
              const sources = sourcesByKbId.get(kb.id) ?? []
              return (
                <li key={kb.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    Project Knowledge: {kb.name}
                    {canManage && <KnowledgeBaseDetachButton projectId={project.id} knowledgeBaseId={kb.id} />}
                  </div>
                  {sources.length > 0 && (
                    <ul className="ml-4 flex flex-col gap-0.5 text-xs text-zinc-600">
                      {sources.map((s) => (
                        <li key={s.id}>
                          <Link href={`/sources/${s.id}`} className="underline">
                            {s.title}
                          </Link>
                          {s.publisher && <span> -- {s.publisher}</span>}
                          {s.versionNumber !== null && <span> -- v{s.versionNumber}</span>}
                          {s.sourceUrl && (
                            <>
                              {' -- '}
                              <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="underline">
                                source
                              </a>
                            </>
                          )}
                          {s.lifecycleStatus !== 'active' && <span> -- {s.lifecycleStatus}</span>}
                          <SourceReviewBadge
                            counts={s.documentId ? reviewCountsByDocumentId.get(s.documentId) : undefined}
                            reviewHref={canReviewChunks && s.documentId ? `/review/${s.documentId}` : null}
                          />
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No project-specific knowledge base attached yet.</p>
        )}
        {canManage && <KnowledgeBaseAttachManager projectId={project.id} availableKnowledgeBases={effectiveUnattachedKnowledgeBases} />}

        {effectiveLinkedArticles.length > 0 && (
          <ul className="mt-1 flex flex-col gap-1 text-sm">
            {effectiveLinkedArticles.map((l) =>
              l.article ? (
                <li key={l.linkId}>
                  Wiki:{' '}
                  <Link href={`/wiki/${l.article.slug}`} className="underline">
                    {l.article.title}
                  </Link>
                </li>
              ) : null
            )}
          </ul>
        )}

        {/* Member-submitted knowledge sources (2026-09-04) -- any active
            member can propose a source; the project's owner/curator/admin
            (canCurateWorkstreams -- can_curate_project, the same bar as
            Workstreams above) decides. */}
        {canCurateWorkstreams && (
          <SourceSubmissionsReview
            projectId={project.id}
            submissions={(sourceSubmissions ?? [])
              .filter((s) => s.status === 'pending')
              .map((s) => ({
                id: s.id,
                title: s.title,
                sourceKind: s.source_kind,
                submitterEmail: memberEmailById.get(s.submitted_by) ?? s.submitted_by,
                createdAt: s.created_at,
              }))}
          />
        )}
        {user && viewerMembership && (
          <SubmitSourceForm
            projectId={project.id}
            knowledgeBases={knowledgeBases}
            artifacts={(submittableArtifacts ?? []).map((a) => ({ id: a.id, title: a.title }))}
          />
        )}
      </section>

      {/* Working Knowledge & Research Notebooks Stage 1+2 (2026-09-05) --
          any active member can create/see their own; "shared with you" only
          ever shows items explicitly shared or project-wide, never a
          curator/admin "see everything" view (no such view exists). */}
      {user && viewerMembership && (
        <WorkingKnowledgePanel
          projectId={project.id}
          mine={(await listMyWorkingKnowledge(await requireUser(), project.id)).map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            visibility: i.visibility,
            updatedAt: i.updated_at,
          }))}
          shared={(await listSharedWorkingKnowledge(await requireUser(), project.id)).map((i) => ({
            id: i.id,
            title: i.title,
            type: i.type,
            visibility: i.visibility,
            updatedAt: i.updated_at,
            ownerEmail: memberEmailById.get(i.owner_id) ?? null,
          }))}
        />
      )}

      <OrganizationExplorer explorer={explorer} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Evals</h2>
        {(evalDatasets ?? []).length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {evalDatasets!.map((d) => (
              <li key={d.id}>
                <Link href={`/evals/datasets/${d.id}`} className="underline">
                  {d.name}
                </Link>{' '}
                <span className="text-zinc-500">({d.status})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No benchmark attached yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Workstreams</h2>
          {canCurateWorkstreams && (
            <Link href={`/projects/${project.id}/workstreams/new`} className="text-sm underline">
              New Workstream
            </Link>
          )}
        </div>
        {workstreams.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {workstreams.map((w) => {
              const completed = w.deliverables.filter((d) => d.completed).length
              return (
                <li key={w.id}>
                  <Link href={`/projects/${project.id}/workstreams/${w.id}`} className="underline">
                    {w.name}
                  </Link>{' '}
                  <span className="text-zinc-500">
                    ({w.status} · {completed}/{w.deliverables.length} deliverables)
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No workstreams defined yet.</p>
        )}
      </section>

      {canCurateWorkstreams && pendingWorkstreamPromotions.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Pending workstream promotions</h2>
          <WorkstreamPromotionsReview promotions={pendingWorkstreamPromotions} projectId={project.id} />
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Governance</h2>
          {canManage && (
            <Link href={`/projects/${project.id}/governance`} className="text-sm underline">
              Manage
            </Link>
          )}
        </div>
        {(approvalPolicies ?? []).length > 0 ? (
          <p className="text-sm text-zinc-600">
            {(approvalPolicies ?? []).length} approval {(approvalPolicies ?? []).length === 1 ? 'type' : 'types'} configured
            {missingAuthorities.length > 0 && (
              <span className="ml-1 font-medium text-amber-700">
                — {missingAuthorities.length} authority {missingAuthorities.length === 1 ? 'gap' : 'gaps'} (Authority needed)
              </span>
            )}
          </p>
        ) : (
          <p className="text-sm text-zinc-500">No approval requirements configured for this project.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Status</h2>
        <ProjectStatusSection
          projectId={project.id}
          status={project.status}
          canApprove={canApprove}
          showStatus={showStatusBadge}
          history={(statusHistory ?? []).map((h) => ({
            fromStatus: h.from_status,
            toStatus: h.to_status,
            createdAt: h.created_at,
            actorEmail: h.actor_id ? (statusHistoryActorEmail.get(h.actor_id) ?? null) : null,
          }))}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Notes</h2>
          <div className="flex items-center gap-3">
            <Link href={`/projects/${project.id}/notes`} className="text-sm underline">
              + Add
            </Link>
            <Link href={`/projects/${project.id}/notes`} className="text-sm underline">
              {openNotes.length > 0 ? `${openNotes.length} open` : 'View all'}
            </Link>
          </div>
        </div>
        <ProjectFindings projectId={project.id} initialNotes={project.notes} />
        {openNotes.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {openNotes.slice(0, 5).map((note) => (
              <li key={note.id}>
                <Link href={`/projects/${project.id}/notes/${note.id}`} className="underline">
                  {note.subject}
                </Link>{' '}
                <span className="text-zinc-500">({note.author?.email ?? 'Unknown'})</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No open notes.</p>
        )}
      </section>
    </div>
  )
}

// Whether a listed source is actually searchable yet. Retrieval only ever
// uses approved chunks, so "listed" alone isn't "usable".
function SourceReviewBadge({ counts, reviewHref }: { counts: { total: number; approved: number } | undefined; reviewHref: string | null }) {
  if (!counts) return null
  if (counts.total > 0 && counts.approved === counts.total) {
    return <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-medium text-emerald-800">Searchable</span>
  }
  const label =
    counts.total === 0 ? 'Not processed yet' : `Awaiting review · ${counts.approved}/${counts.total} chunks approved`
  return (
    <>
      <span
        className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-900"
        title="Not searchable by the Assistant until a curator approves its chunks"
      >
        {label}
      </span>
      {reviewHref && counts.total > 0 && (
        <Link href={reviewHref} className="ml-2 text-[11px] font-medium text-blue-700 underline">
          Review
        </Link>
      )}
    </>
  )
}
