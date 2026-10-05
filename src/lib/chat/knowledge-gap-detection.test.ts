import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const { detectKnowledgeGapSignal, recordKnowledgeGap, PROJECT_EVIDENCE_SIMILARITY } = await import('./knowledge-gap-detection')

describe('detectKnowledgeGapSignal', () => {
  const base = { coverage: undefined, projectSearchRan: false, bestProjectSimilarity: null, projectCitationCount: 0 }

  it('follows Ember’s own declaration when it made one', () => {
    expect(detectKnowledgeGapSignal({ ...base, coverage: { status: 'not_in_project_knowledge', missingTopic: 'Mitel' } })).toBe('declared')
    expect(detectKnowledgeGapSignal({ ...base, coverage: { status: 'partial' } })).toBe('declared')
    // 'answered' wins even if the search found nothing -- this is how
    // greetings and out-of-scope questions stay out of the queue.
    expect(detectKnowledgeGapSignal({ ...base, coverage: { status: 'answered' }, projectSearchRan: true })).toBeNull()
  })

  it('without a declaration, files a gap only when the Project search ran and found nothing relevant or citable', () => {
    expect(detectKnowledgeGapSignal(base)).toBeNull()
    expect(detectKnowledgeGapSignal({ ...base, projectSearchRan: true })).toBe('no_project_evidence')
    expect(detectKnowledgeGapSignal({ ...base, projectSearchRan: true, bestProjectSimilarity: PROJECT_EVIDENCE_SIMILARITY - 0.01 })).toBe('no_project_evidence')
    expect(detectKnowledgeGapSignal({ ...base, projectSearchRan: true, bestProjectSimilarity: PROJECT_EVIDENCE_SIMILARITY })).toBeNull()
    expect(detectKnowledgeGapSignal({ ...base, projectSearchRan: true, projectCitationCount: 1 })).toBeNull()
  })
})

describe('recordKnowledgeGap', () => {
  function ctxWith(rpcRow: Record<string, unknown> | null, { rpcError = null as Error | null } = {}) {
    const fake = createFakeSupabase({
      project_members: [{ data: [{ user_id: 'curator-1' }], error: null }],
      project_notes: [{ data: { id: 'note-1' }, error: null }],
    })
    const rpc = vi.fn(async () => ({ data: rpcRow ? [rpcRow] : [], error: rpcError }))
    const supabase = { ...fake, rpc }
    return { fake, rpc, ctx: { user: { id: 'user-1' }, profile: { role: 'consultant' }, supabase } as unknown as WorkbenchCallerContext }
  }
  const input = {
    projectId: 'p1',
    messageId: 'msg-1',
    question: 'How are Mitel SIP trunks configured?',
    missingTopic: 'Mitel SIP trunk configuration',
    signal: 'declared' as const,
  }

  it('records through the database function and tells the curators about a new gap', async () => {
    const { fake, rpc, ctx } = ctxWith({ gap_id: 'gap-1', occurrence_id: 'occ-1', is_new: true, occurrence_count: 1 })
    const result = await recordKnowledgeGap(ctx, input)

    expect(rpc).toHaveBeenCalledWith('record_automatic_knowledge_gap', {
      p_message_id: 'msg-1',
      p_question: 'How are Mitel SIP trunks configured?',
      p_missing_topic: 'Mitel SIP trunk configuration',
      p_signal: 'declared',
    })
    expect(result).toEqual({ gapId: 'gap-1', occurrenceId: 'occ-1', isNew: true, occurrenceCount: 1 })
    const note = fake._calls.find((c) => c.table === 'project_notes' && c.method === 'insert')?.args as Record<string, unknown>
    expect(note).toMatchObject({ recipient_user_id: 'curator-1', subject: 'Ember found a knowledge gap', context_type: 'knowledge_gap', context_id: 'gap-1' })
  })

  it('sends a digest note only at 3, 10 and 25 occurrences, not on every repeat', async () => {
    const repeat = ctxWith({ gap_id: 'gap-1', occurrence_id: 'occ-2', is_new: false, occurrence_count: 2 })
    await recordKnowledgeGap(repeat.ctx, input)
    expect(repeat.fake._calls.some((c) => c.table === 'project_notes')).toBe(false)

    const third = ctxWith({ gap_id: 'gap-1', occurrence_id: 'occ-3', is_new: false, occurrence_count: 3 })
    await recordKnowledgeGap(third.ctx, input)
    const note = third.fake._calls.find((c) => c.table === 'project_notes' && c.method === 'insert')?.args as Record<string, unknown>
    expect(note).toMatchObject({ subject: 'A knowledge gap keeps coming up' })
    expect(note.body).toContain('3 times')
  })

  it('never throws -- a failure must not break the chat turn', async () => {
    const { ctx } = ctxWith(null, { rpcError: new Error('boom') })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await recordKnowledgeGap(ctx, input)).toBeNull()
    spy.mockRestore()
  })
})

describe('knowledge_gap_detection migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261015100001_knowledge_gap_detection.sql'), 'utf-8')

  it('records only from the caller’s own Project chat conversation, while a member', () => {
    const fn = sql.slice(sql.indexOf('create or replace function record_automatic_knowledge_gap('))
    expect(fn).toMatch(/c\.user_id = v_uid and c\.project_id is not null and c\.kind = 'chat'/)
    expect(fn).toMatch(/is_project_member\(v_project_id, v_uid\)/)
    expect(fn).toMatch(/where id = p_message_id and role = 'assistant'/)
  })

  it('groups with a similar open gap in the same Project instead of filing a new one', () => {
    expect(sql).toMatch(/g\.status in \('new', 'needs_source', 'wiki_needed'\)/)
    expect(sql).toMatch(/knowledge_gap_similarity\(coalesce\(g\.missing_topic, ''\) \|\| ' ' \|\| g\.question, v_text\) >= 0\.65/)
    expect(sql).toMatch(/set occurrence_count = g\.occurrence_count \+ 1/)
  })

  it('lets only the asker see, annotate or withdraw their detection; never insert or delete it directly', () => {
    expect(sql).toMatch(/for select using \(user_id = auth\.uid\(\) or can_curate_project\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).toMatch(/for update using \(user_id = auth\.uid\(\)\) with check \(user_id = auth\.uid\(\)\)/)
    expect(sql).not.toMatch(/on project_knowledge_gap_occurrences\s+for (insert|delete|all)/)
    expect(sql).toMatch(/only the note and suggested source can be changed/)
    expect(sql).toMatch(/where id = p_occurrence_id and user_id = auth\.uid\(\) and created_at > now\(\) - interval '1 day'/)
    expect(sql).toMatch(/a curator is already working on this gap/)
  })

  it('keeps the database functions away from anonymous callers and external MCP tokens read-only', () => {
    expect(sql).toMatch(/revoke execute on function record_automatic_knowledge_gap\(uuid, text, text, text\) from public, anon;/)
    expect(sql).toMatch(/revoke execute on function withdraw_knowledge_gap_occurrence\(uuid\) from public, anon;/)
    expect(sql).toMatch(/if to_regprocedure\('public\.apply_oauth_read_only_policies\(\)'\) is not null then\s+perform apply_oauth_read_only_policies\(\);/)
  })
})
