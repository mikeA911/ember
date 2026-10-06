import 'server-only'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { resolveNavigationTarget } from './navigation-resolver'
import { resolveDocumentArtifact } from './document-resolver'

// working_knowledge is deliberately named to match NavigationTargetKind's own
// 'working_knowledge' member exactly (response-envelope.ts) -- resolveCreatedRecord's
// generic path below calls resolveNavigationTarget(ctx, { kind: ref.kind, id: ref.id }),
// which only type-checks if the two enums share the literal value.
export type CreatedRecordKind = 'project' | 'workstream' | 'workstream_artifact' | 'project_note' | 'working_knowledge' | 'solution_requirement'

export interface CreatedRecordRef {
  kind: CreatedRecordKind
  id: string
}

export interface ResolvedCreatedRecord extends CreatedRecordRef {
  label: string
}

// Resolves a create_project/create_workstream/attach_workstream_artifact
// tool result into a labelled reference for the Artifacts panel's "Created
// records" group -- reuses the same resolvers as navigation links/documents
// (RLS via ctx.supabase is the access check), so a record that's since
// become inaccessible drops out the same way. Never throws.
export async function resolveCreatedRecord(ctx: WorkbenchCallerContext, ref: CreatedRecordRef): Promise<ResolvedCreatedRecord | null> {
  if (ref.kind === 'workstream_artifact') {
    const resolved = await resolveDocumentArtifact(ctx, ref.id)
    return resolved ? { ...ref, label: resolved.title } : null
  }
  const resolved = await resolveNavigationTarget(ctx, { kind: ref.kind, id: ref.id })
  return resolved ? { ...ref, label: resolved.label } : null
}

// Pulls created-record references out of a persisted tool-result row's JSON
// content, matching the exact output shapes those tools return
// (src/lib/mcp/tools.ts, plus create_project_ontology in
// src/lib/chat/project-ontology-tool.ts). Used when replaying history,
// where the live turn's in-memory tool output isn't available -- only what
// was persisted. Returns an array (possibly empty), not a single-or-null
// ref, since create_project_ontology can create several workstreams in one
// call -- every other tool here just returns a one-element array.
export function extractCreatedRecordRef(toolName: string, content: string): CreatedRecordRef[] {
  try {
    const parsed: unknown = JSON.parse(content)
    if (!parsed || typeof parsed !== 'object') return []
    const obj = parsed as Record<string, unknown>
    if (toolName === 'create_project' && typeof obj.projectId === 'string') return [{ kind: 'project', id: obj.projectId }]
    if (toolName === 'create_workstream' && typeof obj.workstreamId === 'string') return [{ kind: 'workstream', id: obj.workstreamId }]
    if (toolName === 'attach_workstream_artifact' && obj.attached === true && typeof obj.artifactId === 'string') {
      return [{ kind: 'workstream_artifact', id: obj.artifactId }]
    }
    if (toolName === 'send_project_note' && typeof obj.noteId === 'string') return [{ kind: 'project_note', id: obj.noteId }]
    if (toolName === 'save_working_knowledge' && typeof obj.itemId === 'string') return [{ kind: 'working_knowledge', id: obj.itemId }]
    if (toolName === 'create_draft_requirements' && Array.isArray(obj.created)) {
      return obj.created
        .map((c) => (c && typeof c === 'object' ? (c as Record<string, unknown>).requirementId : null))
        .filter((id): id is string => typeof id === 'string')
        .map((id) => ({ kind: 'solution_requirement', id }))
    }
    if (toolName === 'create_project_ontology' && Array.isArray(obj.workstreamIds)) {
      return obj.workstreamIds.filter((id): id is string => typeof id === 'string').map((id) => ({ kind: 'workstream', id }))
    }
  } catch {
    // Malformed/error JSON (e.g. a tool refusal or error result) -- not a
    // created record.
  }
  return []
}
