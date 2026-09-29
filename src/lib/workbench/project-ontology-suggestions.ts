import 'server-only'
import { z } from 'zod'
import type { ProjectType } from '@/types/database'
import { getActiveStructuredOutputProvider } from '@/lib/ai'
import { AuthError } from '@/lib/auth'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'
import { insertStagedTree } from './projects'

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md §6.3): a one-shot
// "Ask Ember to suggest" call from the project-creation wizard, not a chat
// tool call -- there's no generic code-enforced "propose, then confirm"
// mechanism in this codebase outside the MCP Gateway's PendingGatewayInvocation
// (tightly coupled to external tool calls, not reusable here). Instead the
// wizard stages the result as plain editable state, same "suggest then let
// the user edit before final submit" shape its own step 6
// (seedApprovalsIfNeeded) already uses -- nothing is written to
// project_objects/project_workstreams until the wizard's normal final
// submit. This call only ever sees the user's own freshly-typed objective/
// details text (never retrieved knowledge-base content), so it doesn't need
// withPolicyGate's sensitivity gate the way a live chat turn does.
// parentTempId is `.nullish()` (accepts null OR a missing key), not just
// `.nullable()` -- caught live: Gemini's structured output omits the key
// entirely for a top-level item rather than emitting `parentTempId: null`,
// which `.nullable()` alone rejects as a missing required field.
const SuggestionSchema = z.object({
  objects: z.array(z.object({ tempId: z.string(), parentTempId: z.string().nullish(), name: z.string(), description: z.string() })),
  workstreams: z.array(z.object({ tempId: z.string(), parentTempId: z.string().nullish(), name: z.string(), goal: z.string() })),
})

export type ProjectOntologySuggestion = z.infer<typeof SuggestionSchema>

function buildPrompt(projectType: ProjectType, objective: string, details: Record<string, string>): string {
  const detailLines = Object.entries(details)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
  return (
    `Project type: ${projectType}\nObjective: ${objective}\n${detailLines}\n\n` +
    'Suggest a starting domain-object ontology and a starting set of workstreams for this project.\n' +
    '"objects" are the domain object TYPES that matter in this business (e.g. for an airline client: Plane, Route; ' +
    'for a riverbank-monitoring client: Sensor, AnomalyEvent) -- not instances. Each object needs a unique tempId ' +
    '(any short string, e.g. "obj-1"), an optional parentTempId referencing another suggested object\'s tempId to ' +
    'nest it, a short name, and a one-sentence description.\n' +
    '"workstreams" are the units of engagement work. Each needs a unique tempId, an optional parentTempId to nest ' +
    'it under another suggested workstream, a short name, and a one-sentence goal.\n' +
    'Suggest 2-6 objects and 2-5 workstreams. This is a starting point the user will edit by hand -- when unsure, ' +
    'suggest fewer, clearly-named items rather than guessing at ambiguous detail.'
  )
}

export async function suggestProjectOntology(
  ctx: WorkbenchCallerContext,
  input: { projectType: ProjectType; objective: string; details: Record<string, string> }
): Promise<ProjectOntologySuggestion> {
  const provider = await getActiveStructuredOutputProvider(ctx.supabase, { requestedBy: ctx.user.id })
  const { data } = await provider.generateStructured({
    system: 'You help an Ember builder sketch a starting domain-object ontology and workstream set for a new project.',
    prompt: buildPrompt(input.projectType, input.objective, input.details),
    schema: SuggestionSchema,
    maxOutputTokens: 1024,
  })
  return data
}

// The chat-tool equivalent of the wizard's own "Ask Ember to suggest, then
// let the user edit before final submit" -- except here the project already
// exists, so there's no wizard-staged-state step for the user to edit
// through. Confirmation instead lives entirely in the chat tool's own
// description/prompt guidance (see suggest_project_ontology/
// create_project_ontology in src/lib/chat/project-ontology-tool.ts), the
// same "no code-level propose/confirm gate outside the MCP Gateway" trust
// boundary send_project_note already accepts.

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function requireCuratorForProject(ctx: WorkbenchCallerContext, projectId: string, actionLabel: string) {
  const { profile } = ctx
  if (profile.role === 'anonymous') throw new AuthError(`Create an account to ${actionLabel}`)
  if (profile.role !== 'admin') {
    const projectRole = await getActiveProjectRole(ctx, projectId)
    if (projectRole !== 'owner' && projectRole !== 'curator') {
      throw new AuthError(
        `To ${actionLabel} you need this project's owner or curator role (or platform admin) -- you're currently ${
          projectRole ? `a ${projectRole} on this project` : 'not an active member of this project'
        }.`
      )
    }
  }
}

export interface StagedOntologyObject {
  tempId: string
  parentTempId: string | null
  name: string
  description: string
}
export interface StagedOntologyWorkstream {
  tempId: string
  parentTempId: string | null
  name: string
  goal: string
}

// Writes a (possibly Ember-suggested, possibly hand-edited) object/
// workstream tree into an EXISTING project -- unlike createProject's own
// insertStagedTree calls, this project may already have objects/
// workstreams of its own, so slugs must be checked against what's already
// there (project_objects/project_workstreams both enforce unique(project_id,
// slug)), not just within this one batch.
export async function applyProjectOntologySuggestion(
  ctx: WorkbenchCallerContext,
  projectId: string,
  input: { objects: StagedOntologyObject[]; workstreams: StagedOntologyWorkstream[] }
): Promise<{ objectIds: string[]; workstreamIds: string[] }> {
  await requireCuratorForProject(ctx, projectId, 'add domain objects or workstreams suggested by Ember')

  const [{ data: existingObjects, error: objectsError }, { data: existingWorkstreams, error: workstreamsError }] = await Promise.all([
    ctx.supabase.from('project_objects').select('slug').eq('project_id', projectId),
    ctx.supabase.from('project_workstreams').select('slug').eq('project_id', projectId),
  ])
  if (objectsError) throw objectsError
  if (workstreamsError) throw workstreamsError

  const usedObjectSlugs = new Set((existingObjects ?? []).map((o) => o.slug))
  const usedWorkstreamSlugs = new Set((existingWorkstreams ?? []).map((w) => w.slug))

  function uniqueSlug(name: string, used: Set<string>): string {
    const base = slugify(name) || 'item'
    let slug = base
    let n = 2
    while (used.has(slug)) {
      slug = `${base}-${n}`
      n++
    }
    used.add(slug)
    return slug
  }

  const objectIdByTempId =
    input.objects.length > 0
      ? await insertStagedTree(ctx.supabase, 'project_objects', input.objects, (item, parentId) => ({
          project_id: projectId,
          parent_object_id: parentId,
          name: item.name,
          slug: uniqueSlug(item.name, usedObjectSlugs),
          description: item.description || null,
          created_by: ctx.user.id,
        }))
      : new Map<string, string>()

  const workstreamIdByTempId =
    input.workstreams.length > 0
      ? await insertStagedTree(ctx.supabase, 'project_workstreams', input.workstreams, (item, parentId) => ({
          project_id: projectId,
          parent_workstream_id: parentId,
          name: item.name,
          slug: uniqueSlug(item.name, usedWorkstreamSlugs),
          status: 'draft',
          repository_scope: [],
          goal: item.goal || null,
          deliverables: [],
          created_by: ctx.user.id,
        }))
      : new Map<string, string>()

  return { objectIds: [...objectIdByTempId.values()], workstreamIds: [...workstreamIdByTempId.values()] }
}
