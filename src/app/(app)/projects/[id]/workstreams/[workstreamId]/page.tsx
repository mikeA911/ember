import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listArtifacts } from '@/lib/projects/workstreams'
import { listAssessmentSummariesForProject } from '@/lib/projects/assessments'
import type { ArtifactType, ProjectWorkstream } from '@/types/database'
import { DeliverableChecklist } from '@/components/projects/DeliverableChecklist'
import { AttachArtifactForm } from '@/components/projects/AttachArtifactForm'
import { WorkstreamSummaryForm } from '@/components/projects/WorkstreamSummaryForm'
import { SystemUnderstandingCard } from '@/components/projects/SystemUnderstandingCard'
import { CopyArtifactButton } from '@/components/projects/CopyArtifactButton'
import { ArtifactStatusBadge, ArtifactReviewActions } from '@/components/projects/ArtifactReviewActions'
import { WorkstreamPromotionForm } from '@/components/projects/WorkstreamPromotionForm'
import { CloneWorkstreamButton } from '@/components/projects/CloneWorkstreamButton'
import { ProposalSummaryButton } from '@/components/projects/ProposalSummaryButton'
import type { ProposalSummaryInput } from '@/lib/projects/proposal-summary'
import { PromoteToMethodForm } from '@/components/projects/PromoteToMethodForm'
import { ShareBuilderUpdateForm, type ExistingBuilderUpdate } from '@/components/projects/ShareBuilderUpdateForm'
import {
  WorkstreamKnowledgeBaseAttachManager,
  WorkstreamKnowledgeBaseDetachButton,
} from '@/components/projects/WorkstreamKnowledgeBaseAttachManager'
import { PendingReviewBadge } from '@/components/projects/KnowledgeBaseAttachManager'
import { listKnowledgeBasesForWorkstream } from '@/lib/projects/queries'
import { listAttachableKnowledgeBasesForWorkstream } from '@/lib/knowledge-bases'
import { GeneratePresentationButton } from '@/components/projects/GeneratePresentationButton'
import { getPresentation } from '@/lib/workbench/presentations'
import { Markdown } from '@/components/shared/Markdown'
import { WorkstreamArtifactList } from '@/components/projects/WorkstreamArtifactList'
import { artifactCountLabel, artifactPreview, countArtifacts, sortArtifactsForReview } from '@/lib/projects/artifact-summary'
import { createAdminClient } from '@/lib/supabase/admin'
import { env } from '@/lib/env'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const ARTIFACT_TYPE_LABELS: Record<ArtifactType, string> = {
  capability_inventory: 'Capability Inventory',
  endpoint_inventory: 'Endpoint Inventory',
  openapi_spec: 'OpenAPI Spec',
  mcp_server: 'MCP Server',
  evidence_map: 'Evidence Map',
  test_results: 'Test Results',
  findings: 'Findings',
  design_note: 'Design Note',
  implementation_handoff: 'Implementation Handoff',
  research_dossier: 'Research Dossier',
  other: 'Other',
}

export default async function WorkstreamDetailPage({ params }: { params: Promise<{ id: string; workstreamId: string }> }) {
  const { id, workstreamId } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id, name').eq('id', id).single()
  const { data: workstreamRow } = await supabase.from('project_workstreams').select('*').eq('id', workstreamId).eq('project_id', id).single()
  const workstream = workstreamRow as ProjectWorkstream | null
  if (!project || !workstream) notFound()

  const [artifacts, assessmentSummaries, workstreamKnowledgeBases] = await Promise.all([
    listArtifacts(supabase, workstreamId),
    listAssessmentSummariesForProject(supabase, id),
    listKnowledgeBasesForWorkstream(supabase, workstreamId),
  ])

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canEdit = false // curator+ -- define scope, mark deliverables done
  let canAttach = false // consultant+ -- attach evidence
  let isActiveMember = false // Workstream Promotion: any active member of this workstream's Project may submit it for promotion
  let isProjectOwner = false // Builder Operations: Share Builder Update is owner-only (can_manage_project), no curator branch
  let presentation = null as Awaited<ReturnType<typeof getPresentation>>
  let viewerName: string | null = null // Proposal summary's "prepared by"
  if (user) {
    const [{ data: viewerProfile }, { data: viewerMembership }] = await Promise.all([
      supabase.from('profiles').select('role, email, full_name').eq('id', user.id).single(),
      supabase.from('project_members').select('role').eq('project_id', id).eq('user_id', user.id).maybeSingle(),
    ])
    const isAdmin = viewerProfile?.role === 'admin'
    viewerName = viewerProfile?.full_name && viewerProfile.email ? `${viewerProfile.full_name} (${viewerProfile.email})` : (viewerProfile?.email ?? null)
    isActiveMember = isAdmin || !!viewerMembership
    isProjectOwner = isAdmin || viewerMembership?.role === 'owner'
    canEdit = isAdmin || viewerMembership?.role === 'owner' || viewerMembership?.role === 'curator'
    canAttach = isAdmin || canEdit || viewerMembership?.role === 'consultant'

    if (isActiveMember) {
      presentation = await getPresentation({ user, profile: viewerProfile, supabase } as unknown as WorkbenchCallerContext, workstreamId)
    }
  }

  const attachableKnowledgeBases = canEdit ? await listAttachableKnowledgeBasesForWorkstream(supabase, workstreamId) : []

  // Offer promotion only when it would actually be accepted by
  // submitWorkstreamForPromotion -- an active member, completed, at least
  // one approved artifact, and nothing already in flight for it. Works the
  // same in Builder mode (the solo builder) or an ordinary Enterprise team
  // Project (any member, not just its owner/curator).
  let canOfferPromotion = false
  if (isActiveMember && workstream.status === 'completed' && artifacts.some((a) => a.status === 'approved')) {
    const { data: existingPromotion } = await supabase
      .from('workstream_promotions')
      .select('id')
      .eq('workstream_id', workstreamId)
      .in('status', ['pending', 'approved'])
      .maybeSingle()
    canOfferPromotion = !existingPromotion
  }

  // Builder Operations: only meaningful in builder-mode deployments, and
  // only for this workstream's own Project owner.
  const canOfferBuilderUpdate = env.productMode() === 'builder' && isProjectOwner
  let existingBuilderUpdate: ExistingBuilderUpdate | null = null
  if (canOfferBuilderUpdate) {
    const { data } = await supabase
      .from('builder_progress_updates')
      .select('current_stage, opportunity_label, progress, next_step, help_requested, confidence')
      .eq('workstream_id', workstreamId)
      .eq('status', 'active')
      .maybeSingle()
    existingBuilderUpdate = data
      ? {
          currentStage: data.current_stage,
          opportunityLabel: data.opportunity_label,
          progress: data.progress,
          nextStep: data.next_step,
          helpRequested: data.help_requested,
          confidence: data.confidence,
        }
      : null
  }

  // Builder Ontology, Part B: cheap provenance display, same narrow-columns
  // convention as the Project page's own clonedFromProjectName lookup.
  let clonedFromWorkstreamName: string | null = null
  if (workstream.cloned_from_workstream_id) {
    const { data: source } = await supabase
      .from('project_workstreams')
      .select('name')
      .eq('id', workstream.cloned_from_workstream_id)
      .maybeSingle()
    clonedFromWorkstreamName = source?.name ?? null
  }

  const completedCount = workstream.deliverables.filter((d) => d.completed).length
  const artifactCounts = countArtifacts(artifacts)
  const artifactLabel = artifactCountLabel(artifactCounts)
  const sortedArtifacts = sortArtifactsForReview(artifacts)

  // Client-facing: approved artifacts only, same line workstream promotion
  // draws (see proposal-summary.ts).
  const proposalSummary: ProposalSummaryInput = {
    title: workstream.name,
    preparedBy: viewerName,
    goal: workstream.goal,
    guardrail: workstream.guardrail,
    deliverables: workstream.deliverables.map((d) => ({ label: d.label, completed: d.completed })),
    artifacts: artifacts
      .filter((a) => a.status === 'approved')
      .map((a) => ({ title: a.title, typeLabel: ARTIFACT_TYPE_LABELS[a.artifact_type] ?? a.artifact_type, content: a.content, externalUrl: a.external_url })),
  }

  // Who added each artifact, for its collapsed row. Emails are display-only
  // -- RLS already decided which artifacts this viewer sees; profiles RLS
  // wouldn't let a member resolve a teammate's email, so this narrow
  // id+email lookup uses the admin client (same pattern as Working
  // Knowledge's owner labels).
  const creatorIds = [...new Set(artifacts.filter((a) => a.created_via !== 'assistant' && a.created_by).map((a) => a.created_by!))]
  const creatorEmailById = new Map<string, string>()
  if (creatorIds.length > 0) {
    const { data: creators } = await createAdminClient().from('profiles').select('id, email').in('id', creatorIds)
    for (const c of creators ?? []) if (c.email) creatorEmailById.set(c.id, c.email)
  }
  const artifactAuthor = (a: (typeof artifacts)[number]) =>
    a.created_via === 'assistant'
      ? 'Created by Ember'
      : a.created_by && a.created_by === user?.id
        ? 'Added by you'
        : `Added by ${(a.created_by && creatorEmailById.get(a.created_by)) || 'a team member'}`

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href={`/projects/${id}`} className="text-sm underline">
          &larr; {project.name}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-semibold">{workstream.name}</h1>
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{workstream.status}</span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <ProposalSummaryButton proposal={proposalSummary} />
              <CloneWorkstreamButton workstreamId={workstream.id} />
            </div>
          )}
        </div>
        <p className="mt-1 text-xs text-zinc-500">
          {completedCount}/{workstream.deliverables.length} deliverables complete
          {artifactLabel && (
            <>
              {' · '}
              <a href="#artifacts" className={`underline ${artifactCounts.awaitingReview > 0 ? 'font-medium text-amber-700' : ''}`}>
                {artifactLabel}
              </a>
            </>
          )}
        </p>
        {clonedFromWorkstreamName && (
          <p className="mt-1 text-xs text-zinc-500">
            Cloned from{' '}
            <Link href={`/projects/${id}/workstreams/${workstream.cloned_from_workstream_id}`} className="underline">
              {clonedFromWorkstreamName}
            </Link>
          </p>
        )}
      </div>

      <WorkstreamSummaryForm workstreamId={workstream.id} summary={workstream.summary} canEdit={canEdit} />

      <section id="artifacts" className="flex scroll-mt-4 flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Artifacts{artifacts.length > 0 && ` (${artifacts.length})`}
          </h2>
        </div>
        <p className="text-xs text-zinc-500">
          Evidence and outputs for this workstream -- attached by a team member, or created by Ember in chat. Long files
          usually live elsewhere (a repo, a PR); an artifact holds the summary and the link.
        </p>

        {sortedArtifacts.length > 0 ? (
          <WorkstreamArtifactList
            items={sortedArtifacts.map((a) => ({
              id: a.id,
              status: a.status,
              node: (
                <details id={a.id} className="group rounded border border-zinc-200 bg-white p-4 scroll-mt-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <svg
                        viewBox="0 0 20 20"
                        className="h-3 w-3 shrink-0 text-zinc-400 transition-transform group-open:rotate-90"
                        fill="currentColor"
                      >
                        <path d="M6 4l8 6-8 6V4z" />
                      </svg>
                      <h3 className="font-medium">{a.title}</h3>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      <ArtifactStatusBadge status={a.status} />
                      <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">
                        {ARTIFACT_TYPE_LABELS[a.artifact_type] ?? a.artifact_type}
                      </span>
                    </span>
                  </summary>
                  {/* Shown collapsed too: who/when, whether it links out, and what it says. */}
                  <p className="mt-1 pl-5 text-xs text-zinc-500">
                    {artifactAuthor(a)} · {new Date(a.created_at).toLocaleDateString()}
                    {a.external_tool && <> · via {a.external_tool}</>}
                    {a.external_url && <> · has a link</>}
                  </p>
                  {artifactPreview(a.content) && (
                    <p className="mt-0.5 truncate pl-5 text-xs text-zinc-600 group-open:hidden">{artifactPreview(a.content)}</p>
                  )}
                  {a.validation_notes && (
                    <p className="mt-2 rounded border border-zinc-200 bg-zinc-50 p-2 text-xs text-zinc-600">{a.validation_notes}</p>
                  )}
                  {a.content && (
                    <div className="mt-2">
                      <div className="mb-1 flex justify-end">
                        <CopyArtifactButton title={a.title} content={a.content} />
                      </div>
                      <div className="rounded border border-zinc-100 bg-zinc-50 p-3">
                        <Markdown text={a.content} />
                      </div>
                    </div>
                  )}
                  {a.external_url && (
                    /^https?:\/\//i.test(a.external_url) ? (
                      <a href={a.external_url} target="_blank" rel="noreferrer" className="mt-2 block text-sm text-blue-700 underline">
                        {a.external_url}
                      </a>
                    ) : (
                      <p className="mt-2 font-mono text-xs text-zinc-500" title="Not a public URL -- a local filesystem path can't be opened from the browser.">
                        {a.external_url} <span className="italic text-zinc-400">(local path, not a link)</span>
                      </p>
                    )
                  )}
                  {a.notes && (
                    <div className="mt-2 border-t border-zinc-100 pt-2">
                      <Markdown text={a.notes} />
                    </div>
                  )}
                  <Link
                    href={`/projects/${id}/notes?contextType=workstream_artifact&contextId=${a.id}`}
                    className="mt-2 inline-block text-xs text-blue-700 underline"
                  >
                    Add a note about this artifact
                  </Link>
                  <ArtifactReviewActions artifactId={a.id} projectId={id} workstreamId={workstreamId} status={a.status} canReview={canEdit} />
                </details>
              ),
            }))}
          />
        ) : (
          <p className="text-sm text-zinc-500">No artifacts attached yet.</p>
        )}

        {canAttach && (
          <details className="group rounded border border-dashed border-zinc-300 p-3">
            <summary className="cursor-pointer list-none text-sm font-medium text-zinc-700 hover:text-zinc-900 [&::-webkit-details-marker]:hidden">
              <span className="group-open:hidden">+ Attach an artifact</span>
              <span className="hidden group-open:inline">Attach an artifact</span>
            </summary>
            <div className="mt-3">
              <AttachArtifactForm workstreamId={workstream.id} />
            </div>
          </details>
        )}
      </section>


      <section className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Repository scope</h2>
          {workstream.repository_scope.length > 0 ? (
            <pre className="whitespace-pre-wrap rounded border border-zinc-200 bg-white p-3 font-mono text-xs text-zinc-700">
              {workstream.repository_scope.join('\n')}
            </pre>
          ) : (
            <p className="text-sm text-zinc-500">Not specified.</p>
          )}

          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Goal</h2>
          <p className="text-sm text-zinc-500">
            Same for every workstream in this project —{' '}
            <Link href={`/projects/${id}#goal`} className="text-blue-700 underline">
              see the project goal
            </Link>
            .
          </p>

          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Guardrail</h2>
          {workstream.guardrail ? <Markdown text={workstream.guardrail} /> : <p className="text-sm text-zinc-500">Not specified.</p>}

          <Link
            href={`/projects/${id}/notes?contextType=workstream&contextId=${workstream.id}`}
            className="self-start text-sm text-blue-700 underline"
          >
            Add a note about this workstream
          </Link>
        </div>

        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Deliverables</h2>
          <DeliverableChecklist workstreamId={workstream.id} deliverables={workstream.deliverables} canEdit={canEdit} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge</h2>
        <p className="text-xs text-zinc-500">
          Scoped to this workstream only -- distinct from the project&apos;s own knowledge, and not automatically visible
          to any other workstream in this project.
        </p>
        {workstreamKnowledgeBases.length > 0 ? (
          <ul className="flex flex-col gap-1 text-sm">
            {workstreamKnowledgeBases.map((kb) => (
              <li key={kb.id} className="flex items-center gap-2">
                <span>
                  {kb.name}
                  {kb.status === 'pending' && <PendingReviewBadge />}
                </span>
                {canEdit && <WorkstreamKnowledgeBaseDetachButton projectId={id} workstreamId={workstream.id} knowledgeBaseId={kb.id} />}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-zinc-500">No workstream-specific knowledge base attached yet.</p>
        )}
        {canEdit && (
          <WorkstreamKnowledgeBaseAttachManager projectId={id} workstreamId={workstream.id} availableKnowledgeBases={attachableKnowledgeBases} />
        )}
      </section>

      <SystemUnderstandingCard projectId={id} summaries={assessmentSummaries} canCreate={canEdit} />

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Presentation</h2>
        <p className="text-xs text-zinc-500">
          A concise, slide-based proposal Ember generates from this workstream and its own attached artifacts, for
          structured internal review before a curator approves it.
        </p>
        {presentation && (
          <p className="text-sm">
            <Link href={`/projects/${id}/workstreams/${workstreamId}/presentation`} className="underline">
              View presentation
            </Link>{' '}
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{presentation.status}</span>
          </p>
        )}
        {canEdit && <GeneratePresentationButton projectId={id} workstreamId={workstream.id} hasExisting={!!presentation} />}
      </section>

      {canOfferBuilderUpdate && (
        <ShareBuilderUpdateForm
          projectId={id}
          workstreamId={workstream.id}
          existing={existingBuilderUpdate}
          defaultStage={workstream.status}
        />
      )}

      {canOfferPromotion && (
        <WorkstreamPromotionForm projectId={id} workstreamId={workstream.id} isBuilderProposal={canOfferBuilderUpdate} />
      )}

      {canEdit && <PromoteToMethodForm projectId={id} workstreamId={workstream.id} defaultGuardrail={workstream.guardrail} />}
    </div>
  )
}
