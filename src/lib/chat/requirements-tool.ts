import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { addVerificationMethod, createRequirement, getRequirementOptions, listRequirements, RequirementValidationError } from '@/lib/projects/requirements'
import { currentResultByMethod, rollUpVerification } from '@/lib/projects/verification'
import { listReverificationDue } from '@/lib/projects/reverification'
import { AuthError } from '@/lib/auth'

// Solution conformance and acceptance evaluation, Stage 5 (docs/dev-request-
// solution-conformance-and-acceptance-evaluation.md): Ember tools for the
// requirements register. Same interception pattern as list_workstreams /
// create_project_ontology -- handled in loop.ts, never in the general MCP
// registry, always scoped to the conversation's own server-resolved
// project.
//
//   * list_requirement_status (read): where each requirement stands --
//     verification, missing evidence, re-verification -- under the caller's
//     own RLS, so restricted sources and evidence stay hidden.
//   * create_draft_requirements / add_verification_methods (write, owner/
//     curator/admin): only after the user confirms in their own reply
//     (prompt guidance, same trust boundary as create_project_ontology).
//     Ember's drafts are marked created_via 'assistant' and the database
//     holds them "awaiting acceptance" -- they can't be baselined until a
//     curator accepts them.
//
// There is deliberately no tool to record results, waive, baseline or
// approve: those stay human decisions in the UI.

export const LIST_REQUIREMENT_STATUS_TOOL_NAME = 'list_requirement_status'
export const CREATE_DRAFT_REQUIREMENTS_TOOL_NAME = 'create_draft_requirements'
export const ADD_VERIFICATION_METHODS_TOOL_NAME = 'add_verification_methods'

const MAX_LISTED = 100

const ListInputSchema = z.object({
  workstreamId: z.string().optional(),
  includeClosed: z.boolean().optional(),
})

export const LIST_REQUIREMENT_STATUS_TOOL: ToolSpec = {
  name: LIST_REQUIREMENT_STATUS_TOOL_NAME,
  description:
    "List THIS project's solution requirements (what the delivered system must satisfy) and where each stands: its status (draft, baselined), verification status (passed, failed, conditional, partly verified, not verified, no method), the current result of each verification method, which methods are missing evidence, whether it needs re-verification and why, and whether Ember drafted it and it is still awaiting a curator's acceptance. Optionally only one workstream's requirements (get its id from list_workstreams). Read-only. The project is fixed for this conversation.",
  parameters: z.toJSONSchema(ListInputSchema),
}

const SourceSchema = z.object({
  kind: z.enum(['standard', 'regulation', 'contract', 'customer_need', 'vendor_claim']),
  knowledgeSourceId: z.string().optional(),
  wikiArticleSlug: z.string().optional(),
  locator: z.string().max(500).optional(),
  requester: z.string().max(300).optional(),
  note: z.string().max(2000).optional(),
})

const MethodSchema = z.object({
  method: z.enum(['test', 'demonstration', 'inspection', 'analysis', 'vendor_evidence', 'operational_measure']),
  passCriteria: z.string().min(1).max(2000),
  procedure: z.string().max(4000).optional(),
  threshold: z.string().max(300).optional(),
  measureWindow: z.string().max(300).optional(),
  performedBy: z.enum(['vendor', 'integrator', 'customer', 'independent_tester', 'project_team']).default('integrator'),
})

const DraftSchema = z.object({
  code: z.string().max(60).optional(),
  title: z.string().min(1).max(200),
  statement: z.string().min(1).max(4000),
  rationale: z.string().max(4000).optional(),
  category: z.enum(['functional', 'interface', 'performance', 'security', 'privacy', 'operational', 'regulatory', 'contractual']),
  priority: z.enum(['must', 'should', 'could']).default('must'),
  appliesFrom: z.enum(['presales', 'deployment', 'management_maintenance']).default('deployment'),
  sources: z.array(SourceSchema).min(1).max(5),
  workstreamIds: z.array(z.string()).max(10).optional(),
  methods: z.array(MethodSchema).max(5).optional(),
})

const CreateInputSchema = z.object({ requirements: z.array(DraftSchema).min(1).max(20) })

export const CREATE_DRAFT_REQUIREMENTS_TOOL: ToolSpec = {
  name: CREATE_DRAFT_REQUIREMENTS_TOOL_NAME,
  description:
    "Create draft solution requirements in THIS project's requirements register, exactly as the user confirmed. Each needs a verifiable statement and at least one source: kind (standard, regulation, contract, customer_need, vendor_claim) plus the clause, section or page as locator, and -- when it came from project knowledge -- the knowledgeSourceId (a knowledge_source hit's sourceId from search_project_knowledge) or wikiArticleSlug (a wiki_article hit's sourceId). A customer_need needs the requester's name. A vendor's statement of what its product does is a vendor_claim to verify, never a met requirement. Methods are optional verification methods (an operational_measure needs threshold and measureWindow). The drafts are marked as drafted by Ember and wait for a curator's acceptance before they can be baselined. Only call this after the user has explicitly confirmed the drafts in their own reply -- never in the same turn you proposed them. Requires this project's owner or curator role (or platform admin).",
  parameters: z.toJSONSchema(CreateInputSchema),
}

const AddMethodsInputSchema = z.object({
  requirementId: z.string(),
  methods: z.array(MethodSchema).min(1).max(5),
})

export const ADD_VERIFICATION_METHODS_TOOL: ToolSpec = {
  name: ADD_VERIFICATION_METHODS_TOOL_NAME,
  description:
    "Add verification methods (how a requirement will be shown to be met: test, demonstration, inspection, analysis, vendor_evidence or operational_measure, each with explicit, checkable pass criteria and who performs it) to one of THIS project's DRAFT requirements, exactly as the user confirmed. Get the requirementId from list_requirement_status. An operational_measure needs threshold and measureWindow -- take the figures from the governing standard or contract in project knowledge, never invent them. Only call this after the user has explicitly confirmed in their own reply -- never in the same turn you proposed them. Baselined requirements can't be changed. Requires this project's owner or curator role (or platform admin).",
  parameters: z.toJSONSchema(AddMethodsInputSchema),
}

// --- list_requirement_status -----------------------------------------------------------

export async function runListRequirementStatus(ctx: WorkbenchCallerContext, projectId: string, rawInput: unknown) {
  const input = ListInputSchema.parse(rawInput ?? {})
  const [requirements, { data: methods }, { data: records }, { data: scope }, due] = await Promise.all([
    listRequirements(ctx.supabase, projectId),
    ctx.supabase.from('solution_verification_methods').select('id, requirement_id, method, pass_criteria').eq('project_id', projectId),
    ctx.supabase
      .from('solution_verification_records')
      .select('id, requirement_id, method_id, result, performed_on, recorded_at, supersedes_id, environment, solution_reference')
      .eq('project_id', projectId),
    input.workstreamId
      ? ctx.supabase.from('solution_requirement_scope_links').select('requirement_id').eq('project_id', projectId).eq('workstream_id', input.workstreamId)
      : Promise.resolve({ data: null }),
    listReverificationDue(ctx.supabase, projectId).catch(() => new Map()),
  ])
  const inWorkstream = scope ? new Set(scope.map((s) => s.requirement_id)) : null
  const selected = requirements
    .filter((r) => input.includeClosed || r.status === 'draft' || r.status === 'baselined')
    .filter((r) => !inWorkstream || inWorkstream.has(r.id))

  const rows = selected.slice(0, MAX_LISTED).map((r) => {
    const own = (methods ?? []).filter((m) => m.requirement_id === r.id)
    const ownRecords = (records ?? []).filter((x) => x.requirement_id === r.id)
    const current = currentResultByMethod(ownRecords)
    const reverification = due.get(r.id)
    const methodRows = own.map((m) => {
      const result = current.get(m.id)
      return {
        method: m.method,
        passCriteria: m.pass_criteria,
        currentResult: result ? { result: result.result, performedOn: result.performed_on, environment: result.environment, solution: result.solution_reference } : null,
      }
    })
    return {
      id: r.id,
      code: r.code,
      title: r.title,
      status: r.status,
      category: r.category,
      priority: r.priority,
      workstreams: r.workstreamNames,
      sourceKinds: r.sourceKinds,
      verification: rollUpVerification(
        own.map((m) => m.id),
        ownRecords
      ),
      methods: methodRows,
      // Methods with no current pass (or not-applicable): evidence still needed.
      missingEvidence: methodRows.filter((m) => !m.currentResult || !['pass', 'not_applicable'].includes(m.currentResult.result)).map((m) => m.method),
      reverificationDue: reverification ? { openEvents: reverification.openEventIds.length, reviewDue: reverification.reviewDue } : null,
      draftedByEmberAwaitingAcceptance: r.awaiting_acceptance,
      url: `/projects/${projectId}/requirements/${r.id}`,
    }
  })

  return {
    total: selected.length,
    listed: rows.length,
    counts: {
      passed: rows.filter((r) => r.verification === 'passed').length,
      failed: rows.filter((r) => r.verification === 'failed').length,
      notVerified: rows.filter((r) => ['not_verified', 'partial', 'no_method'].includes(r.verification)).length,
      needReverification: rows.filter((r) => r.reverificationDue).length,
      awaitingAcceptance: rows.filter((r) => r.draftedByEmberAwaitingAcceptance).length,
    },
    requirements: rows,
    registerUrl: `/projects/${projectId}/requirements`,
  }
}

// --- create_draft_requirements --------------------------------------------------------

export async function runCreateDraftRequirements(ctx: WorkbenchCallerContext, projectId: string, conversationId: string, rawInput: unknown) {
  const input = CreateInputSchema.parse(rawInput ?? {})
  // What can be cited: the same scope as the requirement forms (the
  // Project's and its workstreams' knowledge, Wiki articles attached to the
  // Project), read under the caller's RLS.
  const options = await getRequirementOptions(ctx.supabase, projectId)
  const sourceIds = new Set(options.sources.map((s) => s.id))
  const articleIds = new Set(options.articles.map((a) => a.id))
  const workstreamIds = new Set(options.workstreams.map((w) => w.id))
  const slugs = [...new Set(input.requirements.flatMap((r) => r.sources.map((s) => s.wikiArticleSlug).filter((x): x is string => !!x)))]
  const { data: articles } = slugs.length ? await ctx.supabase.from('wiki_articles').select('id, slug').in('slug', slugs) : { data: [] }
  const articleIdBySlug = new Map((articles ?? []).map((a) => [a.slug, a.id]))

  const created: { requirementId: string; code: string; title: string; url: string }[] = []
  const failed: { title: string; error: string }[] = []
  for (const draft of input.requirements) {
    try {
      const sources = draft.sources.map((s) => {
        if (s.knowledgeSourceId && !sourceIds.has(s.knowledgeSourceId)) {
          throw new RequirementValidationError(`Source ${s.knowledgeSourceId} is not in this project's knowledge`)
        }
        const articleId = s.wikiArticleSlug ? articleIdBySlug.get(s.wikiArticleSlug) : undefined
        if (s.wikiArticleSlug && (!articleId || !articleIds.has(articleId))) {
          throw new RequirementValidationError(`Wiki article "${s.wikiArticleSlug}" is not attached to this project`)
        }
        return { kind: s.kind, knowledgeSourceId: s.knowledgeSourceId ?? null, wikiArticleId: articleId ?? null, locator: s.locator, requester: s.requester, note: s.note }
      })
      const { requirementId, code } = await createRequirement(
        ctx,
        projectId,
        {
          code: draft.code,
          title: draft.title,
          statement: draft.statement,
          rationale: draft.rationale,
          category: draft.category,
          priority: draft.priority,
          appliesFrom: draft.appliesFrom,
          sources,
          workstreamIds: (draft.workstreamIds ?? []).filter((id) => workstreamIds.has(id)),
        },
        { createdVia: 'assistant', conversationId, methods: draft.methods }
      )
      created.push({ requirementId, code, title: draft.title, url: `/projects/${projectId}/requirements/${requirementId}` })
    } catch (err) {
      // A refusal for the whole call (not a curator) stops at once; other
      // problems are per draft, so the rest still get created.
      if (err instanceof AuthError) throw err
      failed.push({ title: draft.title, error: err instanceof Error ? err.message : 'Could not create it' })
    }
  }
  return {
    created,
    failed,
    note: 'These are drafts awaiting a curator’s acceptance on each requirement page. They are not in any baseline and have no verification results.',
    registerUrl: `/projects/${projectId}/requirements`,
  }
}

// --- add_verification_methods ---------------------------------------------------------

export async function runAddVerificationMethods(ctx: WorkbenchCallerContext, projectId: string, rawInput: unknown) {
  const input = AddMethodsInputSchema.parse(rawInput ?? {})
  const { data: requirement } = await ctx.supabase
    .from('solution_requirements')
    .select('id, code, project_id')
    .eq('id', input.requirementId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!requirement) throw new RequirementValidationError('That requirement is not in this project')
  for (const method of input.methods) {
    await addVerificationMethod(ctx, requirement.id, method, { createdVia: 'assistant' })
  }
  return { requirementId: requirement.id, code: requirement.code, added: input.methods.length, url: `/projects/${projectId}/requirements/${requirement.id}` }
}
