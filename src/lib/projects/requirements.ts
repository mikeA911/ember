import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { getActiveProjectRole, type WorkbenchCallerContext } from '@/lib/workbench/context'
import { listSourcesForKnowledgeBases } from '@/lib/projects/queries'
import { listArticlesForProject } from '@/lib/wiki/project-links'
import type {
  Database,
  RequirementAppliesFrom,
  RequirementCategory,
  RequirementPriority,
  RequirementSourceKind,
  SolutionRequirement,
  SolutionRequirementSource,
  SolutionVerificationMethod,
  VerificationMethodKind,
  VerificationPerformer,
} from '@/types/database'

// Solution conformance and acceptance evaluation, Stage 1 (docs/dev-request-
// solution-conformance-and-acceptance-evaluation.md): the Project's
// requirements register. RLS (20261017100001_solution_requirements.sql) lets
// every member read it and the Project's curators/admins write it, only
// while a requirement is a draft; these functions add clear validation and
// messages on top.

const CATEGORIES: RequirementCategory[] = ['functional', 'interface', 'performance', 'security', 'privacy', 'operational', 'regulatory', 'contractual']
const PRIORITIES: RequirementPriority[] = ['must', 'should', 'could']
const APPLIES_FROM: RequirementAppliesFrom[] = ['presales', 'deployment', 'management_maintenance']
const SOURCE_KINDS: RequirementSourceKind[] = ['standard', 'regulation', 'contract', 'customer_need', 'vendor_claim']
const METHODS: VerificationMethodKind[] = ['test', 'demonstration', 'inspection', 'analysis', 'vendor_evidence', 'operational_measure']
const PERFORMERS: VerificationPerformer[] = ['vendor', 'integrator', 'customer', 'independent_tester', 'project_team']

export class RequirementValidationError extends Error {}

function clean(value: string | undefined | null, max = 4000): string | null {
  const trimmed = (value ?? '').trim()
  return trimmed ? trimmed.slice(0, max) : null
}

function required(value: string | undefined | null, what: string, max = 4000): string {
  const cleaned = clean(value, max)
  if (!cleaned) throw new RequirementValidationError(`${what} is required`)
  return cleaned
}

// Turns database refusals into messages a curator can act on.
function rethrow(err: unknown): never {
  const e = err as { code?: string; message?: string } | null
  if (e?.code === '23505') throw new RequirementValidationError('That code is already used in this Project')
  const message = e?.message ?? ''
  if (message.includes('only a draft requirement can be edited')) {
    throw new RequirementValidationError('Only a draft requirement can be edited. Withdraw it, or supersede it with a new one.')
  }
  if (message.includes('cannot be reopened')) throw new RequirementValidationError('A superseded or withdrawn requirement cannot be reopened')
  if (message.includes('must be in this Project')) throw new RequirementValidationError('Scope must be a workstream or object in this Project')
  // A requirement with verification records can't be deleted (Stage 2).
  if (e?.code === '23503' && message.includes('solution_verification_records')) {
    throw new RequirementValidationError('This requirement has verification results, so it can’t be deleted. Withdraw it instead.')
  }
  if (e?.code === '42501') throw new RequirementValidationError('Only a draft requirement can be changed, by this Project’s owner or curators')
  throw err
}

async function requireCurator(ctx: WorkbenchCallerContext, projectId: string) {
  if (ctx.profile.role === 'admin') return
  const role = await getActiveProjectRole(ctx, projectId)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError("Requires this project's owner or curator role (or platform admin) to change its requirements")
  }
}

// --- Reading -------------------------------------------------------------------------

export interface RequirementListRow extends SolutionRequirement {
  sourceKinds: RequirementSourceKind[]
  methodCount: number
  workstreamNames: string[]
  objectNames: string[]
}

export async function listRequirements(supabase: SupabaseClient<Database>, projectId: string): Promise<RequirementListRow[]> {
  const [{ data: requirements, error }, { data: sources }, { data: methods }, { data: links }, { data: workstreams }, { data: objects }] = await Promise.all([
    supabase.from('solution_requirements').select('*').eq('project_id', projectId).order('code'),
    supabase.from('solution_requirement_sources').select('requirement_id, kind').eq('project_id', projectId),
    supabase.from('solution_verification_methods').select('requirement_id').eq('project_id', projectId),
    supabase.from('solution_requirement_scope_links').select('requirement_id, workstream_id, project_object_id').eq('project_id', projectId),
    supabase.from('project_workstreams').select('id, name').eq('project_id', projectId),
    supabase.from('project_objects').select('id, name').eq('project_id', projectId),
  ])
  if (error) throw error
  const workstreamName = new Map((workstreams ?? []).map((w) => [w.id, w.name]))
  const objectName = new Map((objects ?? []).map((o) => [o.id, o.name]))

  return (requirements ?? []).map((r) => ({
    ...r,
    sourceKinds: [...new Set((sources ?? []).filter((s) => s.requirement_id === r.id).map((s) => s.kind))],
    methodCount: (methods ?? []).filter((m) => m.requirement_id === r.id).length,
    workstreamNames: (links ?? []).filter((l) => l.requirement_id === r.id && l.workstream_id).map((l) => workstreamName.get(l.workstream_id!) ?? 'Workstream'),
    objectNames: (links ?? []).filter((l) => l.requirement_id === r.id && l.project_object_id).map((l) => objectName.get(l.project_object_id!) ?? 'Object'),
  }))
}

export interface RequirementSourceView extends SolutionRequirementSource {
  sourceTitle: string | null
  articleTitle: string | null
  articleSlug: string | null
}

export interface RequirementDetail {
  requirement: SolutionRequirement
  sources: RequirementSourceView[]
  methods: SolutionVerificationMethod[]
  workstreams: { id: string; name: string }[]
  objects: { id: string; name: string }[]
}

export async function getRequirement(supabase: SupabaseClient<Database>, projectId: string, requirementId: string): Promise<RequirementDetail | null> {
  const { data: requirement, error } = await supabase
    .from('solution_requirements')
    .select('*')
    .eq('id', requirementId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!requirement) return null

  const [{ data: sources }, { data: methods }, { data: links }] = await Promise.all([
    supabase.from('solution_requirement_sources').select('*').eq('requirement_id', requirementId).order('created_at'),
    supabase.from('solution_verification_methods').select('*').eq('requirement_id', requirementId).order('created_at'),
    supabase.from('solution_requirement_scope_links').select('workstream_id, project_object_id').eq('requirement_id', requirementId),
  ])

  const sourceIds = (sources ?? []).map((s) => s.knowledge_source_id).filter((x): x is string => !!x)
  const articleIds = (sources ?? []).map((s) => s.wiki_article_id).filter((x): x is string => !!x)
  const workstreamIds = (links ?? []).map((l) => l.workstream_id).filter((x): x is string => !!x)
  const objectIds = (links ?? []).map((l) => l.project_object_id).filter((x): x is string => !!x)

  const [{ data: sourceRows }, { data: articleRows }, { data: workstreamRows }, { data: objectRows }] = await Promise.all([
    sourceIds.length ? supabase.from('knowledge_sources').select('id, title').in('id', sourceIds) : Promise.resolve({ data: [] }),
    articleIds.length ? supabase.from('wiki_articles').select('id, title, slug').in('id', articleIds) : Promise.resolve({ data: [] }),
    workstreamIds.length ? supabase.from('project_workstreams').select('id, name').in('id', workstreamIds) : Promise.resolve({ data: [] }),
    objectIds.length ? supabase.from('project_objects').select('id, name').in('id', objectIds) : Promise.resolve({ data: [] }),
  ])
  const sourceTitle = new Map((sourceRows ?? []).map((s: { id: string; title: string }) => [s.id, s.title]))
  const article = new Map((articleRows ?? []).map((a: { id: string; title: string; slug: string }) => [a.id, a]))

  return {
    requirement,
    sources: (sources ?? []).map((s) => ({
      ...s,
      sourceTitle: s.knowledge_source_id ? (sourceTitle.get(s.knowledge_source_id) ?? null) : null,
      articleTitle: s.wiki_article_id ? (article.get(s.wiki_article_id)?.title ?? null) : null,
      articleSlug: s.wiki_article_id ? (article.get(s.wiki_article_id)?.slug ?? null) : null,
    })),
    methods: methods ?? [],
    workstreams: (workstreamRows ?? []) as { id: string; name: string }[],
    objects: (objectRows ?? []) as { id: string; name: string }[],
  }
}

// Next free "REQ-nnn" code in the Project, used when the curator leaves the
// code blank.
export async function nextRequirementCode(supabase: SupabaseClient<Database>, projectId: string): Promise<string> {
  const { data } = await supabase.from('solution_requirements').select('code').eq('project_id', projectId)
  const numbers = (data ?? []).map((r) => /^REQ-(\d+)$/.exec(r.code)?.[1]).filter((x): x is string => !!x).map(Number)
  const next = (numbers.length ? Math.max(...numbers) : 0) + 1
  return `REQ-${String(next).padStart(3, '0')}`
}

// What a requirement can cite and be scoped to in this Project: sources in
// the Project's and its workstreams' knowledge bases (the same scope as
// Ember's Project search), Wiki articles attached to the Project, and the
// Project's workstreams and objects. All read under the caller's RLS.
export interface RequirementOptions {
  sources: { id: string; title: string; context: string | null }[]
  articles: { id: string; title: string }[]
  workstreams: { id: string; name: string }[]
  objects: { id: string; name: string }[]
}

export async function getRequirementOptions(supabase: SupabaseClient<Database>, projectId: string): Promise<RequirementOptions> {
  const [{ data: projectKbs }, { data: workstreamKbs }, articles, { data: workstreams }, { data: objects }] = await Promise.all([
    supabase.from('project_knowledge_bases').select('knowledge_base_id').eq('project_id', projectId),
    supabase
      .from('workstream_knowledge_bases')
      .select('knowledge_base_id, workstream:project_workstreams!inner(project_id, name)')
      .eq('workstream.project_id', projectId),
    listArticlesForProject(supabase, projectId),
    supabase.from('project_workstreams').select('id, name').eq('project_id', projectId).order('name'),
    supabase.from('project_objects').select('id, name').eq('project_id', projectId).order('name'),
  ])
  const workstreamNameByKb = new Map<string, string>()
  for (const link of workstreamKbs ?? []) {
    const workstream = link.workstream as unknown as { name: string } | null
    if (workstream && !workstreamNameByKb.has(link.knowledge_base_id)) workstreamNameByKb.set(link.knowledge_base_id, workstream.name)
  }
  const projectKbIds = new Set((projectKbs ?? []).map((k) => k.knowledge_base_id))
  const kbIds = [...new Set([...projectKbIds, ...workstreamNameByKb.keys()])]
  const sources = (await listSourcesForKnowledgeBases(supabase, kbIds)).filter((src) => src.lifecycleStatus === 'active')

  return {
    sources: sources.map((src) => ({
      id: src.id,
      title: src.title,
      context: projectKbIds.has(src.knowledgeBaseId) ? null : (workstreamNameByKb.get(src.knowledgeBaseId) ?? null),
    })),
    articles: articles.flatMap((l) => (l.article && l.article.status === 'approved' ? [{ id: l.article.id, title: l.article.title }] : [])),
    workstreams: workstreams ?? [],
    objects: objects ?? [],
  }
}

// --- Writing -------------------------------------------------------------------------

export interface RequirementFieldsInput {
  code?: string
  title: string
  statement: string
  rationale?: string
  category: RequirementCategory
  priority: RequirementPriority
  appliesFrom: RequirementAppliesFrom
}

export interface RequirementSourceInput {
  kind: RequirementSourceKind
  knowledgeSourceId?: string | null
  wikiArticleId?: string | null
  locator?: string
  requester?: string
  note?: string
}

function validateFields(input: RequirementFieldsInput) {
  if (!CATEGORIES.includes(input.category)) throw new RequirementValidationError('Choose a category')
  if (!PRIORITIES.includes(input.priority)) throw new RequirementValidationError('Choose a priority')
  if (!APPLIES_FROM.includes(input.appliesFrom)) throw new RequirementValidationError('Choose when it must be verified from')
  return {
    title: required(input.title, 'A title', 200),
    statement: required(input.statement, 'The requirement statement'),
    rationale: clean(input.rationale),
  }
}

function validateSource(input: RequirementSourceInput) {
  if (!SOURCE_KINDS.includes(input.kind)) throw new RequirementValidationError('Choose where the requirement comes from')
  const requester = clean(input.requester, 300)
  if (input.kind === 'customer_need' && !requester) throw new RequirementValidationError('Name who asked for a customer need')
  const locator = clean(input.locator, 500)
  if (input.kind !== 'customer_need' && !locator && !input.knowledgeSourceId && !input.wikiArticleId) {
    throw new RequirementValidationError('Point to the source: link it from the knowledge base or give a clause, section or page')
  }
  return { locator, requester, note: clean(input.note) }
}

// A requirement needs at least one origin (the dev request: a requirement
// without one is allowed only as a customer need with a named requester).
export async function createRequirement(
  ctx: WorkbenchCallerContext,
  projectId: string,
  input: RequirementFieldsInput & { sources: RequirementSourceInput[]; workstreamIds?: string[]; objectIds?: string[] }
): Promise<{ requirementId: string }> {
  await requireCurator(ctx, projectId)
  const fields = validateFields(input)
  if (input.sources.length === 0) throw new RequirementValidationError('Add at least one source: a standard, regulation, contract, customer need or vendor claim')
  const sources = input.sources.map((s) => ({ input: s, ...validateSource(s) }))
  const code = clean(input.code, 60) ?? (await nextRequirementCode(ctx.supabase, projectId))

  const { data: created, error } = await ctx.supabase
    .from('solution_requirements')
    .insert({
      project_id: projectId,
      code,
      title: fields.title,
      statement: fields.statement,
      rationale: fields.rationale,
      category: input.category,
      priority: input.priority,
      applies_from: input.appliesFrom,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !created) rethrow(error ?? new Error('Could not create the requirement'))

  try {
    const { error: sourceError } = await ctx.supabase.from('solution_requirement_sources').insert(
      sources.map((s) => ({
        requirement_id: created.id,
        project_id: projectId,
        kind: s.input.kind,
        knowledge_source_id: s.input.knowledgeSourceId || null,
        wiki_article_id: s.input.wikiArticleId || null,
        locator: s.locator,
        requester: s.requester,
        note: s.note,
        created_by: ctx.user.id,
      }))
    )
    if (sourceError) throw sourceError
    await replaceScope(ctx, projectId, created.id, input.workstreamIds ?? [], input.objectIds ?? [])
  } catch (err) {
    // Keep the register consistent: no requirement without its sources.
    await ctx.supabase.from('solution_requirements').delete().eq('id', created.id)
    rethrow(err)
  }
  return { requirementId: created.id }
}

async function loadRequirementForCurator(ctx: WorkbenchCallerContext, requirementId: string): Promise<SolutionRequirement> {
  const { data, error } = await ctx.supabase.from('solution_requirements').select('*').eq('id', requirementId).maybeSingle()
  if (error) throw error
  if (!data) throw new RequirementValidationError('That requirement could not be found')
  await requireCurator(ctx, data.project_id)
  return data
}

function requireDraft(requirement: SolutionRequirement) {
  if (requirement.status !== 'draft') {
    throw new RequirementValidationError('Only a draft requirement can be edited. Withdraw it, or supersede it with a new one.')
  }
}

export async function updateRequirement(ctx: WorkbenchCallerContext, requirementId: string, input: RequirementFieldsInput): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  requireDraft(requirement)
  const fields = validateFields(input)
  const { error } = await ctx.supabase
    .from('solution_requirements')
    .update({
      code: clean(input.code, 60) ?? requirement.code,
      title: fields.title,
      statement: fields.statement,
      rationale: fields.rationale,
      category: input.category,
      priority: input.priority,
      applies_from: input.appliesFrom,
    })
    .eq('id', requirementId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

export async function addRequirementSource(ctx: WorkbenchCallerContext, requirementId: string, input: RequirementSourceInput): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  requireDraft(requirement)
  const source = validateSource(input)
  const { error } = await ctx.supabase.from('solution_requirement_sources').insert({
    requirement_id: requirementId,
    project_id: requirement.project_id,
    kind: input.kind,
    knowledge_source_id: input.knowledgeSourceId || null,
    wiki_article_id: input.wikiArticleId || null,
    locator: source.locator,
    requester: source.requester,
    note: source.note,
    created_by: ctx.user.id,
  })
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

export async function removeRequirementSource(ctx: WorkbenchCallerContext, sourceId: string): Promise<{ projectId: string }> {
  const { data: source } = await ctx.supabase.from('solution_requirement_sources').select('requirement_id').eq('id', sourceId).maybeSingle()
  if (!source) throw new RequirementValidationError('That source could not be found')
  const requirement = await loadRequirementForCurator(ctx, source.requirement_id)
  requireDraft(requirement)
  const { count } = await ctx.supabase.from('solution_requirement_sources').select('id', { count: 'exact', head: true }).eq('requirement_id', requirement.id)
  if ((count ?? 0) <= 1) throw new RequirementValidationError('A requirement needs at least one source. Add another before removing this one.')
  const { error } = await ctx.supabase.from('solution_requirement_sources').delete().eq('id', sourceId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

async function replaceScope(ctx: WorkbenchCallerContext, projectId: string, requirementId: string, workstreamIds: string[], objectIds: string[]) {
  const { error: deleteError } = await ctx.supabase.from('solution_requirement_scope_links').delete().eq('requirement_id', requirementId)
  if (deleteError) throw deleteError
  const rows = [
    ...[...new Set(workstreamIds)].map((id) => ({ requirement_id: requirementId, project_id: projectId, workstream_id: id })),
    ...[...new Set(objectIds)].map((id) => ({ requirement_id: requirementId, project_id: projectId, project_object_id: id })),
  ]
  if (rows.length === 0) return
  const { error } = await ctx.supabase.from('solution_requirement_scope_links').insert(rows)
  if (error) throw error
}

export async function setRequirementScope(
  ctx: WorkbenchCallerContext,
  requirementId: string,
  input: { workstreamIds: string[]; objectIds: string[] }
): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  requireDraft(requirement)
  try {
    await replaceScope(ctx, requirement.project_id, requirementId, input.workstreamIds, input.objectIds)
  } catch (err) {
    rethrow(err)
  }
  return { projectId: requirement.project_id }
}

export interface VerificationMethodInput {
  method: VerificationMethodKind
  procedure?: string
  passCriteria: string
  threshold?: string
  measureWindow?: string
  performedBy: VerificationPerformer
}

function validateMethod(input: VerificationMethodInput) {
  if (!METHODS.includes(input.method)) throw new RequirementValidationError('Choose a verification method')
  if (!PERFORMERS.includes(input.performedBy)) throw new RequirementValidationError('Choose who performs it')
  const threshold = clean(input.threshold, 300)
  const measureWindow = clean(input.measureWindow, 300)
  if (input.method === 'operational_measure' && (!threshold || !measureWindow)) {
    throw new RequirementValidationError('An operational measure needs a threshold and the window it is measured over')
  }
  return { procedure: clean(input.procedure), passCriteria: required(input.passCriteria, 'Pass criteria'), threshold, measureWindow }
}

export async function addVerificationMethod(ctx: WorkbenchCallerContext, requirementId: string, input: VerificationMethodInput): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  requireDraft(requirement)
  const method = validateMethod(input)
  const { error } = await ctx.supabase.from('solution_verification_methods').insert({
    requirement_id: requirementId,
    project_id: requirement.project_id,
    method: input.method,
    procedure: method.procedure,
    pass_criteria: method.passCriteria,
    threshold: method.threshold,
    measure_window: method.measureWindow,
    performed_by: input.performedBy,
    created_by: ctx.user.id,
  })
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

export async function updateVerificationMethod(ctx: WorkbenchCallerContext, methodId: string, input: VerificationMethodInput): Promise<{ projectId: string }> {
  const { data: existing } = await ctx.supabase.from('solution_verification_methods').select('requirement_id').eq('id', methodId).maybeSingle()
  if (!existing) throw new RequirementValidationError('That verification method could not be found')
  const requirement = await loadRequirementForCurator(ctx, existing.requirement_id)
  requireDraft(requirement)
  const method = validateMethod(input)
  const { error } = await ctx.supabase
    .from('solution_verification_methods')
    .update({
      method: input.method,
      procedure: method.procedure,
      pass_criteria: method.passCriteria,
      threshold: method.threshold,
      measure_window: method.measureWindow,
      performed_by: input.performedBy,
    })
    .eq('id', methodId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

export async function removeVerificationMethod(ctx: WorkbenchCallerContext, methodId: string): Promise<{ projectId: string }> {
  const { data: existing } = await ctx.supabase.from('solution_verification_methods').select('requirement_id').eq('id', methodId).maybeSingle()
  if (!existing) throw new RequirementValidationError('That verification method could not be found')
  const requirement = await loadRequirementForCurator(ctx, existing.requirement_id)
  requireDraft(requirement)
  const { error } = await ctx.supabase.from('solution_verification_methods').delete().eq('id', methodId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

// Withdrawn requirements stay in the register (readable, never reopened);
// a draft that was a mistake can be deleted outright.
export async function withdrawRequirement(ctx: WorkbenchCallerContext, requirementId: string): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  if (requirement.status === 'withdrawn' || requirement.status === 'superseded') {
    throw new RequirementValidationError('This requirement is already closed')
  }
  const { error } = await ctx.supabase.from('solution_requirements').update({ status: 'withdrawn' }).eq('id', requirementId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

export async function deleteDraftRequirement(ctx: WorkbenchCallerContext, requirementId: string): Promise<{ projectId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  requireDraft(requirement)
  const { error } = await ctx.supabase.from('solution_requirements').delete().eq('id', requirementId)
  if (error) rethrow(error)
  return { projectId: requirement.project_id }
}

// "REQ-001" -> "REQ-001-R2", "REQ-001-R2" -> "REQ-001-R3".
export function nextRevisionCode(code: string): string {
  const match = /^(.*)-R(\d+)$/.exec(code)
  return match ? `${match[1]}-R${Number(match[2]) + 1}` : `${code}-R2`
}

// Stage 3: a baselined requirement's content is fixed, so changing it means
// superseding it with a new draft -- a copy of its content, sources, scope
// and verification methods, linked as its replacement. The old requirement
// stays readable (with its results and the baselines and decisions that
// cite it); the new one starts unverified.
export async function supersedeRequirement(
  ctx: WorkbenchCallerContext,
  requirementId: string,
  input: { code?: string } = {}
): Promise<{ projectId: string; requirementId: string }> {
  const requirement = await loadRequirementForCurator(ctx, requirementId)
  if (requirement.status !== 'baselined') {
    throw new RequirementValidationError(
      requirement.status === 'draft' ? 'A draft can still be edited directly' : 'This requirement is already closed'
    )
  }
  const [{ data: sources }, { data: links }, { data: methods }] = await Promise.all([
    ctx.supabase.from('solution_requirement_sources').select('*').eq('requirement_id', requirementId),
    ctx.supabase.from('solution_requirement_scope_links').select('workstream_id, project_object_id').eq('requirement_id', requirementId),
    ctx.supabase.from('solution_verification_methods').select('*').eq('requirement_id', requirementId),
  ])

  const { data: created, error } = await ctx.supabase
    .from('solution_requirements')
    .insert({
      project_id: requirement.project_id,
      code: clean(input.code, 60) ?? nextRevisionCode(requirement.code),
      title: requirement.title,
      statement: requirement.statement,
      rationale: requirement.rationale,
      category: requirement.category,
      priority: requirement.priority,
      applies_from: requirement.applies_from,
      created_by: ctx.user.id,
    })
    .select('id')
    .single()
  if (error || !created) rethrow(error ?? new Error('Could not create the replacement'))

  try {
    if (sources?.length) {
      const { error: sourceError } = await ctx.supabase.from('solution_requirement_sources').insert(
        sources.map((s) => ({
          requirement_id: created.id,
          project_id: requirement.project_id,
          kind: s.kind,
          knowledge_source_id: s.knowledge_source_id,
          wiki_article_id: s.wiki_article_id,
          locator: s.locator,
          requester: s.requester,
          note: s.note,
          created_by: ctx.user.id,
        }))
      )
      if (sourceError) throw sourceError
    }
    await replaceScope(
      ctx,
      requirement.project_id,
      created.id,
      (links ?? []).map((l) => l.workstream_id).filter((x): x is string => !!x),
      (links ?? []).map((l) => l.project_object_id).filter((x): x is string => !!x)
    )
    if (methods?.length) {
      const { error: methodError } = await ctx.supabase.from('solution_verification_methods').insert(
        methods.map((m) => ({
          requirement_id: created.id,
          project_id: requirement.project_id,
          method: m.method,
          procedure: m.procedure,
          pass_criteria: m.pass_criteria,
          threshold: m.threshold,
          measure_window: m.measure_window,
          performed_by: m.performed_by,
          created_by: ctx.user.id,
        }))
      )
      if (methodError) throw methodError
    }
    const { error: closeError } = await ctx.supabase
      .from('solution_requirements')
      .update({ status: 'superseded', superseded_by: created.id })
      .eq('id', requirementId)
    if (closeError) throw closeError
  } catch (err) {
    // No half-made replacement: the new draft (and its children) goes.
    await ctx.supabase.from('solution_requirements').delete().eq('id', created.id)
    rethrow(err)
  }
  return { projectId: requirement.project_id, requirementId: created.id }
}
