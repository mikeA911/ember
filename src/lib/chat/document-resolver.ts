import 'server-only'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

export interface ResolvedDocumentArtifact {
  title: string
  artifactType: string
  // No dedicated single-artifact route exists in this app -- route points
  // at the parent workstream page (which lists the artifact inline), with
  // the artifact's id as the fragment: its <details id> there, which
  // WorkstreamArtifactList opens and scrolls to. null only if the parent
  // workstream itself can't be resolved (an orphaned/inaccessible artifact
  // row).
  route: string | null
  workstreamId: string
  projectId: string
}

// Enriches a model-proposed workstream_artifacts.id into a real, authorized
// record. Only ever used for documents[] enrichment (attach_workstream_artifact
// is the only tool that creates one, and it always requires a real
// workstreamId, so an "artifact" can never exist without a parent
// workstream). RLS via ctx.supabase is the access check. Returns null for
// anything missing/inaccessible -- never throws.
export async function resolveDocumentArtifact(ctx: WorkbenchCallerContext, artifactId: string): Promise<ResolvedDocumentArtifact | null> {
  try {
    const { data: artifact } = await ctx.supabase
      .from('workstream_artifacts')
      .select('id, workstream_id, artifact_type, title')
      .eq('id', artifactId)
      .maybeSingle()
    if (!artifact) return null

    const { data: workstream } = await ctx.supabase
      .from('project_workstreams')
      .select('id, project_id')
      .eq('id', artifact.workstream_id)
      .maybeSingle()
    if (!workstream) return null

    return {
      title: artifact.title,
      artifactType: artifact.artifact_type,
      route: `/projects/${workstream.project_id}/workstreams/${workstream.id}#${artifact.id}`,
      workstreamId: workstream.id,
      projectId: workstream.project_id,
    }
  } catch {
    return null
  }
}
