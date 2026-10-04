import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { aiHostingForProject } from '@/lib/ai'
import { suggestProjectOntology, applyProjectOntologySuggestion, type ProjectOntologySuggestion } from '@/lib/workbench/project-ontology-suggestions'

// Builder Ontology, Part A's own "Ask Ember to suggest" existed only as a
// one-shot wizard button during NEW project creation -- there was no way to
// reach it from ordinary chat for a project that already exists. Two tools,
// same interception pattern as list_workstreams/send_project_note (not in
// src/lib/mcp/tools.ts's general registry -- behavior depends on
// resolvedProjectId, never model-supplied): suggest_project_ontology reads
// only (nothing written until the user confirms), create_project_ontology
// writes. There's no code-level propose/confirm gate for this pair either
// (same trust boundary as send_project_note, see that file's own comment)
// -- the "wait for explicit confirmation" requirement is prompt guidance
// only, in both tools' own descriptions and buildProjectPromptAddendum.

export const SUGGEST_PROJECT_ONTOLOGY_TOOL_NAME = 'suggest_project_ontology'
export const CREATE_PROJECT_ONTOLOGY_TOOL_NAME = 'create_project_ontology'

const SuggestInputSchema = z.object({
  focusHint: z.string().max(500).optional(),
})

export const SUGGEST_PROJECT_ONTOLOGY_TOOL: ToolSpec = {
  name: SUGGEST_PROJECT_ONTOLOGY_TOOL_NAME,
  description:
    "Suggest a starting domain-object ontology (this business's own noun TYPES, e.g. Plane/Route for an airline -- not instances) and a starting set of workstreams for THIS project, based on its own objective/details. Automatically avoids repeating anything this project already has. This only suggests -- nothing is written yet. Present the suggested objects and workstreams to the user in your own words and wait for their explicit confirmation (they may also ask for changes) before calling create_project_ontology.",
  parameters: z.toJSONSchema(SuggestInputSchema),
}

const StagedObjectSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullish(),
  name: z.string(),
  description: z.string().optional(),
})
const StagedWorkstreamSchema = z.object({
  tempId: z.string(),
  parentTempId: z.string().nullish(),
  name: z.string(),
  goal: z.string().optional(),
})
const CreateInputSchema = z.object({
  objects: z.array(StagedObjectSchema).default([]),
  workstreams: z.array(StagedWorkstreamSchema).default([]),
})

export const CREATE_PROJECT_ONTOLOGY_TOOL: ToolSpec = {
  name: CREATE_PROJECT_ONTOLOGY_TOOL_NAME,
  description:
    'Create the domain objects and workstreams you just suggested via suggest_project_ontology -- or mapped from an ontology file the user attached or pasted -- exactly as the user confirmed -- apply any changes they asked for first, keeping each item\'s tempId and parentTempId links consistent (a parentTempId must match another item\'s own tempId in this same call, or be omitted for a top-level item). Only call this after the user has explicitly confirmed in their own reply -- never call it in the same turn you proposed the suggestion, and never invent objects/workstreams the user has not seen. Requires this project\'s own owner or curator role (or platform admin).',
  parameters: z.toJSONSchema(CreateInputSchema),
}

export async function runSuggestProjectOntology(
  ctx: WorkbenchCallerContext,
  projectId: string,
  rawInput: unknown
): Promise<ProjectOntologySuggestion & { existingObjectNames: string[]; existingWorkstreamNames: string[] }> {
  const input = SuggestInputSchema.parse(rawInput ?? {})

  const [{ data: project, error: projectError }, { data: existingObjects }, { data: existingWorkstreams }] = await Promise.all([
    ctx.supabase.from('projects').select('project_type, objective, details').eq('id', projectId).single(),
    ctx.supabase.from('project_objects').select('name').eq('project_id', projectId),
    ctx.supabase.from('project_workstreams').select('name').eq('project_id', projectId),
  ])
  if (projectError || !project) throw projectError ?? new Error('Project not found')

  const existingObjectNames = (existingObjects ?? []).map((o) => o.name)
  const existingWorkstreamNames = (existingWorkstreams ?? []).map((w) => w.name)

  const details: Record<string, string> = { ...(project.details as Record<string, string>) }
  if (existingObjectNames.length > 0) details.existing_domain_objects_do_not_repeat = existingObjectNames.join(', ')
  if (existingWorkstreamNames.length > 0) details.existing_workstreams_do_not_repeat = existingWorkstreamNames.join(', ')

  const objective = (project.objective ?? '') + (input.focusHint ? `\n\nFocus especially on: ${input.focusHint}` : '')

  const suggestion = await suggestProjectOntology(
    ctx,
    { projectType: project.project_type, objective, details },
    { selfHostedOnly: (await aiHostingForProject(projectId)) === 'self_hosted_only' }
  )
  return { ...suggestion, existingObjectNames, existingWorkstreamNames }
}

export async function runCreateProjectOntology(
  ctx: WorkbenchCallerContext,
  projectId: string,
  rawInput: unknown
): Promise<{ objectsCreated: number; workstreamsCreated: number; workstreamIds: string[]; ontologyMapUrl: string }> {
  const input = CreateInputSchema.parse(rawInput)
  if (input.objects.length === 0 && input.workstreams.length === 0) {
    throw new Error('Nothing to create -- both objects and workstreams were empty. Call suggest_project_ontology first if you have not already.')
  }

  const result = await applyProjectOntologySuggestion(ctx, projectId, {
    objects: input.objects.map((o) => ({ tempId: o.tempId, parentTempId: o.parentTempId ?? null, name: o.name, description: o.description ?? '' })),
    workstreams: input.workstreams.map((w) => ({ tempId: w.tempId, parentTempId: w.parentTempId ?? null, name: w.name, goal: w.goal ?? '' })),
  })

  return {
    objectsCreated: result.objectIds.length,
    workstreamsCreated: result.workstreamIds.length,
    workstreamIds: result.workstreamIds,
    ontologyMapUrl: `/projects/${projectId}#ontology-map`,
  }
}
