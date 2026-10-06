import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const {
  createRequirement,
  updateRequirement,
  removeRequirementSource,
  addVerificationMethod,
  withdrawRequirement,
  deleteDraftRequirement,
  acceptDraftedRequirement,
  nextRequirementCode,
  listRequirements,
  RequirementValidationError,
} = await import('./requirements')

type Queued = Parameters<typeof createFakeSupabase>[0]

function makeCtx(queued: Queued, { role = 'consultant', projectRole = 'curator' as string | null } = {}) {
  const supabase = createFakeSupabase({ project_members: [{ data: projectRole ? { role: projectRole } : null, error: null }], ...queued })
  return { supabase, ctx: { user: { id: 'user-1' }, profile: { role }, supabase } as unknown as WorkbenchCallerContext }
}
const inserts = (s: ReturnType<typeof createFakeSupabase>, table: string) =>
  s._calls.filter((c) => c.table === table && c.method === 'insert').map((c) => c.args)
const deletes = (s: ReturnType<typeof createFakeSupabase>, table: string) => s._calls.filter((c) => c.table === table && c.method === 'delete')

const fields = {
  code: 'NG911-LOC-001',
  title: 'Caller location delivery',
  statement: 'The call-handling system shall pass caller location to K-Dispatch per NENA i3.',
  category: 'interface' as const,
  priority: 'must' as const,
  appliesFrom: 'deployment' as const,
}
const draft = { id: 'req-1', project_id: 'p1', code: 'NG911-LOC-001', status: 'draft' }

describe('createRequirement', () => {
  it('creates a draft with its sources and scope, as the caller', async () => {
    const { supabase, ctx } = makeCtx({
      solution_requirements: [{ data: { id: 'req-1' }, error: null }],
      solution_requirement_sources: [{ data: null, error: null }],
      solution_requirement_scope_links: [{ data: null, error: null }, { data: null, error: null }],
    })
    const result = await createRequirement(ctx, 'p1', {
      ...fields,
      sources: [
        { kind: 'standard', knowledgeSourceId: 'src-nena', locator: ' NENA-STA-010 §4.2 ' },
        { kind: 'vendor_claim', locator: 'KabatOne proposal p.12: "fully i3 conformant"' },
      ],
      workstreamIds: ['ws-mitel', 'ws-mitel'],
      objectIds: ['obj-call'],
    })

    expect(result).toEqual({ requirementId: 'req-1', code: 'NG911-LOC-001' })
    expect(inserts(supabase, 'solution_requirements')[0]).toMatchObject({ project_id: 'p1', code: 'NG911-LOC-001', category: 'interface', created_by: 'user-1' })
    expect(inserts(supabase, 'solution_requirement_sources')[0]).toEqual([
      expect.objectContaining({ requirement_id: 'req-1', kind: 'standard', knowledge_source_id: 'src-nena', locator: 'NENA-STA-010 §4.2' }),
      expect.objectContaining({ kind: 'vendor_claim', knowledge_source_id: null }),
    ])
    expect(inserts(supabase, 'solution_requirement_scope_links')[0]).toEqual([
      { requirement_id: 'req-1', project_id: 'p1', workstream_id: 'ws-mitel' },
      { requirement_id: 'req-1', project_id: 'p1', project_object_id: 'obj-call' },
    ])
  })

  it('needs at least one origin, a named requester for a customer need, and a pointer for other sources', async () => {
    const cases = [
      { sources: [] },
      { sources: [{ kind: 'customer_need' as const }] },
      { sources: [{ kind: 'standard' as const }] },
    ]
    for (const c of cases) {
      const { ctx } = makeCtx({})
      await expect(createRequirement(ctx, 'p1', { ...fields, ...c })).rejects.toBeInstanceOf(RequirementValidationError)
    }
  })

  it('suggests the next REQ code when the code is left blank', async () => {
    const { supabase, ctx } = makeCtx({
      solution_requirements: [{ data: [{ code: 'REQ-002' }, { code: 'NG911-X' }, { code: 'REQ-010' }], error: null }, { data: { id: 'req-9' }, error: null }],
      solution_requirement_sources: [{ data: null, error: null }],
    })
    await createRequirement(ctx, 'p1', { ...fields, code: '', sources: [{ kind: 'customer_need', requester: 'CCDRRMO ops chief' }] })
    expect(inserts(supabase, 'solution_requirements')[0]).toMatchObject({ code: 'REQ-011' })
  })

  it('removes the requirement again if its sources cannot be saved, and explains a duplicate code', async () => {
    const { supabase, ctx } = makeCtx({
      solution_requirements: [{ data: { id: 'req-1' }, error: null }],
      solution_requirement_sources: [{ data: null, error: Object.assign(new Error('boom'), { code: 'XX000' }) }],
    })
    await expect(createRequirement(ctx, 'p1', { ...fields, sources: [{ kind: 'standard', locator: '§1' }] })).rejects.toThrow('boom')
    expect(deletes(supabase, 'solution_requirements')).toHaveLength(1)

    const dup = makeCtx({ solution_requirements: [{ data: null, error: Object.assign(new Error('dup'), { code: '23505' }) }] })
    await expect(createRequirement(dup.ctx, 'p1', { ...fields, sources: [{ kind: 'standard', locator: '§1' }] })).rejects.toThrow('already used')
  })

  it('is refused to anyone but a Project owner/curator or platform admin', async () => {
    const { supabase, ctx } = makeCtx({}, { projectRole: 'consultant' })
    await expect(createRequirement(ctx, 'p1', { ...fields, sources: [{ kind: 'standard', locator: '§1' }] })).rejects.toThrow('owner or curator')
    expect(inserts(supabase, 'solution_requirements')).toEqual([])
  })
})

describe('editing a requirement', () => {
  it('edits only a draft', async () => {
    const baselined = makeCtx({ solution_requirements: [{ data: { ...draft, status: 'baselined' }, error: null }] })
    await expect(updateRequirement(baselined.ctx, 'req-1', fields)).rejects.toThrow('Only a draft requirement can be edited')
  })

  it('keeps at least one source', async () => {
    const { ctx } = makeCtx({
      solution_requirement_sources: [{ data: { requirement_id: 'req-1' }, error: null }, { data: null, error: null }],
      solution_requirements: [{ data: draft, error: null }],
    })
    // The fake returns count undefined for the head count -> treated as 0.
    await expect(removeRequirementSource(ctx, 'src-row-1')).rejects.toThrow('at least one source')
  })

  it('needs a threshold and window for an operational measure', async () => {
    const { ctx } = makeCtx({ solution_requirements: [{ data: draft, error: null }] })
    await expect(
      addVerificationMethod(ctx, 'req-1', { method: 'operational_measure', passCriteria: 'Calls answered on time', performedBy: 'customer' })
    ).rejects.toThrow('threshold')
  })

  it('withdraws an open requirement but not a closed one', async () => {
    const open = makeCtx({ solution_requirements: [{ data: { ...draft, status: 'baselined' }, error: null }, { data: null, error: null }] })
    expect(await withdrawRequirement(open.ctx, 'req-1')).toEqual({ projectId: 'p1' })
    expect(open.supabase._calls.find((c) => c.table === 'solution_requirements' && c.method === 'update')?.args).toEqual({ status: 'withdrawn' })

    const closed = makeCtx({ solution_requirements: [{ data: { ...draft, status: 'withdrawn' }, error: null }] })
    await expect(withdrawRequirement(closed.ctx, 'req-1')).rejects.toThrow('already closed')
  })

  it('refuses to delete a draft that has verification results, pointing to withdraw', async () => {
    const { ctx } = makeCtx({
      solution_requirements: [
        { data: draft, error: null },
        { data: null, error: Object.assign(new Error('update or delete on table "solution_requirements" violates foreign key constraint "solution_verification_records_requirement_id_fkey"'), { code: '23503' }) },
      ],
    })
    await expect(deleteDraftRequirement(ctx, 'req-1')).rejects.toThrow('This requirement has verification results, so it can’t be deleted. Withdraw it instead.')
  })
})

describe('Ember drafts (Stage 5)', () => {
  it('marks a requirement Ember drafted, with the conversation it came from, and saves its methods', async () => {
    const { supabase, ctx } = makeCtx({
      solution_requirements: [{ data: { id: 'req-1' }, error: null }],
      solution_requirement_sources: [{ data: null, error: null }],
      solution_requirement_scope_links: [{ data: null, error: null }],
      solution_verification_methods: [{ data: null, error: null }],
    })
    await createRequirement(
      ctx,
      'p1',
      { ...fields, sources: [{ kind: 'standard', locator: '§4.2' }] },
      { createdVia: 'assistant', conversationId: 'conv-1', methods: [{ method: 'test', passCriteria: '20/20', performedBy: 'integrator' }] }
    )
    expect(inserts(supabase, 'solution_requirements')[0]).toMatchObject({ created_via: 'assistant', assistant_conversation_id: 'conv-1' })
    expect(inserts(supabase, 'solution_verification_methods')[0]).toEqual([expect.objectContaining({ requirement_id: 'req-1', pass_criteria: '20/20', created_via: 'assistant' })])
  })

  it('lets a curator accept only a draft that is awaiting acceptance', async () => {
    const waiting = makeCtx({ solution_requirements: [{ data: { ...draft, awaiting_acceptance: true }, error: null }, { data: null, error: null }] })
    await acceptDraftedRequirement(waiting.ctx, 'req-1')
    expect(waiting.supabase._calls.find((c) => c.table === 'solution_requirements' && c.method === 'update')?.args).toEqual({ awaiting_acceptance: false })

    const accepted = makeCtx({ solution_requirements: [{ data: { ...draft, awaiting_acceptance: false }, error: null }] })
    await expect(acceptDraftedRequirement(accepted.ctx, 'req-1')).rejects.toThrow('This requirement is not awaiting acceptance')

    const consultant = makeCtx({ solution_requirements: [{ data: { ...draft, awaiting_acceptance: true }, error: null }] }, { projectRole: 'consultant' })
    await expect(acceptDraftedRequirement(consultant.ctx, 'req-1')).rejects.toThrow(/owner or curator/)
  })
})

describe('reading the register', () => {
  it('rolls up source kinds, method counts and scope names per requirement', async () => {
    const supabase = createFakeSupabase({
      solution_requirements: [{ data: [{ id: 'req-1', code: 'A' }, { id: 'req-2', code: 'B' }], error: null }],
      solution_requirement_sources: [{ data: [{ requirement_id: 'req-1', kind: 'standard' }, { requirement_id: 'req-1', kind: 'standard' }, { requirement_id: 'req-1', kind: 'vendor_claim' }], error: null }],
      solution_verification_methods: [{ data: [{ requirement_id: 'req-1' }], error: null }],
      solution_requirement_scope_links: [{ data: [{ requirement_id: 'req-2', workstream_id: 'ws-1', project_object_id: null }], error: null }],
      project_workstreams: [{ data: [{ id: 'ws-1', name: 'Mitel PBX Integration' }], error: null }],
      project_objects: [{ data: [], error: null }],
    })
    const rows = await listRequirements(supabase as never, 'p1')
    expect(rows[0]).toMatchObject({ sourceKinds: ['standard', 'vendor_claim'], methodCount: 1, workstreamNames: [] })
    expect(rows[1]).toMatchObject({ sourceKinds: [], methodCount: 0, workstreamNames: ['Mitel PBX Integration'] })
  })

  it('numbers new codes after the highest REQ code', async () => {
    const supabase = createFakeSupabase({ solution_requirements: [{ data: [], error: null }] })
    expect(await nextRequirementCode(supabase as never, 'p1')).toBe('REQ-001')
  })
})

describe('solution_requirements migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261017100001_solution_requirements.sql'), 'utf-8')

  it('lets every member read the register and only Project curators write it', () => {
    expect(sql).toMatch(/create policy "solution_requirements_select_member" on solution_requirements\s+for select using \(is_project_member\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).toMatch(/for insert with check \(can_curate_project\(project_id, auth\.uid\(\)\) and created_by = auth\.uid\(\) and status = 'draft'\)/)
    expect(sql).toMatch(/for delete using \(can_curate_project\(project_id, auth\.uid\(\)\) and status = 'draft'\)/)
  })

  it('freezes content once a requirement leaves draft, for the requirement and its children', () => {
    expect(sql).toMatch(/only a draft requirement can be edited/)
    expect(sql).toMatch(/cannot be reopened/)
    for (const t of ['solution_requirement_sources', 'solution_requirement_scope_links', 'solution_verification_methods']) {
      for (const op of ['insert', 'update', 'delete']) {
        expect(sql).toMatch(new RegExp(`create policy "${t}_${op}_curator_draft" on ${t}\\s+for ${op}`))
      }
    }
  })

  it('hides restricted sources from everyone without a grant -- no "for all" policy that would also grant select', () => {
    expect(sql).toMatch(/has_evidence_access\('knowledge_source', knowledge_source_id, auth\.uid\(\)\)/)
    expect(sql).toMatch(/has_evidence_access\('wiki_article', wiki_article_id, auth\.uid\(\)\)/)
    expect(sql).not.toMatch(/^\s+for all /m)
  })

  it('keeps children inside their requirement’s Project and records the cited source version', () => {
    expect(sql).toMatch(/must belong to its requirement''s Project/)
    expect(sql).toMatch(/the workstream must be in this Project/)
    expect(sql).toMatch(/select current_version_id into new\.document_version_id from knowledge_sources/)
  })
})
