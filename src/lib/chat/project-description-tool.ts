import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { updateProjectObjective } from '@/lib/workbench/projects'

// Ember-side counterpart to ProjectObjectiveForm's inline edit -- same
// interception pattern as send_project_note (not in src/lib/mcp/tools.ts's
// general registry), since the target project is resolvedProjectId, never
// model-supplied. updateProjectObjective re-checks the owner/curator/admin
// bar at call time, so a member without that role gets a clear refusal no
// matter what the model believes. The "propose, then wait for explicit
// confirmation" step is prompt-enforced only (buildProjectPromptAddendum in
// loop.ts), same trust boundary as send_project_note.

export const UPDATE_PROJECT_DESCRIPTION_TOOL_NAME = 'update_project_description'

const InputSchema = z.object({
  description: z.string().max(2000),
})

export const UPDATE_PROJECT_DESCRIPTION_TOOL: ToolSpec = {
  name: UPDATE_PROJECT_DESCRIPTION_TOOL_NAME,
  description:
    "Replace THIS project's short description (the plain-text line shown under the project title -- not its goal). Pass the full new text, not a diff; an empty string clears it. Requires the user to be the project's owner or curator (or a platform admin). Only call this after you have shown the user the exact new description and they have explicitly confirmed it in their own reply -- never in the same turn you proposed it.",
  parameters: z.toJSONSchema(InputSchema),
}

export async function runUpdateProjectDescription(
  ctx: WorkbenchCallerContext,
  projectId: string,
  rawInput: unknown
): Promise<{ description: string | null; route: string }> {
  const input = InputSchema.parse(rawInput)
  await updateProjectObjective(ctx, projectId, input.description)
  return { description: input.description.trim() || null, route: `/projects/${projectId}` }
}
