import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const requireUserMock = vi.fn()
const attachArtifactMock = vi.fn()
const getActiveProjectRoleMock = vi.fn()
const listWorkstreamsMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return { ...actual, requireUser: (...args: unknown[]) => requireUserMock(...args) }
})
vi.mock('@/lib/chat/loop', () => ({ runAssistantTurn: vi.fn() }))
vi.mock('@/lib/ai', () => ({ listChatCapableModels: vi.fn(), listProviders: vi.fn(), listModels: vi.fn() }))
vi.mock('@/lib/workbench/assistant-descriptor', () => ({ getAssistantDescriptor: vi.fn() }))
vi.mock('@/lib/workbench/workstreams', () => ({ attachArtifact: (...args: unknown[]) => attachArtifactMock(...args) }))
vi.mock('@/lib/workbench/context', () => ({ getActiveProjectRole: (...args: unknown[]) => getActiveProjectRoleMock(...args) }))
vi.mock('@/lib/projects/workstreams', () => ({ listWorkstreams: (...args: unknown[]) => listWorkstreamsMock(...args) }))

const { saveAttachmentsAsFindingsAction, listFindingsTargetsAction } = await import('./chat')

const attachments = [
  { name: 'notes.md', text: '# Notes', truncated: false },
  { name: 'src/.env', text: 'API_KEY=[hidden by Ember]', truncated: false, hiddenSecrets: 1 },
]

beforeEach(() => {
  requireUserMock.mockReset()
  attachArtifactMock.mockReset()
  getActiveProjectRoleMock.mockReset()
  listWorkstreamsMock.mockReset()
})

describe('listFindingsTargetsAction', () => {
  it("offers the project's workstreams to a consultant", async () => {
    requireUserMock.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'member' }, supabase: {} })
    getActiveProjectRoleMock.mockResolvedValue('consultant')
    listWorkstreamsMock.mockResolvedValue([{ id: 'w1', name: 'Discovery', status: 'draft' }])

    expect(await listFindingsTargetsAction('p1')).toEqual({ canSave: true, workstreams: [{ id: 'w1', name: 'Discovery' }] })
  })

  it('offers nothing to a plain project member', async () => {
    requireUserMock.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'member' }, supabase: {} })
    getActiveProjectRoleMock.mockResolvedValue('member')

    expect(await listFindingsTargetsAction('p1')).toEqual({ canSave: false, workstreams: [] })
    expect(listWorkstreamsMock).not.toHaveBeenCalled()
  })
})

describe('saveAttachmentsAsFindingsAction', () => {
  it('saves each attachment as a Findings artifact in the chosen workstream', async () => {
    const supabase = createFakeSupabase({ project_workstreams: [{ data: { id: 'w1', name: 'Discovery', project_id: 'p1' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'consultant' }, supabase })
    attachArtifactMock.mockResolvedValue({ artifactId: 'a' })

    expect(await saveAttachmentsAsFindingsAction({ projectId: 'p1', workstreamId: 'w1', attachments })).toEqual({ saved: 2, workstreamName: 'Discovery' })
    expect(attachArtifactMock.mock.calls.map((c) => c[1])).toEqual([
      { workstreamId: 'w1', artifactType: 'findings', title: 'notes.md', content: '# Notes', notes: 'Uploaded in Ember chat.' },
      {
        workstreamId: 'w1',
        artifactType: 'findings',
        title: '.env',
        content: '```bash\nAPI_KEY=[hidden by Ember]\n```',
        notes: 'Uploaded in Ember chat. 1 secret value(s) were hidden before saving.',
      },
    ])
  })

  it("refuses a workstream from another project, and explains a permission refusal", async () => {
    const other = createFakeSupabase({ project_workstreams: [{ data: { id: 'w9', name: 'Elsewhere', project_id: 'p2' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'consultant' }, supabase: other })
    expect((await saveAttachmentsAsFindingsAction({ projectId: 'p1', workstreamId: 'w9', attachments })).error).toMatch(/not in this project/)
    expect(attachArtifactMock).not.toHaveBeenCalled()

    const own = createFakeSupabase({ project_workstreams: [{ data: { id: 'w1', name: 'Discovery', project_id: 'p1' }, error: null }] })
    requireUserMock.mockResolvedValue({ user: { id: 'u1' }, profile: { role: 'member' }, supabase: own })
    attachArtifactMock.mockRejectedValue(Object.assign(new Error('rls'), { code: '42501' }))
    expect((await saveAttachmentsAsFindingsAction({ projectId: 'p1', workstreamId: 'w1', attachments })).error).toMatch(/owner, curator or consultant/)
  })
})
