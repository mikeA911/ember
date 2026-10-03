import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import { reviewArtifact, createWorkstream } from './workstreams'

function ctx(supabase: unknown) {
  return { user: { id: 'user-1' }, profile: { role: 'curator' }, supabase } as never
}

function ctxWithProfile(supabase: unknown, profileRole: string) {
  return { user: { id: 'user-1' }, profile: { role: profileRole }, supabase } as never
}

const baseWorkstreamInput = {
  projectId: 'project-1',
  name: 'MCP Architecture',
  slug: 'mcp-architecture',
  repositoryScope: [],
  deliverables: [],
}

describe('reviewArtifact', () => {
  it('updates status/reviewer fields when the caller is authorized (RLS returns the updated row)', async () => {
    const fakeSupabase = createFakeSupabase({
      workstream_artifacts: [{ data: [{ id: 'artifact-1', workstream_id: 'ws-1' }], error: null }],
    })

    const result = await reviewArtifact(ctx(fakeSupabase), 'artifact-1', 'approved', 'Looks complete')

    expect(result).toEqual({ artifactId: 'artifact-1', workstreamId: 'ws-1', status: 'approved' })
    const update = fakeSupabase._calls.find((c) => c.table === 'workstream_artifacts' && c.method === 'update')
    expect(update?.args).toMatchObject({ status: 'approved', validation_notes: 'Looks complete', reviewed_by: 'user-1' })
  })

  // RLS (workstream_artifacts_update_review_curator, can_curate_project) is
  // the real gate -- a caller who isn't the Project's owner/curator/admin
  // updates zero rows without an error, matching toggleDeliverable/
  // updateWorkstreamSummary's existing zero-rows-throws convention above in
  // this same file.
  it('throws when the caller is not authorized to review (zero rows updated)', async () => {
    const fakeSupabase = createFakeSupabase({
      workstream_artifacts: [{ data: [], error: null }],
    })

    await expect(reviewArtifact(ctx(fakeSupabase), 'artifact-1', 'rejected')).rejects.toThrow(
      'You do not have permission to review this artifact'
    )
  })

  it('stores null validation_notes when no review notes are given', async () => {
    const fakeSupabase = createFakeSupabase({
      workstream_artifacts: [{ data: [{ id: 'artifact-1', workstream_id: 'ws-1' }], error: null }],
    })

    await reviewArtifact(ctx(fakeSupabase), 'artifact-1', 'approved')

    const update = fakeSupabase._calls.find((c) => c.table === 'workstream_artifacts' && c.method === 'update')
    expect(update?.args).toMatchObject({ validation_notes: null })
  })
})

// OL-002 (2026-08-31 builder-journey report): a consultant-role project
// member offered this action by Ember got only a raw RLS policy-violation
// error. This preflight check gives a clear, specific message instead --
// RLS (project_workstreams_manage_curator) stays the real enforcement.
describe('createWorkstream -- permission preflight (OL-002 fix)', () => {
  it('rejects a caller with no active membership on the project, before attempting the insert', async () => {
    const fakeSupabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })

    await expect(createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)).rejects.toThrow(
      "Creating a workstream needs this project's owner or curator role"
    )
    const insert = fakeSupabase._calls.find((c) => c.table === 'project_workstreams' && c.method === 'insert')
    expect(insert).toBeUndefined()
  })

  it('rejects a caller whose project role is consultant, naming their actual role in the message', async () => {
    const fakeSupabase = createFakeSupabase({ project_members: [{ data: { role: 'consultant' }, error: null }] })

    await expect(createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)).rejects.toThrow(
      "you're currently a consultant on this project"
    )
  })

  it('allows a project curator through to the insert', async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }],
      project_workstreams: [{ data: { id: 'ws-1' }, error: null }],
    })

    const result = await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)
    expect(result).toEqual({ workstreamId: 'ws-1', projectId: 'project-1' })
  })

  it('skips the project-membership lookup entirely for a platform admin', async () => {
    const fakeSupabase = createFakeSupabase({
      project_workstreams: [{ data: { id: 'ws-1' }, error: null }],
    })

    const result = await createWorkstream(ctxWithProfile(fakeSupabase, 'admin'), baseWorkstreamInput)
    expect(result).toEqual({ workstreamId: 'ws-1', projectId: 'project-1' })
    expect(fakeSupabase._calls.find((c) => c.table === 'project_members')).toBeUndefined()
  })
})

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md): nesting +
// lifecycle/duration fields, all optional, defaulting to the same values
// createWorkstream already used before this pass.
describe('createWorkstream -- Builder Ontology fields (Part A)', () => {
  it('passes parent_workstream_id/lifecycle_stage/operational_status/durations through to the insert', async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      // First queued result is the cycle pre-check's own walk (assertNoWorkstreamCycle);
      // a null parent_workstream_id ends the walk immediately (no cycle). The
      // second is the actual insert.
      project_workstreams: [
        { data: null, error: null },
        { data: { id: 'ws-2' }, error: null },
      ],
    })

    await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), {
      ...baseWorkstreamInput,
      parentWorkstreamId: 'ws-parent-1',
      lifecycleStage: 'deployment',
      operationalStatus: 'open',
      plannedDuration: '1 week',
      actualDuration: null,
    })

    const insert = fakeSupabase._calls.find((c) => c.table === 'project_workstreams' && c.method === 'insert')
    expect(insert?.args).toMatchObject({
      parent_workstream_id: 'ws-parent-1',
      lifecycle_stage: 'deployment',
      operational_status: 'open',
      planned_duration: '1 week',
      actual_duration: null,
    })
  })

  it('defaults to no parent, no lifecycle stage, and operational_status open when omitted', async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_workstreams: [{ data: { id: 'ws-3' }, error: null }],
    })

    await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)

    const insert = fakeSupabase._calls.find((c) => c.table === 'project_workstreams' && c.method === 'insert')
    expect(insert?.args).toMatchObject({
      parent_workstream_id: null,
      lifecycle_stage: null,
      operational_status: 'open',
    })
  })
})

describe('createWorkstream -- project knowledge bases', () => {
  it("attaches every one of the project's knowledge bases to the new workstream", async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_workstreams: [{ data: { id: 'ws-4' }, error: null }],
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'kb-1' }, { knowledge_base_id: 'kb-2' }], error: null }],
      workstream_knowledge_bases: [{ data: null, error: null }],
    })

    await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)

    const insert = fakeSupabase._calls.find((c) => c.table === 'workstream_knowledge_bases' && c.method === 'insert')
    expect(insert?.args).toEqual([
      { workstream_id: 'ws-4', knowledge_base_id: 'kb-1', attached_by: 'user-1' },
      { workstream_id: 'ws-4', knowledge_base_id: 'kb-2', attached_by: 'user-1' },
    ])
  })

  it('skips the attach when the project has no knowledge bases', async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_workstreams: [{ data: { id: 'ws-5' }, error: null }],
      project_knowledge_bases: [{ data: [], error: null }],
    })

    await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)

    expect(fakeSupabase._calls.find((c) => c.table === 'workstream_knowledge_bases')).toBeUndefined()
  })

  it('still reports the workstream as created when the attach fails', async () => {
    const fakeSupabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_workstreams: [{ data: { id: 'ws-6' }, error: null }],
      project_knowledge_bases: [{ data: [{ knowledge_base_id: 'kb-1' }], error: null }],
      workstream_knowledge_bases: [{ data: null, error: new Error('rls') }],
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await createWorkstream(ctxWithProfile(fakeSupabase, 'consultant'), baseWorkstreamInput)
    expect(result).toEqual({ workstreamId: 'ws-6', projectId: 'project-1' })
    consoleError.mockRestore()
  })
})
