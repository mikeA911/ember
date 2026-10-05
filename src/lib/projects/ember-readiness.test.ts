import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { ProjectEmberReadinessSignals } from '@/types/database'

const { computeReadinessStatus, listProjectReadiness, setProjectReadiness, ReadinessValidationError } = await import('./ember-readiness')

const NOW = new Date('2026-10-05T12:00:00Z')

function judgement(overrides: Partial<Parameters<typeof computeReadinessStatus>[0] & object> = {}) {
  return {
    confidencePercent: 70,
    verdict: 'needs_more_sources' as const,
    rationale: 'Mitel PBX documentation is missing',
    setBy: 'curator-1',
    setAt: '2026-10-01T00:00:00Z',
    reviewDueAt: '2026-12-30T00:00:00Z',
    measuredPctAtSet: 80,
    ...overrides,
  }
}

function measured(pct: number) {
  return { runId: 'run-1', datasetName: 'NG911', measuredAt: '2026-10-04T00:00:00Z', questions: 10, passed: pct / 10, pct }
}

describe('computeReadinessStatus', () => {
  it('is "not assessed" when no curator has set a judgement, even with a measured score', () => {
    expect(computeReadinessStatus(null, measured(80), NOW)).toEqual({
      verdict: 'not_assessed',
      reviewDue: false,
      reviewReasons: [],
      disagreement: null,
    })
  })

  it('keeps the curator verdict and flags nothing when the signals agree and the judgement is fresh', () => {
    expect(computeReadinessStatus(judgement(), measured(80), NOW)).toEqual({
      verdict: 'needs_more_sources',
      reviewDue: false,
      reviewReasons: [],
      disagreement: null,
    })
  })

  it('marks review due once the review date has passed', () => {
    const status = computeReadinessStatus(judgement({ reviewDueAt: '2026-10-05T11:00:00Z' }), measured(80), NOW)
    expect(status.reviewDue).toBe(true)
    expect(status.reviewReasons).toEqual(['The review date has passed.'])
  })

  it('marks review due when the measured score drops 15 points or more since the judgement', () => {
    const status = computeReadinessStatus(judgement({ measuredPctAtSet: 80, confidencePercent: 70 }), measured(60), NOW)
    expect(status.reviewDue).toBe(true)
    expect(status.reviewReasons[0]).toContain('fell from 80% to 60%')
  })

  it('does not treat a small drop, or a judgement set before any run, as a reason to review', () => {
    expect(computeReadinessStatus(judgement({ measuredPctAtSet: 80 }), measured(70), NOW).reviewDue).toBe(false)
    expect(computeReadinessStatus(judgement({ measuredPctAtSet: null }), measured(10), NOW).reviewReasons).toEqual([])
  })

  it('marks review due once five or more knowledge gaps are open', () => {
    expect(computeReadinessStatus(judgement(), measured(80), NOW, 4).reviewDue).toBe(false)
    const status = computeReadinessStatus(judgement(), measured(80), NOW, 5)
    expect(status.reviewDue).toBe(true)
    expect(status.reviewReasons).toEqual(['5 knowledge gaps are open.'])
  })

  it('says so when curator confidence and the measured score disagree by more than 25 points, in either direction', () => {
    expect(computeReadinessStatus(judgement({ confidencePercent: 90, measuredPctAtSet: null }), measured(50), NOW).disagreement).toContain(
      'Curator confidence (90%) is well above the measured score (50%)'
    )
    expect(computeReadinessStatus(judgement({ confidencePercent: 30, measuredPctAtSet: null }), measured(80), NOW).disagreement).toContain(
      'The measured score (80%) is well above curator confidence (30%)'
    )
    expect(computeReadinessStatus(judgement({ confidencePercent: 70 }), null, NOW).disagreement).toBeNull()
  })
})

describe('listProjectReadiness', () => {
  it('uses the newest judgement as current, keeps earlier ones as history, and maps the measured score and coverage', async () => {
    const fake = createFakeSupabase({
      project_ember_readiness: [
        {
          data: [
            {
              id: 'r2',
              project_id: 'p1',
              confidence_percent: 75,
              verdict: 'ready',
              rationale: 'Mitel docs added',
              review_due_at: '2026-12-30T00:00:00Z',
              measured_score_at_set: '0.6000',
              set_by: 'curator-1',
              set_at: '2026-10-04T00:00:00Z',
            },
            {
              id: 'r1',
              project_id: 'p1',
              confidence_percent: 50,
              verdict: 'needs_more_sources',
              rationale: 'Early days',
              review_due_at: '2026-11-30T00:00:00Z',
              measured_score_at_set: null,
              set_by: 'curator-1',
              set_at: '2026-09-01T00:00:00Z',
            },
          ],
          error: null,
        },
      ],
    })
    const signals: ProjectEmberReadinessSignals[] = [
      {
        project_id: 'p1',
        measured_run_id: 'run-1',
        measured_dataset_name: 'NG911',
        measured_at: '2026-10-04T00:00:00Z',
        measured_questions: 5,
        measured_passed: 3,
        source_count: 4,
        searchable_source_count: 3,
        wiki_article_count: 2,
        last_source_added_at: '2026-09-20T00:00:00Z',
        open_gap_count: 2,
      },
    ]
    const rpcCalls: unknown[] = []
    const supabase = {
      ...fake,
      async rpc(name: string, args: unknown) {
        rpcCalls.push({ name, args })
        return { data: signals, error: null }
      },
    }

    const result = await listProjectReadiness(supabase as never, ['p1', 'p2'], { historyLimit: 5, now: NOW })

    expect(rpcCalls).toEqual([{ name: 'project_ember_readiness_signals', args: { pids: ['p1', 'p2'] } }])
    const p1 = result.get('p1')!
    expect(p1.current).toMatchObject({ confidencePercent: 75, verdict: 'ready', measuredPctAtSet: 60 })
    expect(p1.history.map((h) => h.rationale)).toEqual(['Early days'])
    expect(p1.measured).toEqual({ runId: 'run-1', datasetName: 'NG911', measuredAt: '2026-10-04T00:00:00Z', questions: 5, passed: 3, pct: 60 })
    expect(p1.coverage).toEqual({ sourceCount: 4, searchableSourceCount: 3, wikiArticleCount: 2, lastSourceAddedAt: '2026-09-20T00:00:00Z' })
    expect(p1.status.verdict).toBe('ready')
    expect(p1.openGapCount).toBe(2)

    // A Project with no judgement and no signals row reads as not assessed.
    const p2 = result.get('p2')!
    expect(p2).toMatchObject({ current: null, measured: null, history: [] })
    expect(p2.status.verdict).toBe('not_assessed')
    expect(p2.coverage.sourceCount).toBe(0)
  })

  it('makes no database calls for an empty project list', async () => {
    const fake = createFakeSupabase({})
    const result = await listProjectReadiness(fake as never, [])
    expect(result.size).toBe(0)
    expect(fake._rpcCalls).toEqual([])
  })
})

describe('setProjectReadiness', () => {
  function ctx(role: string, projectRole: string | null) {
    const supabase = createFakeSupabase({
      project_members: [{ data: projectRole ? { role: projectRole } : null, error: null }],
      project_ember_readiness: [{ data: null, error: null }],
    })
    return { supabase, ctx: { user: { id: 'user-1' }, profile: { role }, supabase } as unknown as WorkbenchCallerContext }
  }
  const input = { confidencePercent: 70, verdict: 'needs_more_sources' as const, rationale: '  Mitel docs missing  ', reviewPeriodDays: 90 }

  it('records the judgement as the caller, with a review date the chosen period ahead', async () => {
    const { supabase, ctx: c } = ctx('consultant', 'curator')
    const before = Date.now()
    await setProjectReadiness(c, 'p1', input)

    const insert = supabase._calls.find((call) => call.table === 'project_ember_readiness' && call.method === 'insert')
    const args = insert?.args as Record<string, unknown>
    expect(args).toMatchObject({ project_id: 'p1', confidence_percent: 70, verdict: 'needs_more_sources', rationale: 'Mitel docs missing', set_by: 'user-1' })
    const due = new Date(args.review_due_at as string).getTime()
    expect(due - before).toBeGreaterThanOrEqual(90 * 24 * 60 * 60 * 1000 - 1000)
    expect(due - before).toBeLessThanOrEqual(90 * 24 * 60 * 60 * 1000 + 5000)
  })

  it('lets a platform admin set it without a project membership', async () => {
    const { supabase, ctx: c } = ctx('admin', null)
    await setProjectReadiness(c, 'p1', input)
    expect(supabase._calls.some((call) => call.table === 'project_ember_readiness' && call.method === 'insert')).toBe(true)
  })

  it('refuses project consultants and viewers', async () => {
    for (const projectRole of ['consultant', 'viewer', null]) {
      const { supabase, ctx: c } = ctx('curator', projectRole)
      await expect(setProjectReadiness(c, 'p1', input)).rejects.toThrow("owner or curator role")
      expect(supabase._calls.some((call) => call.method === 'insert')).toBe(false)
    }
  })

  it('rejects an out-of-range confidence, a blank rationale and an unknown review period', async () => {
    const cases = [
      { ...input, confidencePercent: 101 },
      { ...input, confidencePercent: -1 },
      { ...input, rationale: '   ' },
      { ...input, reviewPeriodDays: 7 },
      { ...input, verdict: 'not_assessed' as never },
    ]
    for (const bad of cases) {
      const { ctx: c } = ctx('admin', null)
      await expect(setProjectReadiness(c, 'p1', bad)).rejects.toBeInstanceOf(ReadinessValidationError)
    }
  })
})

describe('project_ember_readiness migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261013100001_project_ember_readiness.sql'), 'utf-8')

  it('lets any Project member read readiness, and only Project curators or admins add to it, as themselves', () => {
    expect(sql).toMatch(/create policy "project_ember_readiness_select_member" on project_ember_readiness\s+for select using \(is_project_member\(project_id, auth\.uid\(\)\)\)/)
    expect(sql).toMatch(
      /create policy "project_ember_readiness_insert_curator" on project_ember_readiness\s+for insert with check \(can_curate_project\(project_id, auth\.uid\(\)\) and set_by = auth\.uid\(\)\)/
    )
  })

  it('keeps history append-only: no update or delete policy', () => {
    expect(sql).not.toMatch(/on project_ember_readiness\s+for (update|delete|all)/)
  })

  it('fills the measured score at set time server-side, not from the client', () => {
    expect(sql).toMatch(/new\.measured_score_at_set :=/)
    expect(sql).toMatch(/new\.set_at := now\(\)/)
  })

  it('only returns readiness signals for Projects the caller is a member of, and hides the internal score helper', () => {
    expect(sql).toMatch(/where is_project_member\(p\.id, auth\.uid\(\)\)/)
    expect(sql).toMatch(/revoke execute on function project_measured_score\(uuid\) from public, anon, authenticated/)
    expect(sql).toMatch(/grant execute on function project_ember_readiness_signals\(uuid\[\]\) to authenticated/)
  })
})

describe('workstream knowledge in Project search (20261016100001)', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261016100001_workstream_knowledge_in_project_search.sql'), 'utf-8')

  it('lets Project members read knowledge bases attached to the Project or one of its workstreams, with strict membership', () => {
    const fn = sql.slice(sql.indexOf('create or replace function knowledge_base_readable_via_project('))
    expect(fn).toMatch(/from project_knowledge_bases pkb\s+where pkb\.knowledge_base_id = p_kb_id and is_project_member_strict\(pkb\.project_id, uid\)/)
    expect(fn).toMatch(/from workstream_knowledge_bases wkb\s+join project_workstreams w on w\.id = wkb\.workstream_id\s+where wkb\.knowledge_base_id = p_kb_id and is_project_member_strict\(w\.project_id, uid\)/)
  })

  it('keeps evidence-access restrictions on every read path it widens', () => {
    for (const policy of ['knowledge_sources_select_staff_or_owner_or_project_member', 'documents_select_staff_or_owner_or_project_member', 'kb_vectors_select_scoped']) {
      const body = sql.slice(sql.indexOf(`create policy "${policy}"`))
      expect(body.slice(0, 900)).toMatch(/has_evidence_access\('knowledge_source'/)
      expect(body.slice(0, 900)).toMatch(/knowledge_base_readable_via_project\(kb\.id, auth\.uid\(\)\)/)
    }
  })

  it('counts readiness coverage over exactly the Project search scope', () => {
    const fn = sql.slice(sql.indexOf('create or replace function project_ember_readiness_signals('))
    expect(fn).toMatch(/from workstream_knowledge_bases wkb/)
    expect(fn).not.toMatch(/\bkb\.project_id/)
    expect(fn).not.toMatch(/w\.knowledge_base_id = pk\.kb_id/)
  })
})

