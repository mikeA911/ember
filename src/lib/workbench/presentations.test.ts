import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const getActiveStructuredOutputProviderMock = vi.fn()
vi.mock('@/lib/ai', () => ({
  aiHostingForWorkstream: async () => 'any',
  gateProvider: async (_supabase: unknown, provider: unknown) => provider,
  manifestForDocuments: async () => ({ entries: [] }),
  manifestForProject: async () => ({ entries: [] }),
  manifestForWorkstream: async () => ({ entries: [] }),
  manifestForArtifact: async () => ({ entries: [] }),
  manifestForWikiVersion: async () => ({ entries: [] }),
  getActiveStructuredOutputProvider: (...args: unknown[]) => getActiveStructuredOutputProviderMock(...args),
}))

const {
  generatePresentation,
  openPresentationReview,
  approvePresentation,
  addSlideComment,
  replyToComment,
  classifyPendingComments,
  scheduleReviewOpen,
  cancelScheduledReviewOpen,
  autoOpenScheduledPresentations,
} = await import('./presentations')

function ctxWithProfile(supabase: unknown, profileRole: string) {
  return { user: { id: 'user-1' }, profile: { role: profileRole }, supabase } as never
}

beforeEach(() => {
  createAdminClientMock.mockReset()
  getActiveStructuredOutputProviderMock.mockReset()
})

describe('generatePresentation', () => {
  it('rejects a caller without owner/curator role, before calling AI generation', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')).rejects.toThrow(
      "you're currently a consultant on this project"
    )
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('creates a new presentation and its first version when none exists yet', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [
        { data: { project_id: 'project-1' }, error: null }, // role check
        { data: { project_id: 'project-1', name: 'WS', goal: null, summary: null, guardrail: null, deliverables: [] }, error: null }, // full fetch
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
      projects: [{ data: { objective: 'Modernize dispatch' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
      presentations: [
        { data: null, error: null }, // existing lookup -- none yet
        { data: { id: 'presentation-1' }, error: null }, // insert
      ],
      presentation_versions: [
        { data: null, error: null }, // latestVersion lookup -- none yet
        { data: { id: 'version-1' }, error: null }, // insert
      ],
    })
    const generateStructured = vi.fn().mockResolvedValue({
      data: { slides: [{ tempId: 'slide-1', title: 'Goal', body: 'Do the thing' }] },
      model: 'test-model',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')
    expect(result).toEqual({ presentationId: 'presentation-1', versionId: 'version-1', slideCount: 1 })

    const versionInsert = supabase._calls.find((c) => c.table === 'presentation_versions' && c.method === 'insert')
    expect(versionInsert?.args).toMatchObject({ presentation_id: 'presentation-1', version_number: 1 })
  })

  // Caught live: for a bullet-list-only slide, Gemini's real structured
  // output omits the body key entirely rather than sending "" -- the same
  // "omits an optional key instead of null/empty" behavior already
  // documented in project-ontology-suggestions.ts's own parentTempId
  // comment. A plain required z.string() rejected this real response.
  it('defaults a slide\'s body to an empty string when the model omits it for a bullet-only slide', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [
        { data: { project_id: 'project-1' }, error: null },
        { data: { project_id: 'project-1', name: 'WS', goal: null, summary: null, guardrail: null, deliverables: [] }, error: null },
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
      projects: [{ data: { objective: 'X' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
      presentations: [{ data: null, error: null }, { data: { id: 'presentation-1' }, error: null }],
      presentation_versions: [{ data: null, error: null }, { data: { id: 'version-1' }, error: null }],
    })
    const generateStructured = vi.fn().mockResolvedValue({
      data: { slides: [{ tempId: 'slide-1', title: 'Findings', items: ['No VMS in place', 'No analytics on any feed'] }] },
      model: 'test-model',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    await generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')

    const versionInsert = supabase._calls.find((c) => c.table === 'presentation_versions' && c.method === 'insert')
    expect(versionInsert?.args).toMatchObject({
      slides: [{ id: 'slide-1', title: 'Findings', body: '', items: ['No VMS in place', 'No analytics on any feed'] }],
    })
  })

  // Ontology Overview slide -- diagram_ref was reserved in the original
  // Part A plan for exactly this, built as a later addendum: only projects
  // that actually have a Builder Ontology (project_objects rows) get the
  // slide prepended.
  it('prepends an Ontology Overview slide when the project has Builder Ontology objects', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [
        { data: { project_id: 'project-1' }, error: null }, // role check
        { data: { project_id: 'project-1', name: 'WS', goal: null, summary: null, guardrail: null, deliverables: [] }, error: null }, // full fetch
        { data: [{ id: 'ws-1', name: 'WS', parent_workstream_id: null }], error: null }, // getOntologyMapData's own workstream fetch
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
      projects: [{ data: { objective: 'X' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
      project_objects: [{ data: [{ id: 'obj-1', name: 'Vehicle', parent_object_id: null }], error: null }],
      presentations: [{ data: null, error: null }, { data: { id: 'presentation-1' }, error: null }],
      presentation_versions: [{ data: null, error: null }, { data: { id: 'version-1' }, error: null }],
    })
    const generateStructured = vi.fn().mockResolvedValue({
      data: { slides: [{ tempId: 'slide-1', title: 'Goal', body: 'Do the thing' }] },
      model: 'test-model',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')
    expect(result.slideCount).toBe(2)

    const versionInsert = supabase._calls.find((c) => c.table === 'presentation_versions' && c.method === 'insert')
    expect(versionInsert?.args).toMatchObject({
      slides: [
        { id: 'ontology-overview', type: 'diagram_ref', title: 'Ontology Overview' },
        { id: 'slide-1', title: 'Goal' },
      ],
    })
  })

  it('does not add an Ontology Overview slide when the project has no Builder Ontology (the common case)', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [
        { data: { project_id: 'project-1' }, error: null },
        { data: { project_id: 'project-1', name: 'WS', goal: null, summary: null, guardrail: null, deliverables: [] }, error: null },
        { data: [], error: null }, // getOntologyMapData's own workstream fetch -- no workstreams either
      ],
      project_members: [{ data: { role: 'curator' }, error: null }],
      projects: [{ data: { objective: 'X' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
      // project_objects left unqueued -- defaults to empty, matching most projects today
      presentations: [{ data: null, error: null }, { data: { id: 'presentation-1' }, error: null }],
      presentation_versions: [{ data: null, error: null }, { data: { id: 'version-1' }, error: null }],
    })
    const generateStructured = vi.fn().mockResolvedValue({
      data: { slides: [{ tempId: 'slide-1', title: 'Goal', body: 'Do the thing' }] },
      model: 'test-model',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')
    expect(result.slideCount).toBe(1)
  })

  it('increments the version number when a presentation already exists', async () => {
    const supabase = createFakeSupabase({
      project_workstreams: [
        { data: { project_id: 'project-1' }, error: null },
        { data: { project_id: 'project-1', name: 'WS', goal: null, summary: null, guardrail: null, deliverables: [] }, error: null },
      ],
      project_members: [{ data: { role: 'owner' }, error: null }],
      projects: [{ data: { objective: 'X' }, error: null }],
      workstream_artifacts: [{ data: [], error: null }],
      presentations: [{ data: { id: 'presentation-1' }, error: null }], // existing lookup -- found
      presentation_versions: [
        { data: { version_number: 2 }, error: null }, // latestVersion lookup -- v2 exists
        { data: { id: 'version-3' }, error: null }, // insert -- v3
      ],
    })
    const generateStructured = vi.fn().mockResolvedValue({ data: { slides: [] }, model: 'x' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await generatePresentation(ctxWithProfile(supabase, 'consultant'), 'ws-1')
    expect(result.versionId).toBe('version-3')
    const versionInsert = supabase._calls.find((c) => c.table === 'presentation_versions' && c.method === 'insert')
    expect(versionInsert?.args).toMatchObject({ presentation_id: 'presentation-1', version_number: 3 })
  })
})

describe('openPresentationReview (transitionPresentationStatus guard)', () => {
  it('rejects opening review when the presentation is not currently draft', async () => {
    const supabase = createFakeSupabase({
      presentations: [
        { data: { workstream_id: 'ws-1' }, error: null }, // requireCuratorForPresentation lookup
        { data: { status: 'approved' }, error: null }, // current-status read
      ],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    await expect(openPresentationReview(ctxWithProfile(supabase, 'consultant'), 'presentation-1')).rejects.toThrow('currently "approved"')
    expect(createAdminClientMock).not.toHaveBeenCalled()
  })
})

describe('approvePresentation', () => {
  it('blocks a curator from approving a presentation they created themselves', async () => {
    const supabase = createFakeSupabase({ presentations: [{ data: { created_by: 'user-1' }, error: null }] })
    await expect(approvePresentation(ctxWithProfile(supabase, 'curator'), 'presentation-1')).rejects.toThrow(
      'cannot approve a presentation you created yourself'
    )
  })
})

describe('addSlideComment', () => {
  it('rejects a comment when the presentation review is not open', async () => {
    const supabase = createFakeSupabase({
      presentation_versions: [{ data: { presentation_id: 'presentation-1' }, error: null }],
      presentations: [{ data: { status: 'draft' }, error: null }],
    })
    await expect(addSlideComment(ctxWithProfile(supabase, 'consultant'), 'version-1', 'slide-1', 'hi')).rejects.toThrow('review is open')
  })
})

describe('replyToComment', () => {
  it('throws when the comment already has a reply (RLS returns zero rows)', async () => {
    const supabase = createFakeSupabase({ presentation_slide_comments: [{ data: [], error: null }] })
    await expect(replyToComment(ctxWithProfile(supabase, 'curator'), 'comment-1', 'reply text')).rejects.toThrow('already has a reply')
  })
})

describe('classifyPendingComments', () => {
  it('returns zero without calling the AI provider when there is nothing pending', async () => {
    const supabase = createFakeSupabase({
      presentation_versions: [{ data: { presentation_id: 'presentation-1' }, error: null }],
      presentations: [{ data: { workstream_id: 'ws-1' }, error: null }],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
      presentation_slide_comments: [{ data: [], error: null }],
    })
    const result = await classifyPendingComments(ctxWithProfile(supabase, 'consultant'), 'version-1')
    expect(result).toEqual({ classified: 0, actionsCreated: 0 })
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('classifies pending comments and creates one action per proposed next step', async () => {
    const supabase = createFakeSupabase({
      presentation_versions: [{ data: { presentation_id: 'presentation-1' }, error: null }],
      // Twice: the curator check, then the policy gate's workstream lookup.
      presentations: [
        { data: { workstream_id: 'ws-1' }, error: null },
        { data: { workstream_id: 'ws-1' }, error: null },
      ],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
      presentation_slide_comments: [
        { data: [{ id: 'comment-1', comment_text: 'Have we tested retrieval?', slide_id: 'slide-1' }], error: null },
      ],
    })
    const admin = createFakeSupabase({
      presentation_slide_comments: [{ data: null, error: null }],
      presentation_actions: [{ data: null, error: null }],
    })
    createAdminClientMock.mockReturnValue(admin)
    const generateStructured = vi.fn().mockResolvedValue({
      data: {
        results: [
          { commentId: 'comment-1', classification: 'evaluation_candidate', proposedAction: 'Create an evaluation comparing RAG vs long-context' },
        ],
      },
      model: 'x',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await classifyPendingComments(ctxWithProfile(supabase, 'consultant'), 'version-1')
    expect(result).toEqual({ classified: 1, actionsCreated: 1 })

    const classificationUpdate = admin._calls.find((c) => c.table === 'presentation_slide_comments' && c.method === 'update')
    expect(classificationUpdate?.args).toEqual({ classification: 'evaluation_candidate' })

    const actionInsert = admin._calls.find((c) => c.table === 'presentation_actions' && c.method === 'insert')
    expect(actionInsert?.args).toMatchObject({
      presentation_id: 'presentation-1',
      source_comment_id: 'comment-1',
      type: 'evaluation',
      action_text: 'Create an evaluation comparing RAG vs long-context',
    })
  })

  it('does not create an action for a classification with no proposed next step (e.g. a plain question)', async () => {
    const supabase = createFakeSupabase({
      presentation_versions: [{ data: { presentation_id: 'presentation-1' }, error: null }],
      // Twice: the curator check, then the policy gate's workstream lookup.
      presentations: [
        { data: { workstream_id: 'ws-1' }, error: null },
        { data: { workstream_id: 'ws-1' }, error: null },
      ],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
      presentation_slide_comments: [{ data: [{ id: 'comment-1', comment_text: 'What does this mean?', slide_id: 'slide-1' }], error: null }],
    })
    const admin = createFakeSupabase({ presentation_slide_comments: [{ data: null, error: null }] })
    createAdminClientMock.mockReturnValue(admin)
    const generateStructured = vi.fn().mockResolvedValue({
      data: { results: [{ commentId: 'comment-1', classification: 'question', proposedAction: null }] },
      model: 'x',
    })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ generateStructured })

    const result = await classifyPendingComments(ctxWithProfile(supabase, 'consultant'), 'version-1')
    expect(result).toEqual({ classified: 1, actionsCreated: 0 })
    expect(admin._calls.find((c) => c.table === 'presentation_actions')).toBeUndefined()
  })
})

describe('scheduleReviewOpen', () => {
  it('rejects a scheduledOpenAt that is not in the future', async () => {
    const supabase = createFakeSupabase({
      presentations: [{ data: { workstream_id: 'ws-1' }, error: null }],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const past = new Date(Date.now() - 1000).toISOString()
    await expect(scheduleReviewOpen(ctxWithProfile(supabase, 'consultant'), 'presentation-1', past)).rejects.toThrow('must be in the future')
  })

  it('rejects scheduling when the presentation is not currently draft', async () => {
    const supabase = createFakeSupabase({
      presentations: [
        { data: { workstream_id: 'ws-1' }, error: null }, // requireCuratorForPresentation lookup
        { data: { status: 'review_open' }, error: null }, // current-status read
      ],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const future = new Date(Date.now() + 86400000).toISOString()
    await expect(scheduleReviewOpen(ctxWithProfile(supabase, 'consultant'), 'presentation-1', future)).rejects.toThrow(
      'only a draft presentation can be scheduled'
    )
  })

  it('sets scheduled_open_at and review_deadline on a draft presentation', async () => {
    const supabase = createFakeSupabase({
      presentations: [
        { data: { workstream_id: 'ws-1' }, error: null },
        { data: { status: 'draft' }, error: null },
        { data: null, error: null },
      ],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    const future = new Date(Date.now() + 86400000).toISOString()
    await scheduleReviewOpen(ctxWithProfile(supabase, 'consultant'), 'presentation-1', future, '2026-12-01T00:00:00.000Z')

    const update = supabase._calls.find((c) => c.table === 'presentations' && c.method === 'update')
    expect(update?.args).toEqual({ scheduled_open_at: future, review_deadline: '2026-12-01T00:00:00.000Z' })
  })
})

describe('cancelScheduledReviewOpen', () => {
  it('clears both scheduled_open_at and review_deadline', async () => {
    const supabase = createFakeSupabase({
      presentations: [{ data: { workstream_id: 'ws-1' }, error: null }, { data: null, error: null }],
      project_workstreams: [{ data: { project_id: 'project-1' }, error: null }],
      project_members: [{ data: { role: 'curator' }, error: null }],
    })
    await cancelScheduledReviewOpen(ctxWithProfile(supabase, 'consultant'), 'presentation-1')

    const update = supabase._calls.find((c) => c.table === 'presentations' && c.method === 'update')
    expect(update?.args).toEqual({ scheduled_open_at: null, review_deadline: null })
  })
})

describe('autoOpenScheduledPresentations', () => {
  it('opens a due presentation and logs history with a null (system) actor', async () => {
    const admin = createFakeSupabase({
      presentations: [
        { data: [{ id: 'presentation-1', workstream_id: 'ws-1', review_deadline: null, created_by: 'creator-1' }], error: null }, // due query
        { data: [{ id: 'presentation-1' }], error: null }, // compare-and-set update succeeds
      ],
      presentation_status_history: [{ data: null, error: null }],
      project_workstreams: [{ data: { project_id: 'project-1', name: 'WS' }, error: null }], // notifyReviewOpened's own lookup
      project_members: [{ data: [], error: null }], // no active members -- nothing to notify, no project_notes insert needed
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await autoOpenScheduledPresentations()
    expect(result).toEqual({ opened: ['presentation-1'] })

    const update = admin._calls.find((c) => c.table === 'presentations' && c.method === 'update')
    expect(update?.args).toEqual({ status: 'review_open', scheduled_open_at: null })

    const historyInsert = admin._calls.find((c) => c.table === 'presentation_status_history' && c.method === 'insert')
    expect(historyInsert?.args).toMatchObject({
      presentation_id: 'presentation-1',
      from_status: 'draft',
      to_status: 'review_open',
      actor_id: null,
    })
  })

  it('returns nothing opened when no presentation is due', async () => {
    const admin = createFakeSupabase({ presentations: [{ data: [], error: null }] })
    createAdminClientMock.mockReturnValue(admin)

    const result = await autoOpenScheduledPresentations()
    expect(result).toEqual({ opened: [] })
  })

  it('skips a presentation that raced to a non-draft status before the compare-and-set update ran', async () => {
    const admin = createFakeSupabase({
      presentations: [
        { data: [{ id: 'presentation-1', workstream_id: 'ws-1', review_deadline: null, created_by: 'creator-1' }], error: null },
        { data: [], error: null }, // zero rows updated -- already left 'draft' by a manual open
      ],
    })
    createAdminClientMock.mockReturnValue(admin)

    const result = await autoOpenScheduledPresentations()
    expect(result).toEqual({ opened: [] })
  })
})
