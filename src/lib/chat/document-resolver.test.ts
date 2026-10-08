import { describe, it, expect } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import { resolveDocumentArtifact } from './document-resolver'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

function fakeCtx(supabase: unknown): WorkbenchCallerContext {
  return { user: { id: 'user-1' }, profile: {}, supabase } as unknown as WorkbenchCallerContext
}

describe('resolveDocumentArtifact', () => {
  it('resolves a real artifact to its title/type and the parent workstream route', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'art-1', workstream_id: 'w1', artifact_type: 'design_note', title: 'OpenAPI Discovery Plan' }, error: null }],
      project_workstreams: [{ data: { id: 'w1', project_id: 'p1' }, error: null }],
    })

    const result = await resolveDocumentArtifact(fakeCtx(supabase), 'art-1')

    expect(result).toEqual({
      title: 'OpenAPI Discovery Plan',
      artifactType: 'design_note',
      route: '/projects/p1/workstreams/w1#art-1',
      workstreamId: 'w1',
      projectId: 'p1',
    })
  })

  it('returns null when the artifact does not exist or is not accessible', async () => {
    const supabase = createFakeSupabase({ workstream_artifacts: [{ data: null, error: null }] })
    const result = await resolveDocumentArtifact(fakeCtx(supabase), 'missing')
    expect(result).toBeNull()
  })

  it('returns null for an orphaned artifact whose parent workstream cannot be resolved', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'art-1', workstream_id: 'w-gone', artifact_type: 'design_note', title: 'Orphan' }, error: null }],
      project_workstreams: [{ data: null, error: null }],
    })
    const result = await resolveDocumentArtifact(fakeCtx(supabase), 'art-1')
    expect(result).toBeNull()
  })
})
