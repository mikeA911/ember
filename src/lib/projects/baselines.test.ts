import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createFakeSupabase({ profiles: [{ data: [], error: null }] }) }))
const createProjectNoteMock = vi.fn(async () => ({ noteId: 'note-1' }))
vi.mock('@/lib/projects/notes', () => ({ createProjectNote: (...args: unknown[]) => createProjectNoteMock(...(args as [])) }))

const { rollUpBaseline, rollUpSnapshot, requestDecision, decideDecision, activateBaseline, setBaselineItems } = await import('./baselines')
const { supersedeRequirement, nextRevisionCode, RequirementValidationError } = await import('./requirements')
const { AuthError } = await import('@/lib/auth')

let seq = 0
function rec(methodId: string, result: string, extra: Record<string, unknown> = {}) {
  seq += 1
  return { id: `r${seq}`, method_id: methodId, result, performed_on: '2026-10-01', recorded_at: `2026-10-05T00:00:${String(seq).padStart(2, '0')}Z`, supersedes_id: null, ...extra } as never
}

type Queued = Parameters<typeof createFakeSupabase>[0]
function makeCtx(queued: Queued, { projectRole = 'curator' as string | null, rpc = { data: 'id-1' as unknown, error: null as unknown } } = {}) {
  const fake = createFakeSupabase({ project_members: [{ data: projectRole ? { role: projectRole } : null, error: null }], ...queued })
  const rpcMock = vi.fn(async () => rpc)
  const supabase = { ...fake, rpc: rpcMock }
  return { fake, rpcMock, ctx: { user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase } as unknown as WorkbenchCallerContext }
}
const baseline = { id: 'b1', project_id: 'p1', name: 'Phase 1 SAT', version: 1, status: 'active' }

describe('baseline roll-up', () => {
  it('counts each requirement once, by its verification status', () => {
    const { statuses, counts } = rollUpBaseline([
      { requirementId: 'a', methodIds: ['m1'], records: [rec('m1', 'pass')], waived: false },
      { requirementId: 'b', methodIds: ['m2'], records: [rec('m2', 'fail')], waived: false },
      { requirementId: 'c', methodIds: ['m3'], records: [], waived: false },
      { requirementId: 'd', methodIds: ['m4'], records: [rec('m4', 'conditional_pass')], waived: false },
    ])
    expect(statuses.get('b')).toBe('failed')
    expect(counts).toEqual({ total: 4, passed: 1, failed: 1, conditional: 1, waived: 0, notApplicable: 0, notVerified: 1 })
  })

  it('shows an approved waiver in place of a fail or a gap, but never hides a pass', () => {
    const { statuses, counts } = rollUpBaseline([
      { requirementId: 'a', methodIds: ['m1'], records: [rec('m1', 'fail')], waived: true },
      { requirementId: 'b', methodIds: ['m2'], records: [], waived: true },
      { requirementId: 'c', methodIds: ['m3'], records: [rec('m3', 'pass')], waived: true },
    ])
    expect([statuses.get('a'), statuses.get('b'), statuses.get('c')]).toEqual(['waived', 'waived', 'passed'])
    expect(counts.waived).toBe(2)
  })

  it('rebuilds a decision’s roll-up from the records its snapshot names, not today’s', () => {
    const pass = rec('m1', 'pass')
    const later = rec('m1', 'fail')
    const snapshot = {
      taken_at: '2026-10-05T00:00:00Z',
      baseline_version: 1,
      requirements: [{ requirement_id: 'a', method_ids: ['m1'], record_ids: [(pass as { id: string }).id], waiver_id: null }],
    }
    const byId = new Map([pass, later].map((r) => [(r as { id: string }).id, r]))
    expect(rollUpSnapshot(snapshot, byId).statuses.get('a')).toBe('passed')
  })
})

describe('baselines and decisions', () => {
  it('only curators activate or request decisions', async () => {
    const { rpcMock, ctx } = makeCtx({ solution_evaluation_baselines: [{ data: baseline, error: null }] }, { projectRole: 'consultant' })
    await expect(requestDecision(ctx, 'b1', { decisionType: 'site_acceptance', approvalType: 'technical' })).rejects.toBeInstanceOf(AuthError)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('requests a decision through the database and notifies the current holders of the authority, not the requester', async () => {
    createProjectNoteMock.mockClear()
    const { rpcMock, ctx } = makeCtx({
      solution_evaluation_baselines: [{ data: baseline, error: null }],
      project_authority_assignments: [
        {
          data: [
            { user_id: 'rep-1', effective_from: '2026-01-01T00:00:00Z', expires_at: null },
            { user_id: 'user-1', effective_from: '2026-01-01T00:00:00Z', expires_at: null },
            { user_id: 'expired', effective_from: '2026-01-01T00:00:00Z', expires_at: '2026-02-01T00:00:00Z' },
          ],
          error: null,
        },
      ],
    })
    await requestDecision(ctx, 'b1', { decisionType: 'customer_acceptance', approvalType: 'customer_acceptance', note: ' Phase 1 ' })
    expect(rpcMock).toHaveBeenCalledWith('request_solution_conformance_decision', {
      p_baseline_id: 'b1',
      p_decision_type: 'customer_acceptance',
      p_approval_type: 'customer_acceptance',
      p_note: 'Phase 1',
    })
    expect(createProjectNoteMock).toHaveBeenCalledTimes(1)
    expect(createProjectNoteMock.mock.calls[0]).toEqual([
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ recipientUserId: 'rep-1', contextType: 'solution_decision', contextId: 'id-1' }),
    ])
  })

  it('needs a reason to reject a decision', async () => {
    const { rpcMock, ctx } = makeCtx({ solution_conformance_decisions: [{ data: { project_id: 'p1' }, error: null }] })
    await expect(decideDecision(ctx, 'd1', { approve: false, note: ' ' })).rejects.toThrow('Say why you are rejecting it')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('shows the database’s refusal without the function name', async () => {
    const { ctx } = makeCtx(
      { solution_evaluation_baselines: [{ data: { ...baseline, status: 'draft' }, error: null }] },
      { rpc: { data: null, error: { message: 'activate_solution_baseline: every requirement needs a verification method first' } } }
    )
    await expect(activateBaseline(ctx, 'b1')).rejects.toThrow('Every requirement needs a verification method first')
    const self = makeCtx(
      { solution_conformance_decisions: [{ data: { project_id: 'p1' }, error: null }] },
      { rpc: { data: null, error: { message: "decide_solution_conformance_decision: you requested this decision or recorded its evidence, and this Project does not allow self-approval" } } }
    )
    await expect(decideDecision(self.ctx, 'd1', { approve: true })).rejects.toBeInstanceOf(RequirementValidationError)
  })

  it('changes only a draft baseline’s requirements, adding and removing the difference', async () => {
    const frozen = makeCtx({ solution_evaluation_baselines: [{ data: baseline, error: null }] })
    await expect(setBaselineItems(frozen.ctx, 'b1', ['r1'])).rejects.toThrow(/frozen/)

    const { fake, ctx } = makeCtx({
      solution_evaluation_baselines: [{ data: { ...baseline, status: 'draft' }, error: null }],
      solution_evaluation_baseline_items: [{ data: [{ requirement_id: 'r1' }, { requirement_id: 'r2' }], error: null }],
    })
    await setBaselineItems(ctx, 'b1', ['r2', 'r3'])
    const writes = fake._calls.filter((c) => c.table === 'solution_evaluation_baseline_items' && (c.method === 'insert' || c.method === 'delete'))
    expect(writes.map((c) => c.method)).toEqual(['delete', 'insert'])
    expect(writes[1].args).toEqual([{ baseline_id: 'b1', project_id: 'p1', requirement_id: 'r3', added_by: 'user-1' }])
  })
})

describe('superseding a requirement', () => {
  const baselined = { id: 'req-1', project_id: 'p1', code: 'REQ-001', title: 'T', statement: 'S', rationale: null, category: 'interface', priority: 'must', applies_from: 'deployment', status: 'baselined' }

  it('suggests the next revision code', () => {
    expect(nextRevisionCode('REQ-001')).toBe('REQ-001-R2')
    expect(nextRevisionCode('REQ-001-R2')).toBe('REQ-001-R3')
  })

  it('copies content, sources, scope and methods into a new draft and links it as the replacement', async () => {
    const { fake, ctx } = makeCtx({
      solution_requirements: [{ data: baselined, error: null }, { data: { id: 'req-2' }, error: null }, { data: null, error: null }],
      solution_requirement_sources: [{ data: [{ kind: 'standard', knowledge_source_id: 'ks-1', wiki_article_id: null, locator: '§4.2', requester: null, note: null }], error: null }],
      solution_requirement_scope_links: [{ data: [{ workstream_id: 'ws-1', project_object_id: null }], error: null }],
      solution_verification_methods: [{ data: [{ method: 'test', procedure: null, pass_criteria: '20/20', threshold: null, measure_window: null, performed_by: 'integrator' }], error: null }],
    })
    expect(await supersedeRequirement(ctx, 'req-1')).toEqual({ projectId: 'p1', requirementId: 'req-2' })
    const inserted = (table: string) => fake._calls.find((c) => c.table === table && c.method === 'insert')?.args
    expect(inserted('solution_requirements')).toMatchObject({ code: 'REQ-001-R2', title: 'T', created_by: 'user-1' })
    expect(inserted('solution_requirement_sources')).toEqual([expect.objectContaining({ requirement_id: 'req-2', knowledge_source_id: 'ks-1', locator: '§4.2' })])
    expect(inserted('solution_verification_methods')).toEqual([expect.objectContaining({ requirement_id: 'req-2', pass_criteria: '20/20' })])
    expect(fake._calls.find((c) => c.table === 'solution_requirements' && c.method === 'update')?.args).toEqual({ status: 'superseded', superseded_by: 'req-2' })
  })

  it('only supersedes a baselined requirement, and removes a half-made replacement', async () => {
    const draft = makeCtx({ solution_requirements: [{ data: { ...baselined, status: 'draft' }, error: null }] })
    await expect(supersedeRequirement(draft.ctx, 'req-1')).rejects.toThrow('A draft can still be edited directly')

    const { fake, ctx } = makeCtx({
      solution_requirements: [{ data: baselined, error: null }, { data: { id: 'req-2' }, error: null }],
      solution_requirement_sources: [{ data: [{ kind: 'standard', locator: 'x' }], error: null }, { data: null, error: new Error('boom') }],
      solution_requirement_scope_links: [{ data: [], error: null }],
      solution_verification_methods: [{ data: [], error: null }],
    })
    await expect(supersedeRequirement(ctx, 'req-1')).rejects.toThrow('boom')
    expect(fake._calls.some((c) => c.table === 'solution_requirements' && c.method === 'delete')).toBe(true)
    expect(fake._calls.some((c) => c.table === 'solution_requirements' && c.method === 'update')).toBe(false)
  })
})

describe('solution_baselines_and_decisions migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261020100001_solution_baselines_and_decisions.sql'), 'utf-8')

  it('takes authority only from active, in-date assignments of active members -- never from admin status', () => {
    const fn = sql.slice(sql.indexOf('create or replace function holds_project_authority'), sql.indexOf('create or replace function project_self_approval_allowed'))
    expect(fn).toMatch(/a\.status = 'active' and a\.effective_from <= now\(\) and \(a\.expires_at is null or a\.expires_at > now\(\)\)/)
    expect(fn).toMatch(/pm\.status = 'active'/)
    expect(fn).not.toMatch(/is_admin/)
  })

  it('freezes an active baseline and baselines its requirements on activation', () => {
    expect(sql).toMatch(/an active baseline is frozen -- create a new version to change it/)
    expect(sql).toMatch(/add at least one requirement first/)
    expect(sql).toMatch(/every requirement needs a verification method first/)
    expect(sql).toMatch(/update solution_requirements r set status = 'baselined'/)
    expect(sql).toMatch(/update solution_evaluation_baselines set status = 'superseded'\s+where id = v_baseline\.previous_baseline_id/)
  })

  it('refuses self-approval by the requester or an evidence recorder unless policy and assignment both allow it', () => {
    expect(sql).toMatch(/v_is_self := v_decision\.requested_by = v_uid or exists/)
    expect(sql).toMatch(/r\.recorded_by = v_uid/)
    expect(sql).toMatch(/if v_is_self and not project_self_approval_allowed/)
    expect(sql).toMatch(/v_waiver\.requested_by = v_uid and not project_self_approval_allowed/)
  })

  it('applies the policy’s approvals and keeps a snapshot of what the decision rested on', () => {
    expect(sql).toMatch(/greatest\(coalesce\(v_policy\.minimum_approvals, 1\), 1\), coalesce\(v_policy\.approval_mode, 'any_authorized'\)/)
    expect(sql).toMatch(/v_policy\.requirement_status = 'not_applicable'/)
    expect(sql).toMatch(/snapshot = solution_baseline_snapshot\(v_decision\.baseline_id\)/)
    expect(sql).toMatch(/a decided record cannot change/)
  })

  it('writes waivers and decisions only through the functions, with per-command baseline policies and MCP read-only', () => {
    expect(sql).not.toMatch(/on solution_(waivers|conformance_decisions|conformance_decision_approvals)\s+for (insert|update|delete|all)/)
    expect(sql).not.toMatch(/^\s+for all /m)
    expect(sql).toMatch(/execute format\('revoke execute on function %s from public, anon', fn\)/)
    expect(sql).toMatch(/perform apply_oauth_read_only_policies\(\);/)
  })
})
