import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

vi.mock('@/lib/knowledge-bases', () => ({ requireActiveKnowledgeBase: vi.fn() }))
const productModeMock = vi.fn().mockReturnValue('enterprise')
vi.mock('@/lib/env', () => ({ env: { productMode: () => productModeMock() } }))
const createUserMock = vi.fn().mockResolvedValue({ data: { user: { id: 'new-user-1' } }, error: null })
const adminInsertMock = vi.fn().mockResolvedValue({ data: null, error: null })
const adminUpdateMock = vi.fn()
const adminUpdateEqMock = vi.fn().mockResolvedValue({ error: null })
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    auth: { admin: { createUser: (...args: unknown[]) => createUserMock(...args) } },
    from: () => ({
      select: () => ({
        in: async () => ({ data: [{ id: 'user-2', email: 'teammate@example.com' }], error: null }),
        // enrollInOrganizationHome's is_organization_home lookup -- no org
        // home project seeded in these tests, so it's always a safe no-op
        // (matches "no project currently flagged as the org home" in its
        // own doc comment).
        eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
      }),
      // createProject's best-effort project_status_history log (see
      // logStatusChange in ./projects) also goes through this admin
      // client -- a no-op insert here keeps that logging silent in tests
      // that don't care about it, rather than a swallowed-but-noisy error.
      insert: (...args: unknown[]) => adminInsertMock(...args),
      update: (...args: unknown[]) => {
        adminUpdateMock(...args)
        return { eq: (...eqArgs: unknown[]) => adminUpdateEqMock(...eqArgs) }
      },
    }),
  }),
}))

const { createProject, detachKnowledgeBase, searchProjects, createAndAddProjectMember, updateProjectStarterPrompt, updateProjectObjective } = await import('./projects')

function ctxWith(supabase: unknown) {
  return { user: { id: 'user-1', email: 'owner@example.com' }, profile: { role: 'consultant' }, supabase } as never
}

describe('createProject -- Governance & Approvals staging (Stage 1)', () => {
  it('inserts a policy row and no assignment row for an unassigned "Authority needed" approval', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_approval_policies: [{ data: null, error: null }],
    })

    await createProject(ctxWith(supabase), {
      name: 'Client Engagement',
      projectType: 'consulting',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [],
      approvals: [{ approvalType: 'commercial', requirementStatus: 'required', assigneeEmail: null }],
    })

    const policyInsert = supabase._calls.find((c) => c.table === 'project_approval_policies' && c.method === 'insert')
    expect(policyInsert?.args).toEqual([expect.objectContaining({ approval_type: 'commercial', requirement_status: 'required' })])
    const assignmentInsert = supabase._calls.find((c) => c.table === 'project_authority_assignments')
    expect(assignmentInsert).toBeUndefined()
  })

  it("resolves the '__self__' sentinel to the creator's own user id", async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_approval_policies: [{ data: null, error: null }],
      project_authority_assignments: [{ data: null, error: null }],
    })

    await createProject(ctxWith(supabase), {
      name: 'Client Engagement',
      projectType: 'consulting',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [],
      approvals: [{ approvalType: 'technical', requirementStatus: 'required', assigneeEmail: '__self__' }],
    })

    const assignmentInsert = supabase._calls.find((c) => c.table === 'project_authority_assignments' && c.method === 'insert')
    expect((assignmentInsert?.args as { user_id: string }[])[0].user_id).toBe('user-1')
  })

  it('resolves a staged member email to their user id for the authority assignment', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_approval_policies: [{ data: null, error: null }],
      project_authority_assignments: [{ data: null, error: null }],
    })

    await createProject(ctxWith(supabase), {
      name: 'Client Engagement',
      projectType: 'consulting',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [{ email: 'teammate@example.com', role: 'consultant' }],
      approvals: [{ approvalType: 'proposal_release', requirementStatus: 'required', assigneeEmail: 'teammate@example.com' }],
    })

    const assignmentInsert = supabase._calls.find((c) => c.table === 'project_authority_assignments' && c.method === 'insert')
    expect((assignmentInsert?.args as { user_id: string }[])[0].user_id).toBe('user-2')
  })
})

// KB Sandbox Builder: a builder (consultant role) gets exactly one
// Project (see provisionBuilderProject in this same file) -- new clients
// are Workstreams on it, not new Projects.
describe('createProject -- KB Sandbox Builder one-project limit', () => {
  beforeEach(() => {
    productModeMock.mockReturnValue('enterprise')
  })

  const input = {
    name: 'Another Project',
    projectType: 'consulting' as const,
    objective: '',
    details: {},
    knowledgeBaseId: null,
    evalDatasetId: null,
    members: [],
  }

  it('rejects a second Project for a consultant (builder) who already owns one, in builder mode', async () => {
    productModeMock.mockReturnValue('builder')
    const supabase = createFakeSupabase({ projects: [{ data: { id: 'existing-project-1' }, error: null }] })

    await expect(createProject(ctxWith(supabase), input)).rejects.toThrow('Builders work from one Project')
  })

  it('allows a consultant\'s first Project in builder mode', async () => {
    productModeMock.mockReturnValue('builder')
    const supabase = createFakeSupabase({
      projects: [
        { data: null, error: null }, // no existing owned project
        { data: { id: 'new-project-1' }, error: null }, // the actual insert
      ],
    })

    await expect(createProject(ctxWith(supabase), input)).resolves.toBeDefined()
  })

  it('never applies the one-project limit outside builder mode, even with an existing Project', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: { id: 'new-project-1' }, error: null }] })
    await expect(createProject(ctxWith(supabase), input)).resolves.toBeDefined()
  })

  it('never applies the one-project limit to curator/admin, even in builder mode', async () => {
    productModeMock.mockReturnValue('builder')
    const supabase = createFakeSupabase({ projects: [{ data: { id: 'new-project-1' }, error: null }] })
    const curatorCtx = { user: { id: 'user-1', email: 'owner@example.com' }, profile: { role: 'curator' }, supabase } as never

    await expect(createProject(curatorCtx, input)).resolves.toBeDefined()
  })
})

// docs/dev-request-ember-onboarding-capability-gaps.md, item 1 -- backs the
// Ember search_projects tool.
describe('searchProjects', () => {
  it('returns an empty array without querying for a too-short query', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: [{ id: 'x', name: 'Should not be reached' }], error: null }] })
    const result = await searchProjects(ctxWith(supabase), 'a')
    expect(result).toEqual([])
  })

  it('maps matching rows to the tool-facing shape, using the caller\'s own RLS-scoped client', async () => {
    const supabase = createFakeSupabase({
      projects: [
        {
          data: [{ id: 'proj-1', name: 'Sandz–Zadara Pilot', project_type: 'consulting', status: 'draft', objective: 'Pilot proposals' }],
          error: null,
        },
      ],
    })

    const result = await searchProjects(ctxWith(supabase), 'Sandz')

    expect(result).toEqual([
      { id: 'proj-1', name: 'Sandz–Zadara Pilot', projectType: 'consulting', status: 'draft', objective: 'Pilot proposals' },
    ])
  })
})

describe('detachKnowledgeBase -- Project-Aware Knowledge and Assistant Context (Stage 1)', () => {
  it('removes only this project\'s link row, not the knowledge base itself', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    await detachKnowledgeBase(ctxWith(supabase), 'project-1', 'kb-1')

    const del = supabase._calls.find((c) => c.table === 'project_knowledge_bases' && c.method === 'delete')
    expect(del).toBeDefined()
  })
})

// Collapses "create the account on /admin, then go add them to the
// project" into one action -- addProjectMember's own "No account found"
// error was the real remaining Phase-5 onboarding gap for the Sandz pilot.
// A platform admin can do this for anyone; a project owner/curator can also
// do it for their own project (2026-09-03 -- the curator is the department
// head who knows their own staff), capped to platformRole member/consultant.
describe('createAndAddProjectMember', () => {
  beforeEach(() => {
    createUserMock.mockClear()
    adminInsertMock.mockClear()
  })

  function adminCtxWith(supabase: unknown) {
    return { user: { id: 'admin-1', email: 'admin@example.com' }, profile: { role: 'admin' }, supabase } as never
  }

  it('rejects a non-admin caller with no membership on the project before creating anything', async () => {
    const supabase = createFakeSupabase({})
    await expect(
      createAndAddProjectMember(ctxWith(supabase), {
        projectId: 'project-1',
        email: 'new-hire@sandz.example',
        password: 'a-real-password',
        projectRole: 'consultant',
        platformRole: 'member',
      })
    ).rejects.toThrow('Requires admin role, or an active owner/curator membership on this project')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller whose project role is consultant, not owner/curator', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'consultant' }, error: null }] })
    await expect(
      createAndAddProjectMember(ctxWith(supabase), {
        projectId: 'project-1',
        email: 'new-hire@sandz.example',
        password: 'a-real-password',
        projectRole: 'consultant',
        platformRole: 'member',
      })
    ).rejects.toThrow('Requires admin role, or an active owner/curator membership on this project')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('allows an active project curator to create and add a new member capped to platformRole member/consultant', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }, { data: null, error: null }],
    })

    await createAndAddProjectMember(ctxWith(supabase), {
      projectId: 'project-1',
      email: 'new-hire@sandz.example',
      password: 'a-real-password',
      projectRole: 'consultant',
      platformRole: 'consultant',
    })

    expect(createUserMock).toHaveBeenCalledWith(expect.objectContaining({ email: 'new-hire@sandz.example' }))
  })

  it('rejects a project curator (non-admin) trying to grant a curator or admin platform role', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'curator' }, error: null }] })
    await expect(
      createAndAddProjectMember(ctxWith(supabase), {
        projectId: 'project-1',
        email: 'new-hire@sandz.example',
        password: 'a-real-password',
        projectRole: 'consultant',
        platformRole: 'curator',
      })
    ).rejects.toThrow('Only a platform admin can create a curator or admin account')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('rejects a password under 8 characters before creating anything', async () => {
    const supabase = createFakeSupabase({})
    await expect(
      createAndAddProjectMember(adminCtxWith(supabase), {
        projectId: 'project-1',
        email: 'new-hire@sandz.example',
        password: 'short',
        projectRole: 'consultant',
        platformRole: 'member',
      })
    ).rejects.toThrow('Password must be at least 8 characters')
    expect(createUserMock).not.toHaveBeenCalled()
  })

  it('creates the auth user, the profile with the requested platform role, and the project membership', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })

    await createAndAddProjectMember(adminCtxWith(supabase), {
      projectId: 'project-1',
      email: 'new-hire@sandz.example',
      password: 'a-real-password',
      projectRole: 'curator',
      platformRole: 'member',
    })

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'new-hire@sandz.example', password: 'a-real-password', email_confirm: true })
    )
    expect(adminInsertMock).toHaveBeenCalledWith(expect.objectContaining({ id: 'new-user-1', email: 'new-hire@sandz.example', role: 'member' }))
    const memberInsert = supabase._calls.find((c) => c.table === 'project_members' && c.method === 'insert')
    expect(memberInsert?.args).toEqual({ project_id: 'project-1', user_id: 'new-user-1', role: 'curator', status: 'active' })
  })
})

// Builder Ontology, Part A (docs/kbs-ontology-dev-req-3.md): staged
// project_objects/project_workstreams trees reference each other by
// client-generated tempId, not a real DB id -- insertStagedTree resolves
// them level by level (parents before children).
describe('createProject -- Builder Ontology staged trees (insertStagedTree)', () => {
  beforeEach(() => {
    productModeMock.mockReturnValue('enterprise')
  })

  it('inserts project_objects parent-before-child, resolving a child parent_object_id to the parent\'s real returned id, not its tempId', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_objects: [
        { data: [{ id: 'obj-real-1' }], error: null }, // level 1: the root
        { data: [{ id: 'obj-real-2' }], error: null }, // level 2: the child
      ],
    })

    await createProject(ctxWith(supabase), {
      name: 'Riverbank Monitoring',
      projectType: 'consulting',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [],
      projectObjects: [
        { tempId: 'o1', parentTempId: null, name: 'Sensor', slug: 'sensor' },
        { tempId: 'o2', parentTempId: 'o1', name: 'AnomalyEvent', slug: 'anomaly-event' },
      ],
    })

    const inserts = supabase._calls.filter((c) => c.table === 'project_objects' && c.method === 'insert')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].args).toEqual([expect.objectContaining({ name: 'Sensor', parent_object_id: null })])
    expect(inserts[1].args).toEqual([expect.objectContaining({ name: 'AnomalyEvent', parent_object_id: 'obj-real-1' })])
  })

  it('inserts project_workstreams parent-before-child, resolving a child parent_workstream_id to the parent\'s real returned id', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_workstreams: [
        { data: [{ id: 'ws-real-1' }], error: null },
        { data: [{ id: 'ws-real-2' }], error: null },
      ],
    })

    await createProject(ctxWith(supabase), {
      name: 'Sandz-KabatOne',
      projectType: 'consulting',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [],
      workstreams: [
        { tempId: 'w1', parentTempId: null, name: 'Sandz-KabatOne Interface', slug: 'sandz-kabatone-interface' },
        { tempId: 'w2', parentTempId: 'w1', name: 'GetTestDataForTraining', slug: 'get-test-data-for-training' },
      ],
    })

    const inserts = supabase._calls.filter((c) => c.table === 'project_workstreams' && c.method === 'insert')
    expect(inserts).toHaveLength(2)
    expect(inserts[0].args).toEqual([expect.objectContaining({ name: 'Sandz-KabatOne Interface', parent_workstream_id: null })])
    expect(inserts[1].args).toEqual([expect.objectContaining({ name: 'GetTestDataForTraining', parent_workstream_id: 'ws-real-1' })])
  })

  it('throws before any row is written when a staged tree has a dangling/cyclic parentTempId', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
    })

    await expect(
      createProject(ctxWith(supabase), {
        name: 'Broken Tree',
        projectType: 'consulting',
        objective: '',
        details: {},
        knowledgeBaseId: null,
        evalDatasetId: null,
        members: [],
        projectObjects: [{ tempId: 'o1', parentTempId: 'does-not-exist', name: 'Orphan', slug: 'orphan' }],
      })
    ).rejects.toThrow('Invalid project_objects hierarchy')

    expect(supabase._calls.find((c) => c.table === 'project_objects' && c.method === 'insert')).toBeUndefined()
  })
})

// 2026-09-04: the Sandz Pilot Meeting Brief's onboarding pattern calls for
// a per-project starter prompt Ember offers -- deliberately curator-
// inclusive (owner/curator/admin), not projects_update_managers' owner-only
// RLS, so this writes via the admin client after an explicit check.
describe('updateProjectStarterPrompt', () => {
  beforeEach(() => {
    adminUpdateMock.mockClear()
    adminUpdateEqMock.mockClear().mockResolvedValue({ error: null })
  })

  function adminCtxWith(supabase: unknown) {
    return { user: { id: 'admin-1' }, profile: { role: 'admin' }, supabase } as never
  }

  it('rejects a non-admin caller with no owner/curator membership on the project', async () => {
    const supabase = createFakeSupabase({})
    await expect(updateProjectStarterPrompt(ctxWith(supabase), 'project-1', 'Ask me anything')).rejects.toThrow(
      "owner or curator role"
    )
    expect(adminUpdateMock).not.toHaveBeenCalled()
  })

  it('rejects a non-admin caller whose project role is consultant', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'consultant' }, error: null }] })
    await expect(updateProjectStarterPrompt(ctxWith(supabase), 'project-1', 'Ask me anything')).rejects.toThrow(
      "owner or curator role"
    )
    expect(adminUpdateMock).not.toHaveBeenCalled()
  })

  it('allows an active project curator to set it', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'curator' }, error: null }] })
    await updateProjectStarterPrompt(ctxWith(supabase), 'project-1', '  Ask about the pilot  ')
    expect(adminUpdateMock).toHaveBeenCalledWith({ starter_prompt: 'Ask about the pilot' })
    expect(adminUpdateEqMock).toHaveBeenCalledWith('id', 'project-1')
  })

  it('allows a platform admin without any project membership check', async () => {
    const supabase = createFakeSupabase({})
    await updateProjectStarterPrompt(adminCtxWith(supabase), 'project-1', 'Ask about the pilot')
    expect(adminUpdateMock).toHaveBeenCalledWith({ starter_prompt: 'Ask about the pilot' })
    expect(supabase._calls.find((c) => c.table === 'project_members')).toBeUndefined()
  })

  it('stores null for a blank/whitespace-only value, clearing the prompt', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'owner' }, error: null }] })
    await updateProjectStarterPrompt(ctxWith(supabase), 'project-1', '   ')
    expect(adminUpdateMock).toHaveBeenCalledWith({ starter_prompt: null })
  })
})

// The short description under the project title -- same owner/curator/admin
// bar as updateProjectStarterPrompt, and shared by the inline edit form and
// Ember's update_project_description tool.
describe('updateProjectObjective', () => {
  beforeEach(() => {
    adminUpdateMock.mockClear()
    adminUpdateEqMock.mockClear().mockResolvedValue({ error: null })
  })

  it('rejects a non-admin caller whose project role is consultant', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'consultant' }, error: null }] })
    await expect(updateProjectObjective(ctxWith(supabase), 'project-1', 'New description')).rejects.toThrow('owner or curator role')
    expect(adminUpdateMock).not.toHaveBeenCalled()
  })

  it('allows an active project curator to set it, trimmed', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'curator' }, error: null }] })
    await updateProjectObjective(ctxWith(supabase), 'project-1', '  New description  ')
    expect(adminUpdateMock).toHaveBeenCalledWith({ objective: 'New description' })
    expect(adminUpdateEqMock).toHaveBeenCalledWith('id', 'project-1')
  })

  it('stores null for a blank value, clearing the description', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'owner' }, error: null }] })
    await updateProjectObjective(ctxWith(supabase), 'project-1', '   ')
    expect(adminUpdateMock).toHaveBeenCalledWith({ objective: null })
  })
})
