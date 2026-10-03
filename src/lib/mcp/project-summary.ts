import 'server-only'
import { countArtifacts } from '@/lib/projects/artifact-summary'
import { listProjectNotes } from '@/lib/projects/notes'
import { getOntologyMapData } from '@/lib/projects/ontology-map'
import { listKnowledgeBasesForProject } from '@/lib/projects/queries'
import { buildProjectSummaryMarkdown, type ProjectSummaryInput } from '@/lib/projects/status-summary'
import { listWorkstreams } from '@/lib/projects/workstreams'
import { listArticlesForProject } from '@/lib/wiki/project-links'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { WorkstreamArtifactStatus } from '@/types/database'

// The Project summary (src/lib/projects/status-summary.ts) for the external
// MCP server's get_project_summary tool. Same Markdown builder as the
// project page's Summary button, but loaded strictly through the caller's
// RLS-scoped client: the page's own loader adds service-role fallbacks
// (member emails, an admin's view of attachments) that an external AI app
// must never get. So other members' emails appear only where RLS already
// shows them to this user, and review queues are omitted.

export const PROJECT_TYPE_LABELS: Record<string, string> = {
  learning: 'Learning',
  experiment: 'AI Experiment',
  consulting: 'Client / Consulting',
  transformation: 'Internal Transformation',
  knowledge: 'Knowledge',
}

export async function loadProjectSummaryMarkdown(ctx: WorkbenchCallerContext, projectId: string, viewerProjectRole: string): Promise<string> {
  const supabase = ctx.supabase
  const { data: project, error } = await supabase.from('projects').select('*').eq('id', projectId).single()
  if (error) throw error

  const [knowledgeBases, { data: evalDatasets }, workstreams, openNotes, { data: approvalPolicies }, { data: activeAuthorities }, linkedArticles, { data: members }, ontology, { data: artifacts }] =
    await Promise.all([
      listKnowledgeBasesForProject(supabase, projectId),
      supabase.from('eval_datasets').select('name, status').eq('project_id', projectId),
      listWorkstreams(supabase, projectId),
      listProjectNotes(supabase, projectId, { status: 'open' }),
      supabase.from('project_approval_policies').select('approval_type, requirement_status').eq('project_id', projectId),
      supabase.from('project_authority_assignments').select('approval_type').eq('project_id', projectId).eq('status', 'active'),
      listArticlesForProject(supabase, projectId),
      supabase.from('project_members').select('user_id, role').eq('project_id', projectId).eq('status', 'active').order('created_at'),
      getOntologyMapData(supabase, projectId),
      supabase
        .from('workstream_artifacts')
        .select('workstream_id, status, workstream:project_workstreams!inner(project_id)')
        .eq('workstream.project_id', projectId),
    ])

  const memberIds = (members ?? []).map((m) => m.user_id)
  const { data: visibleProfiles } = memberIds.length ? await supabase.from('profiles').select('id, email').in('id', memberIds) : { data: [] }
  const emailById = new Map((visibleProfiles ?? []).map((p) => [p.id, p.email]))

  const artifactsByWorkstream = new Map<string, { status: WorkstreamArtifactStatus }[]>()
  for (const a of artifacts ?? []) {
    const list = artifactsByWorkstream.get(a.workstream_id) ?? []
    list.push({ status: a.status as WorkstreamArtifactStatus })
    artifactsByWorkstream.set(a.workstream_id, list)
  }

  const workstreamName = new Map(ontology.workstreams.map((w) => [w.id, w.name]))
  const objectName = new Map(ontology.objects.map((o) => [o.id, o.name]))
  const namesOf = (ids: string[]) => ids.map((i) => workstreamName.get(i)).filter((n): n is string => !!n)
  const assigned = new Set((activeAuthorities ?? []).map((a) => a.approval_type))
  const canApprove = ctx.profile.role === 'admin' || ctx.profile.role === 'curator' || viewerProjectRole === 'owner' || viewerProjectRole === 'curator'

  const input: ProjectSummaryInput = {
    name: project.name,
    typeLabel: PROJECT_TYPE_LABELS[project.project_type] ?? project.project_type,
    // Same rule as the project page's status badge.
    status: project.status !== 'draft' || project.owner_id === ctx.user.id || canApprove ? project.status : null,
    objective: project.objective,
    goal: project.goal,
    details: (project.details ?? {}) as Record<string, unknown>,
    findings: project.notes,
    starterPrompt: project.starter_prompt,
    members: (members ?? []).map((m) => ({ email: emailById.get(m.user_id) ?? null, role: m.role })),
    workstreams: workstreams.map((w) => ({
      name: w.name,
      status: w.status,
      lifecycleStage: w.lifecycle_stage,
      operationalStatus: w.operational_status,
      goal: w.goal,
      guardrail: w.guardrail,
      outcome: w.summary,
      repositoryScope: w.repository_scope ?? [],
      deliverables: w.deliverables,
      artifacts: countArtifacts(artifactsByWorkstream.get(w.id) ?? []),
      dependsOn: namesOf(ontology.flowEdges.filter((e) => e.downstreamId === w.id).map((e) => e.upstreamId)),
      feedsInto: namesOf(ontology.flowEdges.filter((e) => e.upstreamId === w.id).map((e) => e.downstreamId)),
      objects: ontology.linkEdges
        .filter((l) => l.workstreamId === w.id && objectName.has(l.objectId))
        .map((l) => ({ name: objectName.get(l.objectId)!, accessModes: l.accessModes ?? [] })),
    })),
    objects: ontology.objects,
    knowledgeBases: knowledgeBases.map((kb) => ({ name: kb.name, status: kb.status })),
    wikiArticles: linkedArticles.flatMap((l) => (l.article ? [l.article.title] : [])),
    evalDatasets: (evalDatasets ?? []).map((d) => ({ name: d.name, status: d.status })),
    governance: {
      approvalTypes: (approvalPolicies ?? []).length,
      authorityGaps: (approvalPolicies ?? []).filter((p) => p.requirement_status === 'required' && !assigned.has(p.approval_type)).map((p) => p.approval_type),
    },
    ontology: { flowEdges: ontology.flowEdges.length, objectLinks: ontology.linkEdges.length },
    openNotes: openNotes.map((n) => ({ subject: n.subject, authorEmail: n.author?.email ?? null })),
  }

  return buildProjectSummaryMarkdown(input, new Date().toISOString())
}
