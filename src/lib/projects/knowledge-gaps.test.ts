import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const {
  reportEmberAnswer,
  reportTypedFailure,
  listKnowledgeGaps,
  triageKnowledgeGap,
  resolveKnowledgeGap,
  promoteKnowledgeGapToEvalCase,
  convertKnowledgeGapToFeedback,
  addKnowledgeGapOccurrenceDetails,
  withdrawKnowledgeGapOccurrence,
  KnowledgeGapValidationError,
} = await import('./knowledge-gaps')

type Queued = Parameters<typeof createFakeSupabase>[0]

function makeCtx(queued: Queued, { role = 'consultant', userId = 'user-1' }: { role?: string; userId?: string } = {}) {
  const supabase = createFakeSupabase(queued)
  return { supabase, ctx: { user: { id: userId }, profile: { role }, supabase } as unknown as WorkbenchCallerContext }
}

const inserts = (supabase: ReturnType<typeof createFakeSupabase>, table: string) =>
  supabase._calls.filter((c) => c.table === table && c.method === 'insert').map((c) => c.args as Record<string, unknown>)
const updates = (supabase: ReturnType<typeof createFakeSupabase>, table: string) =>
  supabase._calls.filter((c) => c.table === table && c.method === 'update').map((c) => c.args as Record<string, unknown>)

function gap(overrides: Record<string, unknown> = {}) {
  return {
    id: 'gap-1',
    project_id: 'p1',
    question: 'How are Mitel SIP trunks configured?',
    status: 'new',
    reported_by: 'reporter-1',
    eval_case_id: null,
    feedback_report_id: null,
    correct_answer: null,
    resolution_note: null,
    resolving_source_id: null,
    resolving_article_id: null,
    ember_answer: 'Mitel uses …',
    details: 'Made up the port numbers',
    answer_provider: 'groq',
    answer_model: 'gpt-oss',
    ...overrides,
  }
}

describe('reportEmberAnswer', () => {
  it('attaches the question, answer, verified citations and model from the stored conversation, then notifies the curators', async () => {
    const { supabase, ctx } = makeCtx({
      chat_messages: [
        {
          data: {
            id: 'msg-a',
            conversation_id: 'conv-1',
            role: 'assistant',
            content: 'plain fallback',
            provider: 'groq',
            model: 'gpt-oss',
            response_payload: {
              message: 'Mitel trunks use port 5060 …',
              citations: [
                { label: 'NENA i3', sourceType: 'knowledge_source', sourceId: 'src-1', layer: 'project' },
                { label: 'broken' },
              ],
            },
          },
          error: null,
        },
        {
          data: [
            { id: 'm1', role: 'user', content: 'Earlier question' },
            { id: 'm2', role: 'assistant', content: 'Earlier answer' },
            { id: 'm3', role: 'user', content: 'How are Mitel SIP trunks configured?' },
            { id: 'm4', role: 'tool', content: '{}' },
            { id: 'msg-a', role: 'assistant', content: 'plain fallback' },
          ],
          error: null,
        },
      ],
      conversations: [{ data: { id: 'conv-1', project_id: 'p1' }, error: null }],
      project_knowledge_gaps: [{ data: { id: 'gap-1' }, error: null }],
      project_members: [{ data: [{ user_id: 'curator-1' }, { user_id: 'user-1' }], error: null }],
      project_notes: [{ data: { id: 'note-1' }, error: null }],
    })

    const result = await reportEmberAnswer(ctx, 'msg-a', { failureKind: 'wrong', details: ' Made up the port ', correctAnswer: '', suggestedSource: 'Mitel admin guide' })

    expect(result).toEqual({ gapId: 'gap-1', projectId: 'p1' })
    expect(inserts(supabase, 'project_knowledge_gaps')[0]).toEqual({
      project_id: 'p1',
      question: 'How are Mitel SIP trunks configured?',
      ember_answer: 'Mitel trunks use port 5060 …',
      failure_kind: 'wrong',
      details: 'Made up the port',
      correct_answer: null,
      suggested_source: 'Mitel admin guide',
      conversation_id: 'conv-1',
      message_id: 'msg-a',
      answer_provider: 'groq',
      answer_model: 'gpt-oss',
      cited_sources: [{ label: 'NENA i3', sourceType: 'knowledge_source', sourceId: 'src-1' }],
      reported_by: 'user-1',
    })
    // The reporter is never notified about their own report.
    const notes = inserts(supabase, 'project_notes')
    expect(notes).toHaveLength(1)
    expect(notes[0]).toMatchObject({ recipient_user_id: 'curator-1', context_type: 'knowledge_gap', context_id: 'gap-1' })
  })

  it('refuses an answer outside a Project conversation, and anything that is not an Ember answer', async () => {
    const unbound = makeCtx({
      chat_messages: [{ data: { id: 'msg-a', conversation_id: 'conv-1', role: 'assistant', content: 'x', response_payload: null }, error: null }],
      conversations: [{ data: { id: 'conv-1', project_id: null }, error: null }],
    })
    await expect(reportEmberAnswer(unbound.ctx, 'msg-a', { failureKind: 'wrong', details: '' })).rejects.toThrow('Project conversation')

    const userMessage = makeCtx({ chat_messages: [{ data: { id: 'm1', conversation_id: 'conv-1', role: 'user', content: 'x' }, error: null }] })
    await expect(reportEmberAnswer(userMessage.ctx, 'm1', { failureKind: 'wrong', details: '' })).rejects.toThrow('could not be found')

    const badKind = makeCtx({})
    await expect(reportEmberAnswer(badKind.ctx, 'm1', { failureKind: 'nope' as never, details: '' })).rejects.toBeInstanceOf(KnowledgeGapValidationError)
  })
})

describe('reportTypedFailure', () => {
  it('requires the question and files the report as the caller', async () => {
    const empty = makeCtx({})
    await expect(reportTypedFailure(empty.ctx, 'p1', { question: '  ', failureKind: 'could_not_answer', details: '' })).rejects.toThrow('Type the question')

    const { supabase, ctx } = makeCtx({
      project_knowledge_gaps: [{ data: { id: 'gap-2' }, error: null }],
      project_members: [{ data: [], error: null }],
    })
    await reportTypedFailure(ctx, 'p1', { question: 'What AVL protocol does the radio fleet use?', failureKind: 'could_not_answer', details: '' })
    expect(inserts(supabase, 'project_knowledge_gaps')[0]).toMatchObject({
      project_id: 'p1',
      question: 'What AVL protocol does the radio fleet use?',
      failure_kind: 'could_not_answer',
      reported_by: 'user-1',
    })
  })
})

describe('listKnowledgeGaps', () => {
  it('puts open gaps first, keeping newest-first order within each group', async () => {
    const { supabase } = makeCtx({
      project_knowledge_gaps: [
        {
          data: [
            { id: 'a', status: 'resolved' },
            { id: 'b', status: 'new' },
            { id: 'c', status: 'duplicate' },
            { id: 'd', status: 'needs_source' },
          ],
          error: null,
        },
      ],
    })
    expect((await listKnowledgeGaps(supabase as never, 'p1')).map((g) => g.id)).toEqual(['b', 'd', 'a', 'c'])
  })
})

describe('triageKnowledgeGap', () => {
  it('is refused to anyone but a Project owner/curator or platform admin', async () => {
    const { supabase, ctx } = makeCtx({
      project_knowledge_gaps: [{ data: gap(), error: null }],
      project_members: [{ data: { role: 'consultant' }, error: null }],
    })
    await expect(triageKnowledgeGap(ctx, 'gap-1', { status: 'needs_source' })).rejects.toThrow('owner or curator')
    expect(updates(supabase, 'project_knowledge_gaps')).toEqual([])
  })

  it('records the triage outcome; closing it as out of scope tells the reporter', async () => {
    const { supabase, ctx } = makeCtx(
      {
        project_knowledge_gaps: [{ data: gap(), error: null }, { data: null, error: null }],
        project_notes: [{ data: { id: 'note-1' }, error: null }],
      },
      { role: 'admin', userId: 'admin-1' }
    )
    await triageKnowledgeGap(ctx, 'gap-1', { status: 'out_of_scope', note: 'Not an NG911 question' })
    expect(updates(supabase, 'project_knowledge_gaps')[0]).toMatchObject({
      status: 'out_of_scope',
      triage_note: 'Not an NG911 question',
      duplicate_of: null,
      resolved_by: 'admin-1',
    })
    expect(inserts(supabase, 'project_notes')[0]).toMatchObject({ recipient_user_id: 'reporter-1', subject: 'Your Ember report was reviewed' })
  })

  it('needs a duplicate target from the same Project, and rejects non-triage statuses', async () => {
    const noTarget = makeCtx({ project_knowledge_gaps: [{ data: gap(), error: null }] }, { role: 'admin' })
    await expect(triageKnowledgeGap(noTarget.ctx, 'gap-1', { status: 'duplicate' })).rejects.toThrow('Choose the gap this duplicates')

    const otherProject = makeCtx(
      { project_knowledge_gaps: [{ data: gap(), error: null }, { data: { project_id: 'p2' }, error: null }] },
      { role: 'admin' }
    )
    await expect(triageKnowledgeGap(otherProject.ctx, 'gap-1', { status: 'duplicate', duplicateOf: 'gap-9' })).rejects.toThrow('from this Project')

    const resolvedViaTriage = makeCtx({ project_knowledge_gaps: [{ data: gap(), error: null }] }, { role: 'admin' })
    await expect(triageKnowledgeGap(resolvedViaTriage.ctx, 'gap-1', { status: 'resolved' })).rejects.toThrow('triage outcome')
  })
})

describe('resolveKnowledgeGap', () => {
  it('needs a linked source, Wiki article or note', async () => {
    const { ctx } = makeCtx({ project_knowledge_gaps: [{ data: gap(), error: null }] }, { role: 'admin' })
    await expect(resolveKnowledgeGap(ctx, 'gap-1', { note: ' ', verifiedAnswers: null })).rejects.toThrow('Link the source')
  })

  it('links what now covers it, records the re-check and tells the reporter', async () => {
    const { supabase, ctx } = makeCtx(
      {
        project_members: [{ data: { role: 'curator' }, error: null }],
        project_knowledge_gaps: [{ data: gap(), error: null }, { data: null, error: null }],
        project_notes: [{ data: { id: 'note-1' }, error: null }],
      },
      { userId: 'curator-1' }
    )
    await resolveKnowledgeGap(ctx, 'gap-1', { resolvingSourceId: 'src-mitel', note: 'Loaded the Mitel admin guide', verifiedAnswers: true })
    expect(updates(supabase, 'project_knowledge_gaps')[0]).toMatchObject({
      status: 'resolved',
      resolving_source_id: 'src-mitel',
      resolving_article_id: null,
      resolution_note: 'Loaded the Mitel admin guide',
      verified_answers: true,
      verified_by: 'curator-1',
      resolved_by: 'curator-1',
    })
    expect(inserts(supabase, 'project_notes')[0]).toMatchObject({ recipient_user_id: 'reporter-1', subject: 'Your Ember report was resolved' })
  })
})

describe('promoteKnowledgeGapToEvalCase', () => {
  it('adds the question to the Project’s newest draft dataset and links the case to the gap', async () => {
    const { supabase, ctx } = makeCtx(
      {
        project_knowledge_gaps: [
          { data: gap({ status: 'resolved', resolution_note: 'Use port 5060 over TLS 5061', resolving_source_id: 'src-mitel' }), error: null },
          { data: null, error: null },
        ],
        eval_datasets: [{ data: [{ id: 'ds-draft' }], error: null }],
        knowledge_sources: [{ data: { title: 'Mitel admin guide' }, error: null }],
        eval_cases: [{ data: { id: 'case-1' }, error: null }],
      },
      { role: 'admin' }
    )
    expect(await promoteKnowledgeGapToEvalCase(ctx, 'gap-1')).toEqual({ projectId: 'p1', datasetId: 'ds-draft' })
    expect(inserts(supabase, 'eval_datasets')).toEqual([])
    expect(inserts(supabase, 'eval_cases')[0]).toMatchObject({
      dataset_id: 'ds-draft',
      question: 'How are Mitel SIP trunks configured?',
      expected_answer: 'Use port 5060 over TLS 5061',
      scoring_criteria: 'Should answer from "Mitel admin guide".',
      tags: ['knowledge-gap'],
    })
    expect(updates(supabase, 'project_knowledge_gaps')[0]).toEqual({ eval_case_id: 'case-1' })
  })

  it('creates a draft dataset for the Project when it has none, preferring the reported correct answer', async () => {
    const { supabase, ctx } = makeCtx(
      {
        project_knowledge_gaps: [{ data: gap({ correct_answer: 'Port 5060', resolving_article_id: 'art-1' }), error: null }, { data: null, error: null }],
        eval_datasets: [{ data: [], error: null }, { data: { id: 'ds-new' }, error: null }],
        projects: [{ data: { name: 'cebu-ng911' }, error: null }],
        eval_cases: [{ data: { id: 'case-1' }, error: null }],
      },
      { role: 'admin', userId: 'admin-1' }
    )
    expect(await promoteKnowledgeGapToEvalCase(ctx, 'gap-1')).toEqual({ projectId: 'p1', datasetId: 'ds-new' })
    expect(inserts(supabase, 'eval_datasets')[0]).toMatchObject({ name: 'cebu-ng911 — Ember test questions', status: 'draft', project_id: 'p1', created_by: 'admin-1' })
    expect(inserts(supabase, 'eval_cases')[0]).toMatchObject({ dataset_id: 'ds-new', expected_answer: 'Port 5060', expected_article_ids: ['art-1'] })
  })

  it('refuses without an expected answer, or when already promoted', async () => {
    const noAnswer = makeCtx({ project_knowledge_gaps: [{ data: gap(), error: null }] }, { role: 'admin' })
    await expect(promoteKnowledgeGapToEvalCase(noAnswer.ctx, 'gap-1')).rejects.toThrow('Add the correct answer')

    const already = makeCtx({ project_knowledge_gaps: [{ data: gap({ eval_case_id: 'case-0' }), error: null }] }, { role: 'admin' })
    await expect(promoteKnowledgeGapToEvalCase(already.ctx, 'gap-1')).rejects.toThrow('already a test question')
  })
})

describe('convertKnowledgeGapToFeedback', () => {
  it('files a feedback report as the curator and closes the gap as an Ember product issue', async () => {
    const { supabase, ctx } = makeCtx(
      {
        project_knowledge_gaps: [{ data: gap(), error: null }, { data: null, error: null }],
        feedback_reports: [{ data: { id: 'fb-1', report_number: 42 }, error: null }],
      },
      { role: 'admin', userId: 'admin-1' }
    )
    expect(await convertKnowledgeGapToFeedback(ctx, 'gap-1')).toEqual({ projectId: 'p1', reportNumber: 42 })
    const report = inserts(supabase, 'feedback_reports')[0]
    expect(report).toMatchObject({ reporter_id: 'admin-1', type: 'bug', project_id: 'p1' })
    expect(report.description).toContain('How are Mitel SIP trunks configured?')
    expect(updates(supabase, 'project_knowledge_gaps')[0]).toMatchObject({ feedback_report_id: 'fb-1', status: 'product_issue', resolved_by: 'admin-1' })
  })
})

describe('addKnowledgeGapOccurrenceDetails (Stage 4)', () => {
  it('saves the asker’s note and suggested source on their own detection', async () => {
    const { supabase, ctx } = makeCtx({ project_knowledge_gap_occurrences: [{ data: { project_id: 'p1' }, error: null }] })
    expect(await addKnowledgeGapOccurrenceDetails(ctx, 'occ-1', { note: ' Port numbers ', suggestedSource: 'Mitel guide' })).toEqual({ projectId: 'p1' })
    expect(updates(supabase, 'project_knowledge_gap_occurrences')[0]).toEqual({ note: 'Port numbers', suggested_source: 'Mitel guide' })
    expect(supabase._calls).toContainEqual({ table: 'project_knowledge_gap_occurrences', method: 'eq', args: { column: 'user_id', value: 'user-1' } })
  })

  it('needs at least one detail, and fails clearly when the detection is not theirs', async () => {
    const empty = makeCtx({})
    await expect(addKnowledgeGapOccurrenceDetails(empty.ctx, 'occ-1', { note: ' ', suggestedSource: '' })).rejects.toThrow('Add a detail')
    const notMine = makeCtx({ project_knowledge_gap_occurrences: [{ data: null, error: null }] })
    await expect(addKnowledgeGapOccurrenceDetails(notMine.ctx, 'occ-1', { note: 'x', suggestedSource: '' })).rejects.toThrow('could not be found')
  })
})

describe('withdrawKnowledgeGapOccurrence (Stage 4)', () => {
  function withRpc(error: { message: string } | null) {
    const fake = createFakeSupabase({ project_knowledge_gap_occurrences: [{ data: { project_id: 'p1' }, error: null }] })
    const rpc = async () => ({ data: null, error })
    return { user: { id: 'user-1' }, profile: { role: 'member' }, supabase: { ...fake, rpc } } as unknown as WorkbenchCallerContext
  }

  it('withdraws through the database function', async () => {
    expect(await withdrawKnowledgeGapOccurrence(withRpc(null), 'occ-1')).toEqual({ projectId: 'p1' })
  })

  it('explains when a curator is already working on it, or it is too late', async () => {
    await expect(withdrawKnowledgeGapOccurrence(withRpc({ message: 'withdraw_knowledge_gap_occurrence: a curator is already working on this gap' }), 'occ-1')).rejects.toThrow(
      'A curator is already working on this gap'
    )
    await expect(withdrawKnowledgeGapOccurrence(withRpc({ message: 'withdraw_knowledge_gap_occurrence: nothing to withdraw' }), 'occ-1')).rejects.toThrow(
      'can no longer be withdrawn'
    )
  })
})

describe('project_knowledge_gaps migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261014100001_project_knowledge_gaps.sql'), 'utf-8')

  it('shows a gap only to its reporter and the Project’s curators/admins', () => {
    expect(sql).toMatch(/for select using \(reported_by = auth\.uid\(\) or can_curate_project\(project_id, auth\.uid\(\)\)\)/)
  })

  it('lets any member report as themselves, only curators work the queue, and nobody delete', () => {
    expect(sql).toMatch(/for insert with check \(reported_by = auth\.uid\(\) and is_project_member\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).toMatch(/for update using \(can_curate_project\(project_id, auth\.uid\(\)\)\) with check \(can_curate_project\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).not.toMatch(/on project_knowledge_gaps\s+for delete/)
  })

  it('keeps a new report untriaged, ties it to the reporter’s own Project conversation, and freezes what was reported', () => {
    expect(sql).toMatch(/new\.status := 'new';/)
    expect(sql).toMatch(/c\.project_id = new\.project_id and c\.user_id = new\.reported_by/)
    expect(sql).toMatch(/what was reported cannot be changed/)
  })

  it('adds the open-gap count to the readiness signals and keeps external MCP tokens read-only', () => {
    expect(sql).toMatch(/open_gap_count integer/)
    expect(sql).toMatch(/g\.status in \('new', 'needs_source', 'wiki_needed'\)/)
    expect(sql).toMatch(/grant execute on function project_ember_readiness_signals\(uuid\[\]\) to authenticated/)
    expect(sql).toMatch(/if to_regprocedure\('public\.apply_oauth_read_only_policies\(\)'\) is not null then\s+perform apply_oauth_read_only_policies\(\);/)
  })
})
