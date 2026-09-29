import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { ChatMessageRow } from '@/types/database'
import { getActiveProjectRole } from '@/lib/workbench/context'
import { insertStagedTree } from '@/lib/workbench/projects'
import { requireCuratorForProject } from '@/lib/workbench/project-ontology-suggestions'
import { listMessages } from './conversations'
import { extractAttachmentsFromMessage, type ChatAttachment } from './attachments'
import { planTurtleOntologyImport, outlineOntologyPlan, OntologyImportError, type OntologyImportItem } from '@/lib/ontology/turtle-import'

// Import an ontology file the user attached in Ember chat onto this
// project's Ontology Map (project_objects). The tree is built by a real
// Turtle parser (src/lib/ontology/turtle-import.ts), never by the chat
// model: a small model asked to re-emit a 70-class tree as tool arguments
// summarized, dropped, or skipped it (observed live, 2026-09-29).
//
// Two tools, same interception pattern as suggest/create_project_ontology
// (they need resolvedProjectId and the conversation id). Unlike that pair,
// the confirmation step is enforced in code: import_ontology_file refuses
// unless preview_ontology_file_import ran for the same file in an EARLIER
// turn -- i.e. the user has sent a message since seeing the preview.
//
// The file is read back from the conversation's own persisted user
// messages (the Attach button's "Attached file:" block), so the model only
// passes a file name, and a truncated attachment is refused rather than
// imported partially. Classes whose name already exists on the map are
// skipped (their new children attach to the existing object), so importing
// a revised file adds what's new instead of duplicating everything.

export const PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME = 'preview_ontology_file_import'
export const IMPORT_ONTOLOGY_FILE_TOOL_NAME = 'import_ontology_file'

const TURTLE_EXTENSIONS = ['ttl', 'n3', 'nt']

const PreviewInputSchema = z.object({ fileName: z.string().optional() })
const ImportInputSchema = z.object({ fileName: z.string() })

export const PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL: ToolSpec = {
  name: PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME,
  description:
    "Read an ontology file the user attached in this conversation (Turtle: .ttl/.n3/.nt) and preview what importing it onto THIS project's Ontology Map would create: counts, an outline of the object tree, what's already on the map, and what's left out. Nothing is written. Pass fileName (the name after 'Attached file:'); omit it to use the most recently attached Turtle file. Present the result in your own words and wait for the user's explicit confirmation in their next message before calling import_ontology_file.",
  parameters: z.toJSONSchema(PreviewInputSchema),
}

export const IMPORT_ONTOLOGY_FILE_TOOL: ToolSpec = {
  name: IMPORT_ONTOLOGY_FILE_TOOL_NAME,
  description:
    "Import the attached ontology file you previewed with preview_ontology_file_import onto this project's Ontology Map, exactly as previewed. Only after the user has explicitly confirmed in a message after the preview -- it is refused in the same turn as the preview. Requires this project's owner or curator role (or platform admin).",
  parameters: z.toJSONSchema(ImportInputSchema),
}

function extensionOf(name: string): string {
  return name.toLowerCase().split('.').pop() ?? ''
}

const baseName = (name: string) => name.split('/').pop()!.toLowerCase()

// Newest first, so a re-attached revision of the same file wins. A zip's
// files carry their path inside it ("files/onto.ttl"), so a bare name
// matches too. Without a name, the newest Turtle file that actually defines
// classes -- a zip usually pairs the ontology with a shapes file.
function findAttachedTurtleFile(rows: Pick<ChatMessageRow, 'role' | 'content'>[], fileName?: string): ChatAttachment {
  const attachments = rows
    .filter((r) => r.role === 'user' && r.content)
    .flatMap((r) => extractAttachmentsFromMessage(r.content!))
    .reverse()
  const wanted = fileName?.trim().toLowerCase()
  let match: ChatAttachment | undefined
  if (wanted) {
    match = attachments.find((a) => a.name.toLowerCase() === wanted) ?? attachments.find((a) => baseName(a.name) === baseName(wanted))
  } else {
    const turtle = attachments.filter((a) => TURTLE_EXTENSIONS.includes(extensionOf(a.name)))
    match =
      turtle.find((a) => {
        try {
          return !a.truncated && planTurtleOntologyImport(a.text).classCount > 0
        } catch {
          return false
        }
      }) ?? turtle[0]
  }
  if (!match) {
    throw new OntologyImportError(
      wanted
        ? `No file named "${fileName}" is attached in this conversation. Ask the user to attach it with the Attach button.`
        : 'No Turtle (.ttl) file is attached in this conversation. Ask the user to attach it with the Attach button.'
    )
  }
  if (!TURTLE_EXTENSIONS.includes(extensionOf(match.name))) {
    throw new OntologyImportError(
      `${match.name} isn't a Turtle file -- only .ttl/.n3/.nt can be imported automatically. For other formats, map the classes yourself and use create_project_ontology.`
    )
  }
  if (match.truncated) {
    throw new OntologyImportError(
      `${match.name} was too large to attach in full, so only its first part is in this conversation. Importing part of an ontology would leave the map incomplete -- ask the user to split the file and attach each part.`
    )
  }
  return match
}

async function loadExistingObjects(ctx: WorkbenchCallerContext, projectId: string) {
  const { data, error } = await ctx.supabase.from('project_objects').select('id, name, slug').eq('project_id', projectId)
  if (error) throw error
  return data ?? []
}

const nameKey = (name: string) => name.trim().toLowerCase()

export interface OntologyFilePreview {
  fileName: string
  classes: number
  sectionGroups: number
  objectsToCreate: number
  alreadyOnMap: string[]
  leftOut: { properties: number; shapes: number }
  outline: string
  canImport: boolean
  note: string
}

export async function runPreviewOntologyFileImport(
  ctx: WorkbenchCallerContext,
  projectId: string,
  conversationId: string,
  rawInput: unknown
): Promise<OntologyFilePreview> {
  const input = PreviewInputSchema.parse(rawInput ?? {})
  const file = findAttachedTurtleFile(await listMessages(ctx.supabase, conversationId), input.fileName)
  const plan = planTurtleOntologyImport(file.text)
  const existing = new Set((await loadExistingObjects(ctx, projectId)).map((o) => nameKey(o.name)))
  const alreadyOnMap = plan.items.filter((i) => existing.has(nameKey(i.name))).map((i) => i.name)

  const role = ctx.profile.role === 'admin' ? 'admin' : await getActiveProjectRole(ctx, projectId)
  const canImport = role === 'admin' || role === 'owner' || role === 'curator'

  return {
    fileName: file.name,
    classes: plan.classCount,
    sectionGroups: plan.groupCount,
    objectsToCreate: plan.items.length - alreadyOnMap.length,
    alreadyOnMap: alreadyOnMap.slice(0, 30),
    leftOut: { properties: plan.propertyCount, shapes: plan.shapeCount },
    outline: outlineOntologyPlan(plan.items),
    canImport,
    note:
      'Individuals (e.g. roles, states) are listed as "Values" in their class description, not created as objects. Properties and axioms are not imported -- the map has no place for them. ' +
      (canImport ? '' : "This user is not this project's owner or curator, so they cannot run the import themselves."),
  }
}

// The preview must be a tool result from before the user's latest message.
function previewedInEarlierTurn(rows: ChatMessageRow[], fileName: string): boolean {
  let lastUserIndex = -1
  rows.forEach((r, i) => {
    if (r.role === 'user') lastUserIndex = i
  })
  return rows.slice(0, Math.max(lastUserIndex, 0)).some((r) => {
    if (r.role !== 'tool' || r.tool_name !== PREVIEW_ONTOLOGY_FILE_IMPORT_TOOL_NAME || !r.content) return false
    try {
      const output = JSON.parse(r.content) as { fileName?: string }
      return nameKey(output.fileName ?? '') === nameKey(fileName)
    } catch {
      return false
    }
  })
}

export async function runImportOntologyFile(
  ctx: WorkbenchCallerContext,
  projectId: string,
  conversationId: string,
  rawInput: unknown
): Promise<{ objectsCreated: number; skippedAlreadyOnMap: number; ontologyMapUrl: string }> {
  const input = ImportInputSchema.parse(rawInput)
  await requireCuratorForProject(ctx, projectId, 'import an ontology onto this project')

  const rows = await listMessages(ctx.supabase, conversationId)
  const file = findAttachedTurtleFile(rows, input.fileName)
  if (!previewedInEarlierTurn(rows, file.name)) {
    throw new OntologyImportError(
      `Not imported: call preview_ontology_file_import for ${file.name} first, show the user the result, and only import after they confirm in their next message.`
    )
  }

  const plan = planTurtleOntologyImport(file.text)
  const existing = await loadExistingObjects(ctx, projectId)
  const existingIdByName = new Map(existing.map((o) => [nameKey(o.name), o.id]))
  const usedSlugs = new Set(existing.map((o) => o.slug))

  // Already-on-map items are skipped; an item whose parent is one of them
  // hangs off that existing object instead.
  const skippedTempIds = new Map<string, string>()
  for (const item of plan.items) {
    const existingId = existingIdByName.get(nameKey(item.name))
    if (existingId) skippedTempIds.set(item.tempId, existingId)
  }
  const toCreate = plan.items
    .filter((i) => !skippedTempIds.has(i.tempId))
    .map((i) => {
      const existingParentId = i.parentTempId ? skippedTempIds.get(i.parentTempId) : undefined
      return { ...i, parentTempId: existingParentId ? null : i.parentTempId, existingParentId: existingParentId ?? null }
    })

  if (toCreate.length > 0) {
    await insertStagedTree(ctx.supabase, 'project_objects', toCreate, (item: OntologyImportItem & { existingParentId: string | null }, resolvedParentId) => ({
      project_id: projectId,
      parent_object_id: item.existingParentId ?? resolvedParentId,
      name: item.name,
      slug: uniqueSlug(item.name, usedSlugs),
      description: item.description || null,
      created_by: ctx.user.id,
    }))
  }

  return { objectsCreated: toCreate.length, skippedAlreadyOnMap: skippedTempIds.size, ontologyMapUrl: `/projects/${projectId}#ontology-map` }
}

function uniqueSlug(name: string, used: Set<string>): string {
  const base =
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '') || 'item'
  let slug = base
  for (let n = 2; used.has(slug); n++) slug = `${base}-${n}`
  used.add(slug)
  return slug
}
