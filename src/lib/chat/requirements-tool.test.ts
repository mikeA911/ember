import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const createRequirementMock = vi.fn()
const addVerificationMethodMock = vi.fn()
const getRequirementOptionsMock = vi.fn()
const listRequirementsMock = vi.fn()
vi.mock('@/lib/projects/requirements', async () => {
  const actual = await vi.importActual<typeof import('@/lib/projects/requirements')>('@/lib/projects/requirements')
  return {
    ...actual,
    createRequirement: (...args: unknown[]) => createRequirementMock(...args),
    addVerificationMethod: (...args: unknown[]) => addVerificationMethodMock(...args),
    getRequirementOptions: (...args: unknown[]) => getRequirementOptionsMock(...args),
    listRequirements: (...args: unknown[]) => listRequirementsMock(...args),
  }
})
vi.mock('@/lib/projects/reverification', () => ({
  listReverificationDue: async () => new Map([['r2', { openEventIds: ['e1'], reviewDue: false }]]),
}))

const { runListRequirementStatus, runCreateDraftRequirements, runAddVerificationMethods, LIST_REQUIREMENT_STATUS_TOOL, CREATE_DRAFT_REQUIREMENTS_TOOL } = await import('./requirements-tool')
const { extractCreatedRecordRef } = await import('./created-records')
const { AuthError } = await import('@/lib/auth')

function ctxWith(queued: Parameters<typeof createFakeSupabase>[0] = {}) {
  const supabase = createFakeSupabase(queued)
  return { supabase, ctx: { user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase } as unknown as WorkbenchCallerContext }
}

beforeEach(() => {
  createRequirementMock.mockReset()
  addVerificationMethodMock.mockReset()
  getRequirementOptionsMock.mockReset()
  listRequirementsMock.mockReset()
})

describe('list_requirement_status', () => {
  const requirement = (id: string, extra: Record<string, unknown> = {}) => ({
    id,
    code: id.toUpperCase(),
    title: `Req ${id}`,
    status: 'baselined',
    category: 'interface',
    priority: 'must',
    workstreamNames: [],
    sourceKinds: ['standard'],
    awaiting_acceptance: false,
    ...extra,
  })

  it('reports verification, missing evidence, re-verification and Ember drafts, under the caller’s own access', async () => {
    listRequirementsMock.mockResolvedValue([requirement('r1'), requirement('r2'), requirement('r3', { status: 'draft', awaiting_acceptance: true }), requirement('r4', { status: 'withdrawn' })])
    const { ctx } = ctxWith({
      solution_verification_methods: [
        {
          data: [
            { id: 'm1', requirement_id: 'r1', method: 'test', pass_criteria: '20/20' },
            { id: 'm2', requirement_id: 'r2', method: 'test', pass_criteria: 'x' },
            { id: 'm3', requirement_id: 'r2', method: 'inspection', pass_criteria: 'y' },
          ],
          error: null,
        },
      ],
      solution_verification_records: [
        {
          data: [
            { id: 'a', requirement_id: 'r1', method_id: 'm1', result: 'pass', performed_on: '2026-10-01', recorded_at: '2026-10-01T00:00:00Z', supersedes_id: null, environment: 'site', solution_reference: 'v1' },
            { id: 'b', requirement_id: 'r2', method_id: 'm2', result: 'pass', performed_on: '2026-10-01', recorded_at: '2026-10-01T00:00:00Z', supersedes_id: null, environment: 'site', solution_reference: 'v1' },
          ],
          error: null,
        },
      ],
    })
    const out = await runListRequirementStatus(ctx, 'p1', {})
    expect(out.total).toBe(3) // withdrawn left out by default
    const byId = Object.fromEntries(out.requirements.map((r) => [r.id, r]))
    expect(byId.r1).toMatchObject({ verification: 'passed', missingEvidence: [], reverificationDue: null, url: '/projects/p1/requirements/r1' })
    expect(byId.r2).toMatchObject({ verification: 'partial', missingEvidence: ['inspection'], reverificationDue: { openEvents: 1, reviewDue: false } })
    expect(byId.r3).toMatchObject({ verification: 'no_method', draftedByEmberAwaitingAcceptance: true })
    expect(out.counts).toEqual({ passed: 1, failed: 0, notVerified: 2, needReverification: 1, awaitingAcceptance: 1 })
  })

  it('narrows to one workstream’s requirements', async () => {
    listRequirementsMock.mockResolvedValue([requirement('r1'), requirement('r2')])
    const { ctx } = ctxWith({
      solution_verification_methods: [{ data: [], error: null }],
      solution_verification_records: [{ data: [], error: null }],
      solution_requirement_scope_links: [{ data: [{ requirement_id: 'r2' }], error: null }],
    })
    const out = await runListRequirementStatus(ctx, 'p1', { workstreamId: 'ws-1' })
    expect(out.requirements.map((r) => r.id)).toEqual(['r2'])
  })
})

describe('create_draft_requirements', () => {
  const draft = {
    title: 'Caller location delivery',
    statement: 'The system shall deliver caller location with every 911 call.',
    category: 'interface',
    sources: [{ kind: 'standard', knowledgeSourceId: 'ks-nena', locator: 'NENA i3 §4.2' }],
    methods: [{ method: 'test', passCriteria: 'Location shown for 20 of 20 test calls' }],
  }

  beforeEach(() => {
    getRequirementOptionsMock.mockResolvedValue({ sources: [{ id: 'ks-nena', title: 'NENA i3', context: null }], articles: [{ id: 'art-1', title: 'Location' }], workstreams: [{ id: 'ws-1', name: 'K-Safety' }], objects: [] })
  })

  it('creates each draft as drafted by Ember, with its methods, citing project knowledge', async () => {
    createRequirementMock.mockResolvedValue({ requirementId: 'req-9', code: 'REQ-009' })
    const { ctx } = ctxWith({ wiki_articles: [{ data: [{ id: 'art-1', slug: 'location' }], error: null }] })
    const out = await runCreateDraftRequirements(ctx, 'p1', 'conv-1', {
      requirements: [{ ...draft, workstreamIds: ['ws-1', 'ws-other'], sources: [...draft.sources, { kind: 'standard', wikiArticleSlug: 'location', locator: 'Summary' }] }],
    })
    expect(out.created).toEqual([{ requirementId: 'req-9', code: 'REQ-009', title: 'Caller location delivery', url: '/projects/p1/requirements/req-9' }])
    const [, projectId, fields, options] = createRequirementMock.mock.calls[0]
    expect(projectId).toBe('p1')
    expect(fields.sources).toEqual([
      expect.objectContaining({ kind: 'standard', knowledgeSourceId: 'ks-nena', wikiArticleId: null, locator: 'NENA i3 §4.2' }),
      expect.objectContaining({ wikiArticleId: 'art-1', knowledgeSourceId: null }),
    ])
    expect(fields.workstreamIds).toEqual(['ws-1'])
    expect(options).toEqual({ createdVia: 'assistant', conversationId: 'conv-1', methods: [expect.objectContaining({ method: 'test', performedBy: 'integrator' })] })
  })

  it('refuses a source outside the project’s knowledge for that draft only', async () => {
    createRequirementMock.mockResolvedValue({ requirementId: 'req-9', code: 'REQ-009' })
    const { ctx } = ctxWith()
    const out = await runCreateDraftRequirements(ctx, 'p1', 'conv-1', {
      requirements: [{ ...draft, title: 'Bad', sources: [{ kind: 'standard', knowledgeSourceId: 'ks-elsewhere', locator: '§1' }] }, draft],
    })
    expect(out.failed).toEqual([{ title: 'Bad', error: "Source ks-elsewhere is not in this project's knowledge" }])
    expect(out.created).toHaveLength(1)
  })

  it('stops at once when the caller may not create requirements', async () => {
    createRequirementMock.mockRejectedValue(new AuthError("Requires this project's owner or curator role"))
    const { ctx } = ctxWith()
    await expect(runCreateDraftRequirements(ctx, 'p1', 'conv-1', { requirements: [draft, draft] })).rejects.toBeInstanceOf(AuthError)
    expect(createRequirementMock).toHaveBeenCalledTimes(1)
  })

  it('needs at least one source per draft', async () => {
    const { ctx } = ctxWith()
    await expect(runCreateDraftRequirements(ctx, 'p1', 'conv-1', { requirements: [{ ...draft, sources: [] }] })).rejects.toThrow()
  })

  it('surfaces created requirements in the chat’s created records when replaying history', () => {
    expect(extractCreatedRecordRef('create_draft_requirements', JSON.stringify({ created: [{ requirementId: 'req-9' }, { requirementId: 'req-10' }], failed: [] }))).toEqual([
      { kind: 'solution_requirement', id: 'req-9' },
      { kind: 'solution_requirement', id: 'req-10' },
    ])
  })
})

describe('add_verification_methods', () => {
  it('adds methods only to a requirement in this project, marked as drafted by Ember', async () => {
    const elsewhere = ctxWith({ solution_requirements: [{ data: null, error: null }] })
    await expect(runAddVerificationMethods(elsewhere.ctx, 'p1', { requirementId: 'r-x', methods: [{ method: 'test', passCriteria: 'x' }] })).rejects.toThrow('That requirement is not in this project')

    const { ctx } = ctxWith({ solution_requirements: [{ data: { id: 'r1', code: 'REQ-001', project_id: 'p1' }, error: null }] })
    const out = await runAddVerificationMethods(ctx, 'p1', { requirementId: 'r1', methods: [{ method: 'inspection', passCriteria: 'Config matches the design' }] })
    expect(out).toMatchObject({ requirementId: 'r1', added: 1 })
    expect(addVerificationMethodMock).toHaveBeenCalledWith(ctx, 'r1', expect.objectContaining({ method: 'inspection' }), { createdVia: 'assistant' })
  })
})

describe('Ember’s boundaries', () => {
  const loop = fs.readFileSync(path.join(process.cwd(), 'src/lib/chat/loop.ts'), 'utf-8')

  it('tells Ember to confirm before drafting and that it can never record, waive, baseline or approve', () => {
    expect(loop).toMatch(/wait for the user's explicit confirmation or changes in their next message -- only then call create_draft_requirements/)
    expect(loop).toMatch(/You can never record a verification result, mark a requirement as passed or met, request or approve a waiver, baseline requirements, or request or approve an acceptance decision/)
    expect(CREATE_DRAFT_REQUIREMENTS_TOOL.description).toMatch(/never in the same turn you proposed them/)
    expect(LIST_REQUIREMENT_STATUS_TOOL.description).toMatch(/Read-only/)
  })

  it('gives Ember no tool that records results or decides anything', () => {
    for (const name of ['record_solution_verification', 'decide_solution_conformance_decision', 'decide_solution_waiver', 'activate_solution_baseline']) {
      expect(loop).not.toContain(name)
    }
  })
})

describe('ember_drafted_requirements migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261022100001_ember_drafted_requirements.sql'), 'utf-8')

  it('holds every Ember draft for acceptance, stamps who accepted it, and keeps it out of baselines until then', () => {
    expect(sql).toMatch(/if new\.created_via = 'assistant' then\s+new\.awaiting_acceptance := true;/)
    expect(sql).toMatch(/new\.accepted_by := auth\.uid\(\);/)
    expect(sql).toMatch(/an accepted requirement cannot go back to awaiting acceptance/)
    expect(sql).toMatch(/where a requirement came from cannot change/)
    expect(sql).toMatch(/a requirement Ember drafted must be accepted by a curator before it can be baselined/)
    expect(sql).toMatch(/perform apply_oauth_read_only_policies\(\);/)
  })
})
