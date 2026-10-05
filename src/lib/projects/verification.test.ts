import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createFakeSupabase({ profiles: [{ data: [], error: null }] }) }))

const { rollUpVerification, currentResultByMethod, effectiveRecords, recordVerification } = await import('./verification')
const { RequirementValidationError } = await import('./requirements')
const { AuthError } = await import('@/lib/auth')

let seq = 0
function rec(methodId: string | null, result: string, performedOn = '2026-10-01', extra: Record<string, unknown> = {}) {
  seq += 1
  return { id: `r${seq}`, method_id: methodId, result, performed_on: performedOn, recorded_at: `2026-10-05T00:00:${String(seq).padStart(2, '0')}Z`, supersedes_id: null, ...extra } as never
}

describe('verification roll-up', () => {
  it('reports no method, and not verified until a method has a result', () => {
    expect(rollUpVerification([], [])).toBe('no_method')
    expect(rollUpVerification(['m1'], [])).toBe('not_verified')
  })

  it('fails on any current fail, passes only when every method passed or does not apply', () => {
    expect(rollUpVerification(['m1', 'm2'], [rec('m1', 'pass'), rec('m2', 'fail')])).toBe('failed')
    expect(rollUpVerification(['m1', 'm2'], [rec('m1', 'pass'), rec('m2', 'not_applicable')])).toBe('passed')
    expect(rollUpVerification(['m1', 'm2'], [rec('m1', 'pass'), rec('m2', 'conditional_pass')])).toBe('conditional')
    expect(rollUpVerification(['m1', 'm2'], [rec('m1', 'pass')])).toBe('partial')
    expect(rollUpVerification(['m1'], [rec('m1', 'not_run')])).toBe('partial')
    expect(rollUpVerification(['m1'], [rec('m1', 'not_applicable')])).toBe('not_applicable')
  })

  it('uses the latest result performed for each method, and ignores records of removed methods', () => {
    const older = rec('m1', 'fail', '2026-09-01')
    const newer = rec('m1', 'pass', '2026-10-01')
    expect(rollUpVerification(['m1'], [newer, older])).toBe('passed')
    expect(rollUpVerification(['m1'], [rec(null, 'fail', '2026-10-04'), newer])).toBe('passed')
  })

  it('takes a correction in place of the record it supersedes, whatever its date', () => {
    const original = rec('m1', 'pass', '2026-10-01')
    const correction = rec('m1', 'fail', '2026-10-01', { supersedes_id: (original as { id: string }).id })
    expect(effectiveRecords([original, correction])).toEqual([correction])
    expect(currentResultByMethod([original, correction]).get('m1')).toBe(correction)
    expect(rollUpVerification(['m1'], [original, correction])).toBe('failed')
  })
})

describe('recordVerification', () => {
  type Queued = Parameters<typeof createFakeSupabase>[0]
  function makeCtx(queued: Queued = {}, { projectRole = 'consultant' as string | null, rpc = { data: 'rec-1' as string | null, error: null as unknown } } = {}) {
    const fake = createFakeSupabase({
      solution_requirements: [{ data: { project_id: 'p1' }, error: null }],
      project_members: [{ data: projectRole ? { role: projectRole } : null, error: null }],
      ...queued,
    })
    const rpcMock = vi.fn(async () => rpc)
    const supabase = { ...fake, rpc: rpcMock }
    return { rpcMock, ctx: { user: { id: 'user-1' }, profile: { role: 'member' }, supabase } as unknown as WorkbenchCallerContext }
  }
  const input = {
    methodId: 'm1',
    result: 'pass' as const,
    environment: 'site' as const,
    solutionReference: ' K-Dispatch 4.2.1, Mitel MX-ONE 7.4 ',
    performedOn: '2026-10-04',
    artifactIds: ['a1', 'a1', ''],
  }

  it('records through the database function, trimmed, with each artifact once', async () => {
    const { rpcMock, ctx } = makeCtx()
    expect(await recordVerification(ctx, 'req-1', { ...input, observations: '20 of 20 calls located' })).toEqual({ projectId: 'p1', recordId: 'rec-1' })
    expect(rpcMock).toHaveBeenCalledWith('record_solution_verification', expect.objectContaining({
      p_requirement_id: 'req-1',
      p_method_id: 'm1',
      p_result: 'pass',
      p_environment: 'site',
      p_solution_reference: 'K-Dispatch 4.2.1, Mitel MX-ONE 7.4',
      p_artifact_ids: ['a1'],
      p_observations: '20 of 20 calls located',
      p_supersedes_id: null,
    }))
  })

  it('lets consultants, curators and owners record, never viewers', async () => {
    const { rpcMock, ctx } = makeCtx({}, { projectRole: 'viewer' })
    await expect(recordVerification(ctx, 'req-1', input)).rejects.toBeInstanceOf(AuthError)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('rejects a pass without evidence, a conditional pass without conditions and n/a without a rationale', async () => {
    const cases = [
      { ...input, artifactIds: [] },
      { ...input, result: 'conditional_pass' as const },
      { ...input, result: 'not_applicable' as const, artifactIds: [] },
      { ...input, solutionReference: '  ' },
    ]
    for (const c of cases) {
      const { rpcMock, ctx } = makeCtx()
      await expect(recordVerification(ctx, 'req-1', c)).rejects.toBeInstanceOf(RequirementValidationError)
      expect(rpcMock).not.toHaveBeenCalled()
    }
  })

  it('allows a fail or not-run without evidence', async () => {
    const { rpcMock, ctx } = makeCtx()
    await recordVerification(ctx, 'req-1', { ...input, result: 'fail', artifactIds: [], observations: '2 of 20 lost location' })
    expect(rpcMock).toHaveBeenCalled()
  })

  it('turns the database refusals into clear messages', async () => {
    const { ctx } = makeCtx({}, { rpc: { data: null, error: { message: 'record_solution_verification: that record has already been corrected' } } })
    await expect(recordVerification(ctx, 'req-1', { ...input, supersedesId: 'rec-0' })).rejects.toThrow('That record has already been corrected. Correct the newer record instead.')
    const closed = makeCtx({}, { rpc: { data: null, error: { message: 'record_solution_verification: this requirement is closed -- it no longer takes verification results' } } })
    await expect(recordVerification(closed.ctx, 'req-1', input)).rejects.toThrow(/no longer takes verification results/)
  })
})

describe('solution_verification_records migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261019100001_solution_verification_records.sql'), 'utf-8')

  it('is append-only: read policies only, writes through the function, updates refused', () => {
    expect(sql).toMatch(/create policy "solution_verification_records_select_member" on solution_verification_records\s+for select using \(is_project_member\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).not.toMatch(/on solution_verification_(records|evidence)\s+for (insert|update|delete|all)/)
    expect(sql).toMatch(/records are append-only -- record a correction that supersedes it/)
    expect(sql).toMatch(/create unique index if not exists solution_verification_records_supersedes_uniq/)
  })

  it('requires evidence for a pass, and evidence the recorder can see from this Project', () => {
    expect(sql).toMatch(/p_result in \('pass', 'conditional_pass'\) and cardinality\(v_artifact_ids\) = 0/)
    expect(sql).toMatch(/w\.project_id = v_requirement\.project_id\s+and has_evidence_access\('workstream_artifact', a\.id, v_uid\)/)
  })

  it('limits recording to owners, curators and consultants on an open requirement, and copies what it was judged against', () => {
    expect(sql).toMatch(/not can_run_project_evals\(v_requirement\.project_id, v_uid\)/)
    expect(sql).toMatch(/v_requirement\.status not in \('draft', 'baselined'\)/)
    expect(sql).toMatch(/v_method\.method, v_method\.pass_criteria, v_method\.threshold, v_method\.measure_window/)
  })

  it('hides restricted evidence, keeps requirements with results from being deleted, and stays read-only for MCP tokens', () => {
    expect(sql).toMatch(/workstream_artifact_id is null or has_evidence_access\('workstream_artifact', workstream_artifact_id, auth\.uid\(\)\)/)
    expect(sql).toMatch(/requirement_id uuid not null references solution_requirements\(id\),/)
    expect(sql).toMatch(/revoke execute on function record_solution_verification\(uuid, uuid, text, text, text, date, uuid\[\], text, text, text, text, text, text, uuid\) from public, anon;/)
    expect(sql).toMatch(/perform apply_oauth_read_only_policies\(\);/)
  })
})
