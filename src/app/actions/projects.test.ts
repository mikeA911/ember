import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const requireUserMock = vi.fn()
const requireRoleMock = vi.fn()
let adminSupabase: ReturnType<typeof createFakeSupabase>

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    requireUser: (...args: unknown[]) => requireUserMock(...args),
    requireRole: (...args: unknown[]) => requireRoleMock(...args),
  }
})
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminSupabase }))
vi.mock('@/lib/knowledge-bases', () => ({ requireActiveKnowledgeBase: vi.fn() }))

const {
  createProjectAction,
  attachKnowledgeBaseAction,
  createAndAttachKnowledgeBaseAction,
  updateProjectNotesAction,
  updateProjectGoalAction,
  approveProjectAction,
  searchProfilesByEmailAction,
  addProjectMemberAction,
  transferOwnershipAction,
  savePublicProfileDraftAction,
  publishProjectAction,
  unpublishProjectAction,
  setPublicFullDetailAction,
} = await import('./projects')

beforeEach(() => {
  requireUserMock.mockReset()
  requireRoleMock.mockReset()
  adminSupabase = createFakeSupabase({})
})

describe('createProjectAction', () => {
  it('creates a draft project owned by the caller', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: { id: 'project-1' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })

    const result = await createProjectAction({
      name: 'RAG Retrieval Exercise',
      projectType: 'learning',
      objective: 'Compare Wiki + Chunks vs Chunks Only',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [],
    })

    expect(result).toEqual({ projectId: 'project-1' })
    const insert = supabase._calls.find((c) => c.table === 'projects' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ status: 'draft', owner_id: 'user-1', project_type: 'learning' })
  })

  it('rejects an anonymous session -- exploring is fine, starting a project is not', async () => {
    const supabase = createFakeSupabase({})
    requireUserMock.mockResolvedValue({ user: { id: 'anon-1' }, profile: { role: 'anonymous' }, supabase })

    await expect(
      createProjectAction({
        name: 'x',
        projectType: 'learning',
        objective: '',
        details: {},
        knowledgeBaseId: null,
        evalDatasetId: null,
        members: [],
      })
    ).rejects.toThrow('Create an account')
  })

  it('attaches an existing knowledge base and eval dataset when selected in the wizard', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
      eval_datasets: [{ data: null, error: null }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'curator' }, supabase })

    await createProjectAction({
      name: 'x',
      projectType: 'experiment',
      objective: '',
      details: { hypothesis: 'Wiki improves recall' },
      knowledgeBaseId: 'kb-1',
      evalDatasetId: 'dataset-1',
      members: [],
    })

    const kbInsert = supabase._calls.find((c) => c.table === 'project_knowledge_bases' && c.method === 'insert')
    const datasetUpdate = supabase._calls.find((c) => c.table === 'eval_datasets' && c.method === 'update')
    expect(kbInsert?.args).toMatchObject({ project_id: 'project-1', knowledge_base_id: 'kb-1', attached_by: 'user-1' })
    expect(datasetUpdate?.args).toMatchObject({ project_id: 'project-1' })
  })

  it('stages Team-step members onto the project, resolving each email to a user id', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
      project_members: [{ data: null, error: null }],
    })
    adminSupabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'maria-id', email: 'maria@example.com' }], error: null }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'owner@example.com' }, profile: { role: 'curator' }, supabase })

    await createProjectAction({
      name: 'x',
      projectType: 'learning',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [{ email: 'maria@example.com', role: 'curator' }],
    })

    const memberInsert = supabase._calls.find((c) => c.table === 'project_members' && c.method === 'insert')
    expect(memberInsert?.args).toEqual([{ project_id: 'project-1', user_id: 'maria-id', role: 'curator', status: 'active' }])
  })

  it('silently skips a staged member whose email does not resolve to an account, rather than failing the whole project creation', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'project-1' }, error: null }],
    })
    adminSupabase = createFakeSupabase({ profiles: [{ data: [], error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1', email: 'owner@example.com' }, profile: { role: 'curator' }, supabase })

    const result = await createProjectAction({
      name: 'x',
      projectType: 'learning',
      objective: '',
      details: {},
      knowledgeBaseId: null,
      evalDatasetId: null,
      members: [{ email: 'nobody@example.com', role: 'viewer' }],
    })

    expect(result).toEqual({ projectId: 'project-1' })
    expect(supabase._calls.find((c) => c.table === 'project_members' && c.method === 'insert')).toBeUndefined()
  })
})

describe('attachKnowledgeBaseAction', () => {
  it("lets this project's owner attach even without the platform curator role", async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      knowledge_bases: [{ data: { visibility_scope: 'platform', status: 'approved' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'member' }, supabase })

    expect(await attachKnowledgeBaseAction('project-1', 'kb-1')).toEqual({})

    const insert = supabase._calls.find((c) => c.table === 'project_knowledge_bases' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ project_id: 'project-1', knowledge_base_id: 'kb-1' })
  })

  it('attaches a knowledge base still pending admin review', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }],
      knowledge_bases: [{ data: { visibility_scope: 'platform', status: 'pending' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })

    expect(await attachKnowledgeBaseAction('project-1', 'kb-1')).toEqual({})
    expect(supabase._calls.some((c) => c.table === 'project_knowledge_bases' && c.method === 'insert')).toBe(true)
  })

  it('refuses a rejected knowledge base, with the reason', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      knowledge_bases: [{ data: { visibility_scope: 'platform', status: 'rejected' }, error: null }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'curator' }, supabase })

    const result = await attachKnowledgeBaseAction('project-1', 'kb-1')
    expect(result.error).toMatch(/rejected/)
    expect(supabase._calls.some((c) => c.table === 'project_knowledge_bases' && c.method === 'insert')).toBe(false)
  })

  it("refuses a caller who isn't this project's owner or curator", async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'member' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'curator' }, supabase })

    const result = await attachKnowledgeBaseAction('project-1', 'kb-1')
    expect(result.error).toMatch(/owner or curator/)
    expect(supabase._calls.some((c) => c.table === 'project_knowledge_bases')).toBe(false)
  })
})

describe('createAndAttachKnowledgeBaseAction', () => {
  it('creates a pending knowledge base and attaches it to the project in one step', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    adminSupabase = createFakeSupabase({ knowledge_bases: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'member' }, supabase })

    expect(await createAndAttachKnowledgeBaseAction('project-1', { name: '  Supplier Contracts ', description: 'Signed terms' })).toEqual({})

    const kbInsert = adminSupabase._calls.find((c) => c.table === 'knowledge_bases' && c.method === 'insert')
    expect(kbInsert?.args).toEqual({ id: 'supplier-contracts', name: 'Supplier Contracts', description: 'Signed terms', status: 'pending' })
    const link = supabase._calls.find((c) => c.table === 'project_knowledge_bases' && c.method === 'insert')
    expect(link?.args).toMatchObject({ project_id: 'project-1', knowledge_base_id: 'supplier-contracts', attached_by: 'user-1' })
  })

  it('retries with a suffixed id when the name is already taken', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'curator' }, error: null }],
      project_knowledge_bases: [{ data: null, error: null }],
    })
    adminSupabase = createFakeSupabase({
      knowledge_bases: [
        { data: null, error: Object.assign(new Error('duplicate key'), { code: '23505' }) },
        { data: null, error: null },
      ],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'member' }, supabase })

    expect(await createAndAttachKnowledgeBaseAction('project-1', { name: 'Contracts' })).toEqual({})

    const inserts = adminSupabase._calls.filter((c) => c.table === 'knowledge_bases' && c.method === 'insert')
    expect(inserts).toHaveLength(2)
    expect((inserts[1].args as { id: string }).id).toMatch(/^contracts-[a-z0-9]+$/)
  })

  it('removes the new knowledge base again if attaching it fails', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { role: 'owner' }, error: null }],
      project_knowledge_bases: [{ data: null, error: Object.assign(new Error('rls'), { code: '42501' }) }],
    })
    adminSupabase = createFakeSupabase({ knowledge_bases: [{ data: null, error: null }, { data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'member' }, supabase })

    const result = await createAndAttachKnowledgeBaseAction('project-1', { name: 'Contracts' })
    expect(result.error).toMatch(/owner or curator/)
    expect(adminSupabase._calls.some((c) => c.table === 'knowledge_bases' && c.method === 'delete')).toBe(true)
  })

  it("refuses a caller who isn't this project's owner or curator before creating anything", async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    adminSupabase = createFakeSupabase({})
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'curator' }, supabase })

    const result = await createAndAttachKnowledgeBaseAction('project-1', { name: 'Contracts' })
    expect(result.error).toMatch(/owner or curator/)
    expect(adminSupabase._calls).toHaveLength(0)
  })

  it('requires a name', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'owner' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'member' }, supabase })

    expect((await createAndAttachKnowledgeBaseAction('project-1', { name: '   ' })).error).toMatch(/Name/)
  })
})

describe('updateProjectNotesAction', () => {
  it('only requires an authenticated session -- RLS enforces owner-or-staff', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })

    await updateProjectNotesAction('project-1', 'Wiki-assisted retrieval outperformed raw chunks on 8/10 cases.')

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toMatchObject({ notes: 'Wiki-assisted retrieval outperformed raw chunks on 8/10 cases.' })
  })
})

describe('updateProjectGoalAction', () => {
  it('only requires an authenticated session -- RLS enforces owner-or-staff', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })

    await updateProjectGoalAction('project-1', '  Analyze the repo and produce an OpenAPI spec.  ')

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ goal: 'Analyze the repo and produce an OpenAPI spec.' })
  })

  it('stores null for a blank goal', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, supabase })

    await updateProjectGoalAction('project-1', '   ')

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ goal: null })
  })
})

describe('approveProjectAction', () => {
  it('rejects a plain consultant with no project role', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })

    await expect(approveProjectAction('project-1')).rejects.toThrow('Only a curator or admin')
  })

  it('allows a platform admin with no project membership at all', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'admin' }, supabase })
    adminSupabase = createFakeSupabase({ projects: [{ data: { status: 'active' }, error: null }, { data: null, error: null }] })

    await approveProjectAction('project-1')

    const update = adminSupabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ status: 'completed' })
  })

  it('allows a platform curator with no project membership at all', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'curator' }, supabase })
    adminSupabase = createFakeSupabase({ projects: [{ data: { status: 'active' }, error: null }, { data: null, error: null }] })

    await approveProjectAction('project-1')

    expect(adminSupabase._calls.find((c) => c.table === 'projects' && c.method === 'update')?.args).toEqual({ status: 'completed' })
  })

  it('allows a project owner whose platform role is merely consultant', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'owner' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })
    adminSupabase = createFakeSupabase({ projects: [{ data: { status: 'active' }, error: null }, { data: null, error: null }] })

    await approveProjectAction('project-1')

    expect(adminSupabase._calls.find((c) => c.table === 'projects' && c.method === 'update')?.args).toEqual({ status: 'completed' })
  })

  it('allows a project curator whose platform role is merely consultant', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'curator' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })
    adminSupabase = createFakeSupabase({ projects: [{ data: { status: 'active' }, error: null }, { data: null, error: null }] })

    await approveProjectAction('project-1')

    expect(adminSupabase._calls.find((c) => c.table === 'projects' && c.method === 'update')?.args).toEqual({ status: 'completed' })
  })

  it('rejects a project member whose role is merely consultant/viewer', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: { role: 'viewer' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase })

    await expect(approveProjectAction('project-1')).rejects.toThrow('Only a curator or admin')
  })
})

describe('searchProfilesByEmailAction', () => {
  it('rejects an anonymous session', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'anonymous' } })
    await expect(searchProfilesByEmailAction('maria')).rejects.toThrow('Create an account')
  })

  it('returns nothing for a too-short query, without even calling the admin client', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'consultant' } })
    const result = await searchProfilesByEmailAction('m')
    expect(result).toEqual([])
  })

  it('returns only id and email, never role or other profile fields', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'consultant' } })
    adminSupabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'maria-id', email: 'maria@example.com' }], error: null }],
    })

    const result = await searchProfilesByEmailAction('maria')
    expect(result).toEqual([{ id: 'maria-id', email: 'maria@example.com' }])
  })
})

describe('addProjectMemberAction', () => {
  it('inserts the membership through the RLS-scoped client -- RLS (can_manage_project) is the real gate, not this action', async () => {
    const supabase = createFakeSupabase({ project_members: [{ data: null, error: null }] })
    adminSupabase = createFakeSupabase({
      profiles: [{ data: [{ id: 'john-id', email: 'john@example.com' }], error: null }],
    })
    requireUserMock.mockResolvedValue({ profile: { role: 'consultant' }, supabase })

    await addProjectMemberAction('project-1', 'john@example.com', 'consultant')

    const insert = supabase._calls.find((c) => c.table === 'project_members' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ project_id: 'project-1', user_id: 'john-id', role: 'consultant', status: 'active' })
  })

  it('throws a clear error when the email does not match any account', async () => {
    const supabase = createFakeSupabase({})
    adminSupabase = createFakeSupabase({ profiles: [{ data: [], error: null }] })
    requireUserMock.mockResolvedValue({ profile: { role: 'consultant' }, supabase })

    await expect(addProjectMemberAction('project-1', 'nobody@example.com', 'viewer')).rejects.toThrow('No account found')
  })
})

describe('savePublicProfileDraftAction', () => {
  it('rejects an anonymous session', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'anonymous' } })
    await expect(savePublicProfileDraftAction('project-1', { title: 'x' })).rejects.toThrow('Create an account')
  })

  it('updates only public_profile, never touching visibility/published_at', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ profile: { role: 'consultant' }, supabase })

    await savePublicProfileDraftAction('project-1', { title: 'RAG Architecture Comparison', summary: 'Chunks vs Wiki' })

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ public_profile: { title: 'RAG Architecture Comparison', summary: 'Chunks vs Wiki' } })
  })
})

describe('publishProjectAction', () => {
  it('rejects an anonymous session', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'anonymous' } })
    await expect(publishProjectAction('project-1', 'rag-comparison')).rejects.toThrow('Create an account')
  })

  it('sets visibility=public, published_at, published_by, and the slug', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'owner-1' }, profile: { role: 'curator' }, supabase })

    await publishProjectAction('project-1', 'rag-comparison')

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toMatchObject({ visibility: 'public', published_by: 'owner-1', public_slug: 'rag-comparison' })
    expect((update?.args as { published_at: string }).published_at).toBeTypeOf('string')
  })

  it('maps a taken slug to a clear validation error, not a raw Postgres error', async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: null, error: Object.assign(new Error('duplicate key value violates unique constraint'), { code: '23505' }) }],
    })
    requireUserMock.mockResolvedValue({ user: { id: 'owner-1' }, profile: { role: 'curator' }, supabase })

    await expect(publishProjectAction('project-1', 'already-taken')).rejects.toThrow('already taken')
  })
})

describe('unpublishProjectAction', () => {
  it('rejects an anonymous session', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'anonymous' } })
    await expect(unpublishProjectAction('project-1')).rejects.toThrow('Create an account')
  })

  it('resets visibility to private and frees the slug, without touching public_profile', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ profile: { role: 'curator' }, supabase })

    await unpublishProjectAction('project-1')

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ visibility: 'private', published_at: null, published_by: null, public_slug: null })
  })
})

describe('setPublicFullDetailAction', () => {
  it('rejects an anonymous session', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'anonymous' } })
    await expect(setPublicFullDetailAction('project-1', true)).rejects.toThrow('platform admin')
  })

  it('rejects a project owner who is not a platform admin -- stricter than the rest of the publish flow', async () => {
    requireUserMock.mockResolvedValue({ profile: { role: 'curator' } })
    await expect(setPublicFullDetailAction('project-1', true)).rejects.toThrow('platform admin')
  })

  it('lets a platform admin turn it on', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ profile: { role: 'admin' }, supabase })

    await setPublicFullDetailAction('project-1', true)

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ public_full_detail: true })
  })

  it('lets a platform admin turn it back off', async () => {
    const supabase = createFakeSupabase({ projects: [{ data: null, error: null }] })
    requireUserMock.mockResolvedValue({ profile: { role: 'admin' }, supabase })

    await setPublicFullDetailAction('project-1', false)

    const update = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(update?.args).toEqual({ public_full_detail: false })
  })
})

describe('transferOwnershipAction', () => {
  it('moves owner_id, promotes the new owner, and demotes the previous owner to curator', async () => {
    const supabase = createFakeSupabase({
      project_members: [{ data: { user_id: 'john-id' }, error: null }, { data: null, error: null }],
      projects: [{ data: { owner_id: 'old-owner-id' }, error: null }, { data: null, error: null }],
    })
    requireUserMock.mockResolvedValue({ supabase })

    await transferOwnershipAction('project-1', 'member-row-id')

    const projectUpdate = supabase._calls.find((c) => c.table === 'projects' && c.method === 'update')
    expect(projectUpdate?.args).toEqual({ owner_id: 'john-id' })
    const memberUpdates = supabase._calls.filter((c) => c.table === 'project_members' && c.method === 'update')
    expect(memberUpdates[0].args).toEqual({ role: 'owner' })
    expect(memberUpdates[1].args).toEqual({ role: 'curator' })
  })
})
