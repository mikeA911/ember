import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createFakeSupabase({ profiles: [{ data: [], error: null }] }) }))
const createProjectNoteMock = vi.fn(async () => ({ noteId: 'note-1' }))
vi.mock('@/lib/projects/notes', () => ({ createProjectNote: (...args: unknown[]) => createProjectNoteMock(...(args as [])) }))

const { requirementsAffectedBy, descendantObjectIds } = await import('./reverification-scope')
const { recordChange, resolveReverification, setReviewInterval, listReverificationEvents } = await import('./reverification')
const { RequirementValidationError } = await import('./requirements')
const { AuthError } = await import('@/lib/auth')

type Queued = Parameters<typeof createFakeSupabase>[0]
function makeCtx(queued: Queued, { projectRole = 'consultant' as string | null, rpc = { data: 'ev-1' as unknown, error: null as unknown } } = {}) {
  const fake = createFakeSupabase({ project_members: [{ data: projectRole ? { role: projectRole } : null, error: null }], ...queued })
  const rpcMock = vi.fn(async () => rpc)
  const supabase = { ...fake, rpc: rpcMock }
  return { fake, rpcMock, ctx: { user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase } as unknown as WorkbenchCallerContext }
}

describe('which requirements a change affects', () => {
  const objects = [
    { id: 'kd', parentId: null },
    { id: 'kd-db', parentId: 'kd' },
    { id: 'kd-db-replica', parentId: 'kd-db' },
    { id: 'mitel', parentId: null },
  ]
  const requirements = [
    { id: 'r1', objectIds: ['kd'], workstreamIds: [] },
    { id: 'r2', objectIds: ['kd-db-replica'], workstreamIds: [] },
    { id: 'r3', objectIds: ['mitel'], workstreamIds: ['ws-pbx'] },
    { id: 'r4', objectIds: [], workstreamIds: [] },
  ]

  it('includes requirements scoped to the component or any sub-component', () => {
    expect([...descendantObjectIds('kd', objects)].sort()).toEqual(['kd', 'kd-db', 'kd-db-replica'])
    expect(requirementsAffectedBy({ objectId: 'kd' }, requirements, objects)).toEqual(['r1', 'r2'])
    expect(requirementsAffectedBy({ objectId: 'kd-db' }, requirements, objects)).toEqual(['r2'])
  })

  it('includes requirements scoped to the workstream, and nothing when neither is chosen', () => {
    expect(requirementsAffectedBy({ workstreamId: 'ws-pbx' }, requirements, objects)).toEqual(['r3'])
    expect(requirementsAffectedBy({}, requirements, objects)).toEqual([])
  })
})

describe('recording a change', () => {
  const input = { kind: 'component_change' as const, summary: ' K-Dispatch upgraded ', changeReference: '4.2.1 → 4.3.0', requirementIds: ['r1', 'r1', ''] }

  it('records through the database and tells the owners and curators', async () => {
    createProjectNoteMock.mockClear()
    const { rpcMock, ctx } = makeCtx({
      project_members: [{ data: { role: 'consultant' }, error: null }, { data: [{ user_id: 'cur-1' }, { user_id: 'user-1' }], error: null }],
    })
    expect(await recordChange(ctx, 'p1', { ...input, objectId: 'kd' })).toEqual({ projectId: 'p1', eventId: 'ev-1' })
    expect(rpcMock).toHaveBeenCalledWith('record_solution_reverification_event', {
      p_project_id: 'p1',
      p_kind: 'component_change',
      p_summary: 'K-Dispatch upgraded',
      p_requirement_ids: ['r1'],
      p_change_reference: '4.2.1 → 4.3.0',
      p_detail: null,
      p_project_object_id: 'kd',
      p_workstream_id: null,
    })
    expect(createProjectNoteMock).toHaveBeenCalledTimes(1)
    expect(createProjectNoteMock.mock.calls[0]).toEqual([
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ recipientUserId: 'cur-1', contextType: 'solution_reverification', contextId: 'ev-1' }),
    ])
  })

  it('refuses viewers, and a change with no description or no affected requirement', async () => {
    const viewer = makeCtx({}, { projectRole: 'viewer' })
    await expect(recordChange(viewer.ctx, 'p1', input)).rejects.toBeInstanceOf(AuthError)
    for (const bad of [{ ...input, summary: ' ' }, { ...input, requirementIds: [] }]) {
      const { rpcMock, ctx } = makeCtx({})
      await expect(recordChange(ctx, 'p1', bad)).rejects.toBeInstanceOf(RequirementValidationError)
      expect(rpcMock).not.toHaveBeenCalled()
    }
  })

  it('shows the database’s refusal without the function name', async () => {
    const { ctx } = makeCtx({}, { rpc: { data: null, error: { message: 'record_solution_reverification_event: affected requirements must be open requirements of this Project' } } })
    await expect(recordChange(ctx, 'p1', input)).rejects.toThrow('Affected requirements must be open requirements of this Project')
  })
})

describe('resolving and review schedules', () => {
  it('needs a reason to resolve without re-verifying', async () => {
    const { rpcMock, ctx } = makeCtx({ solution_reverification_event_requirements: [{ data: { project_id: 'p1' }, error: null }] })
    await expect(resolveReverification(ctx, 'l1', '  ')).rejects.toThrow('Say why no re-verification is needed')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('lets curators set a 1–120 month schedule on an open requirement', async () => {
    const consultant = makeCtx({ solution_requirements: [{ data: { project_id: 'p1', status: 'baselined' }, error: null }] })
    await expect(setReviewInterval(consultant.ctx, 'r1', 6)).rejects.toBeInstanceOf(AuthError)

    const bad = makeCtx({ solution_requirements: [{ data: { project_id: 'p1', status: 'baselined' }, error: null }] }, { projectRole: 'curator' })
    await expect(setReviewInterval(bad.ctx, 'r1', 0)).rejects.toThrow('Choose between 1 and 120 months')

    const { fake, ctx } = makeCtx({ solution_requirements: [{ data: { project_id: 'p1', status: 'baselined' }, error: null }] }, { projectRole: 'curator' })
    await setReviewInterval(ctx, 'r1', 12)
    expect(fake._calls.find((c) => c.table === 'solution_requirements' && c.method === 'update')?.args).toEqual({ review_interval_months: 12 })
  })
})

describe('the change history', () => {
  it('shows each affected requirement as open, re-verified, resolved or closed', async () => {
    const supabase = createFakeSupabase({
      solution_reverification_event_requirements: [
        {
          data: [
            { id: 'l1', event_id: 'e1', requirement_id: 'r1', resolved_at: null, resolution_note: null, resolved_by: null },
            { id: 'l2', event_id: 'e1', requirement_id: 'r2', resolved_at: null, resolution_note: null, resolved_by: null },
            { id: 'l3', event_id: 'e1', requirement_id: 'r3', resolved_at: '2026-10-06T00:00:00Z', resolution_note: 'No impact', resolved_by: null },
            { id: 'l4', event_id: 'e1', requirement_id: 'r4', resolved_at: null, resolution_note: null, resolved_by: null },
          ],
          error: null,
        },
      ],
      solution_reverification_events: [{ data: [{ id: 'e1', kind: 'component_change', created_at: '2026-10-06T00:00:00Z' }], error: null }],
      solution_requirements: [
        {
          data: [
            { id: 'r1', code: 'REQ-001', title: 'A', status: 'baselined' },
            { id: 'r2', code: 'REQ-002', title: 'B', status: 'baselined' },
            { id: 'r3', code: 'REQ-003', title: 'C', status: 'baselined' },
            { id: 'r4', code: 'REQ-004', title: 'D', status: 'withdrawn' },
          ],
          error: null,
        },
      ],
    })
    const due = new Map([['r1', { openEventIds: ['e1'], reviewDue: false }]])
    const [event] = await listReverificationEvents(supabase as never, 'p1', { due })
    expect(event.requirements.map((r) => [r.code, r.state])).toEqual([
      ['REQ-001', 'open'],
      ['REQ-002', 'reverified'],
      ['REQ-003', 'resolved'],
      ['REQ-004', 'closed'],
    ])
  })
})

describe('solution_reverification migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261021100001_solution_reverification.sql'), 'utf-8')

  it('keeps an event open until every method has a real result recorded after it, or a curator resolves it', () => {
    expect(sql).toMatch(/l\.resolved_at is null/)
    expect(sql).toMatch(/r\.method_id = m\.id and r\.result <> 'not_run' and r\.recorded_at > e\.created_at/)
    expect(sql).toMatch(/say why no re-verification is needed/)
    expect(sql).toMatch(/not can_curate_project\(v_link\.project_id, v_uid\)/)
  })

  it('flags new source versions and operational measures outside their threshold automatically, never blocking the upload', () => {
    expect(sql).toMatch(/after update of current_version_id on knowledge_sources/)
    expect(sql).toMatch(/s\.document_version_id is distinct from new\.current_version_id/)
    expect(sql).toMatch(/exception when others then\s+raise warning/)
    expect(sql).toMatch(/new\.method_kind = 'operational_measure' and new\.result = 'fail'/)
  })

  it('blocks a production-change approval while anything in the baseline is due', () => {
    expect(sql).toMatch(/p_approve and v_decision\.approval_type = 'production_change' and exists/)
    expect(sql).toMatch(/need re-verification before a production change can be approved/)
  })

  it('reads due status only for members, keeps the helpers internal, and has no write policies', () => {
    expect(sql).toMatch(/and is_project_member\(p_project_id, auth\.uid\(\)\)/)
    expect(sql).toMatch(/'revoke execute on function %s from public, anon, authenticated'/)
    expect(sql).not.toMatch(/on solution_reverification_(events|event_requirements)\s+for (insert|update|delete|all)/)
    expect(sql).toMatch(/perform apply_oauth_read_only_policies\(\);/)
  })
})
