import 'server-only'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import type {
  WorkstreamDeliverable,
  ArtifactType,
  WorkstreamArtifactStatus,
  WorkstreamLifecycleStage,
  WorkstreamOperationalStatus,
} from '@/types/database'
import { validateOpenApiContent } from './openapi-validation'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'

// Friendly pre-check mirroring the DB trigger (prevent_workstream_cycle,
// 20260925100001_project_objects_and_workstream_structure.sql) -- the
// trigger is the real enforcement (fires for every writer); this just turns
// a raw trigger exception into an actionable message before the round trip,
// same defense-in-depth shape as this file's own OL-002 role preflight.
async function assertNoWorkstreamCycle(ctx: WorkbenchCallerContext, candidateParentId: string, workstreamId: string | null) {
  let cursorId: string | null = candidateParentId
  const seen = new Set<string>()
  while (cursorId) {
    if (workstreamId && cursorId === workstreamId) throw new ProjectValidationError('That parent would create a cycle in the workstream tree')
    if (seen.has(cursorId)) break
    seen.add(cursorId)
    const { data }: { data: { parent_workstream_id: string | null } | null } = await ctx.supabase
      .from('project_workstreams')
      .select('parent_workstream_id')
      .eq('id', cursorId)
      .maybeSingle()
    cursorId = data?.parent_workstream_id ?? null
  }
}

// A generic repo URL (or a local filesystem path) drifts or breaks -- a
// PR/commit link is durable. This is the authoritative check; the form has
// the same check client-side only to fail fast.
function isGithubUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'www.github.com')
  } catch {
    return false
  }
}

// Caller (an already-resolved WorkbenchCallerContext) + an anonymous check,
// then RLS (project_workstreams_manage_curator -- can_curate_project,
// project-role-aware) is the real gate -- not a platform-role check, which
// would incorrectly block a project-scoped curator whose platform role is
// merely 'consultant'.
//
// OL-002 (2026-08-31 builder-journey report): a consultant-role project
// member offered this action by Ember got only a raw Postgres RLS
// policy-violation error, with no specific explanation and (per OL-003) a
// long pending state before it surfaced. The tool description now tells the
// model to preflight-check the caller's role first (OR-028), but that's a
// prompt instruction, not a guarantee -- this explicit check is the actual
// fix: even when the model doesn't preflight, the failure is now a clear,
// specific message instead of a raw DB error. RLS stays the real
// enforcement boundary; this is defense in depth for a better failure mode,
// same as createAndAddProjectMember in projects.ts.
export async function createWorkstream(
  ctx: WorkbenchCallerContext,
  input: {
    projectId: string
    name: string
    slug: string
    repositoryScope: string[]
    goal?: string
    guardrail?: string
    deliverables: string[]
    // Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md).
    parentWorkstreamId?: string | null
    lifecycleStage?: WorkstreamLifecycleStage | null
    operationalStatus?: WorkstreamOperationalStatus
    plannedDuration?: string | null
    actualDuration?: string | null
  }
) {
  const { profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError('Create an account to create a workstream')

  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, input.projectId)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `Creating a workstream needs this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }. Ask the project owner or a curator to create it, or to give you the curator role.`
      )
    }
  }

  if (input.parentWorkstreamId) await assertNoWorkstreamCycle(ctx, input.parentWorkstreamId, null)

  const deliverables: WorkstreamDeliverable[] = input.deliverables.filter((label) => label.trim()).map((label) => ({ label, completed: false }))

  const { data, error } = await supabase
    .from('project_workstreams')
    .insert({
      project_id: input.projectId,
      name: input.name,
      slug: input.slug,
      status: 'draft',
      repository_scope: input.repositoryScope.filter((p) => p.trim()),
      goal: input.goal || null,
      guardrail: input.guardrail || null,
      deliverables,
      created_by: profile.id,
      parent_workstream_id: input.parentWorkstreamId || null,
      lifecycle_stage: input.lifecycleStage || null,
      operational_status: input.operationalStatus || 'open',
      planned_duration: input.plannedDuration || null,
      actual_duration: input.actualDuration || null,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new ProjectValidationError('Failed to create workstream')

  await attachProjectKnowledgeBasesToWorkstream(ctx, input.projectId, data.id)

  return { workstreamId: data.id, projectId: input.projectId }
}

// A new Workstream starts with its Project's own knowledge bases attached,
// so the builder doesn't have to re-pick them one by one. Copies the
// project_knowledge_bases links as-is, including a project_private KB --
// unlike attachWorkstreamKnowledgeBase's self-serve visibility_scope check,
// this can't widen access: these KBs are already attached to this exact
// Project, and a Workstream's members are its Project's members. Same
// curator-gated RLS insert (workstream_knowledge_bases_insert_curator) as
// the manual attach path. Best-effort: the workstream already exists, so a
// failure here is logged rather than reported as a failed create -- the KBs
// can still be attached by hand from the workstream page.
async function attachProjectKnowledgeBasesToWorkstream(ctx: WorkbenchCallerContext, projectId: string, workstreamId: string) {
  const { data: links, error: linkError } = await ctx.supabase
    .from('project_knowledge_bases')
    .select('knowledge_base_id')
    .eq('project_id', projectId)
  if (linkError) {
    console.error('Failed to load project knowledge bases for new workstream', linkError)
    return
  }
  const kbIds = (links ?? []).map((l: { knowledge_base_id: string }) => l.knowledge_base_id)
  if (kbIds.length === 0) return

  const { error } = await ctx.supabase
    .from('workstream_knowledge_bases')
    .insert(kbIds.map((kbId: string) => ({ workstream_id: workstreamId, knowledge_base_id: kbId, attached_by: ctx.user.id })))
  if (error) console.error('Failed to attach project knowledge bases to new workstream', error)
}

// A deliverable being marked done is treated as a reviewed claim, not a
// self-report -- deliberately the same curator+ gate as creation, not the
// broader consultant bar attachArtifact uses below.
export async function toggleDeliverable(ctx: WorkbenchCallerContext, workstreamId: string, index: number) {
  const { supabase } = ctx

  const { data: workstream, error: fetchError } = await supabase
    .from('project_workstreams')
    .select('id, project_id, deliverables')
    .eq('id', workstreamId)
    .single()
  if (fetchError || !workstream) throw fetchError ?? new ProjectValidationError('Workstream not found')

  const deliverables = [...workstream.deliverables]
  if (!deliverables[index]) throw new ProjectValidationError('Deliverable not found')
  deliverables[index] = { ...deliverables[index], completed: !deliverables[index].completed }

  const { data, error } = await supabase.from('project_workstreams').update({ deliverables }).eq('id', workstreamId).select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError('You do not have permission to update this workstream')
  }

  return { projectId: workstream.project_id }
}

// Same curator+ gate as toggleDeliverable -- the outcome summary is a
// reviewed claim about what the evidence shows, not a self-report.
export async function updateWorkstreamSummary(ctx: WorkbenchCallerContext, workstreamId: string, summary: string) {
  const { supabase } = ctx

  const { data: workstream, error: fetchError } = await supabase
    .from('project_workstreams')
    .select('project_id')
    .eq('id', workstreamId)
    .single()
  if (fetchError || !workstream) throw fetchError ?? new ProjectValidationError('Workstream not found')

  const { data, error } = await supabase
    .from('project_workstreams')
    .update({ summary: summary.trim() || null })
    .eq('id', workstreamId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError('You do not have permission to update this workstream')
  }

  return { projectId: workstream.project_id }
}

// Broader than curator -- the consultant who did the external work is who
// attaches the evidence (workstream_artifacts_insert_consultant: owner/
// curator/consultant, excludes viewer).
export async function attachArtifact(
  ctx: WorkbenchCallerContext,
  input: {
    workstreamId: string
    artifactType: ArtifactType
    title: string
    externalTool?: string
    content?: string
    externalUrl?: string
    notes?: string
  }
) {
  const { profile, supabase } = ctx
  if (profile.role === 'anonymous') throw new AuthError('Create an account to attach an artifact')
  if (!input.content?.trim() && !input.externalUrl?.trim()) {
    throw new ProjectValidationError('Provide either content or a link to attach as evidence')
  }
  if (input.externalUrl?.trim() && !isGithubUrl(input.externalUrl.trim())) {
    throw new ProjectValidationError('Link must be a github.com URL (ideally the PR or commit, not just the repo root)')
  }

  const { data: workstream, error: workstreamError } = await supabase
    .from('project_workstreams')
    .select('project_id')
    .eq('id', input.workstreamId)
    .single()
  if (workstreamError || !workstream) throw workstreamError ?? new ProjectValidationError('Workstream not found')

  // OL-010: "successfully attached" must not imply the content satisfies its
  // acceptance criteria. Only openapi_spec has a validator today (see
  // openapi-validation.ts) -- every other artifact type has no automated
  // check yet, so it goes straight to ready_for_review rather than being
  // falsely marked either validated or failed.
  let status: WorkstreamArtifactStatus = 'ready_for_review'
  let validationNotes: string[] = []
  if (input.artifactType === 'openapi_spec' && input.content?.trim()) {
    const result = validateOpenApiContent(input.content)
    status = result.ok ? 'ready_for_review' : 'validation_failed'
    validationNotes = result.notes
  }

  const { data: artifact, error } = await supabase
    .from('workstream_artifacts')
    .insert({
      workstream_id: input.workstreamId,
      artifact_type: input.artifactType,
      title: input.title,
      external_tool: input.externalTool || null,
      content: input.content || null,
      external_url: input.externalUrl || null,
      notes: input.notes || null,
      created_by: profile.id,
      status,
      validation_notes: validationNotes.length > 0 ? validationNotes.join('; ') : null,
    })
    .select('id')
    .single()
  if (error || !artifact) throw error ?? new ProjectValidationError('Failed to attach artifact')

  return { projectId: workstream.project_id, artifactId: artifact.id, status, validationNotes }
}

// Same authorization bar as workstream creation/curation (can_curate_project
// via workstream_artifacts_update_review_curator) -- reviewing whether an
// artifact meets its acceptance criteria is a curator-level judgment, same
// as toggleDeliverable/updateWorkstreamSummary above, broader than the
// consultant bar attachArtifact itself uses.
export async function reviewArtifact(
  ctx: WorkbenchCallerContext,
  artifactId: string,
  decision: 'approved' | 'rejected',
  notes?: string
) {
  const { user, supabase } = ctx

  const { data, error } = await supabase
    .from('workstream_artifacts')
    .update({
      status: decision,
      validation_notes: notes?.trim() || null,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .eq('id', artifactId)
    .select('id, workstream_id')
  if (error) throw error
  if (!data || data.length === 0) {
    throw new ProjectValidationError('You do not have permission to review this artifact')
  }

  return { artifactId, workstreamId: data[0].workstream_id, status: decision }
}
