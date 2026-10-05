import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// No live database in this suite (see docs/CURRENT-ARCHITECTURE.md), so this
// asserts the *shape* of the policy file directly -- same approach as
// src/lib/wiki/rls.test.ts. Two guarantees matter here: (1) every eval table
// is gated to curator/admin, not any authenticated user, and (2) an active
// dataset's cases genuinely cannot be mutated -- enforced by RLS, not by
// convention in the Server Actions layer.
const rlsSql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260809110004_eval_rls.sql'), 'utf-8')
const consultantRlsSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260810100004_eval_consultant_access.sql'),
  'utf-8'
)
const consultantRunUpdateRlsSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260810100005_eval_runs_update_consultant.sql'),
  'utf-8'
)
const adminOnlyRlsSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20261012100001_eval_operations_admin_only.sql'),
  'utf-8'
)
const consultantVectorRlsSql = fs.readFileSync(
  path.join(process.cwd(), 'supabase/migrations/20260810100006_consultant_vector_read_access.sql'),
  'utf-8'
)

describe('Evaluation RLS policy file', () => {
  it('enables row level security on every eval table', () => {
    for (const table of ['eval_datasets', 'eval_cases', 'eval_runs', 'eval_results']) {
      expect(rlsSql).toMatch(new RegExp(`alter table ${table} enable row level security`))
    }
  })

  it('gates every eval table to curator/admin, not any authenticated user', () => {
    const markers = ['-- eval_datasets ', '-- eval_cases ', '-- eval_runs ', '-- eval_results ']
    const sections = markers.map((marker, i) => {
      const start = rlsSql.indexOf(marker)
      expect(start).toBeGreaterThan(-1)
      const end = i + 1 < markers.length ? rlsSql.indexOf(markers[i + 1]) : rlsSql.length
      return rlsSql.slice(start, end)
    })
    for (const section of sections) {
      expect(section).toMatch(/for select using \(is_curator_or_admin\(auth\.uid\(\)\)\)/)
      expect(section).toMatch(/for insert with check \(\s*is_curator_or_admin\(auth\.uid\(\)\)/)
    }
  })

  it('blocks inserting a case into a dataset that is not draft', () => {
    const section = rlsSql.slice(rlsSql.indexOf('eval_cases_insert_staff_draft_only'), rlsSql.indexOf('eval_cases_update_staff_draft_only'))
    expect(section).toMatch(/d\.status = 'draft'/)
  })

  it('blocks updating or deleting a case once the dataset leaves draft', () => {
    const updateSection = rlsSql.slice(rlsSql.indexOf('eval_cases_update_staff_draft_only'), rlsSql.indexOf('eval_cases_delete_staff_draft_only'))
    const deleteSection = rlsSql.slice(rlsSql.indexOf('eval_cases_delete_staff_draft_only'), rlsSql.indexOf('-- eval_runs'))
    expect(updateSection).toMatch(/d\.status = 'draft'/)
    expect(deleteSection).toMatch(/d\.status = 'draft'/)
  })
})

describe('Evaluation consultant-access RLS policy file (additive)', () => {
  it('scopes every consultant select/insert policy to an active dataset', () => {
    for (const policy of [
      'eval_datasets_select_active_consultant',
      'eval_cases_select_active_consultant',
      'eval_runs_select_active_consultant',
      'eval_runs_insert_active_consultant',
      'eval_results_select_active_consultant',
      'eval_results_insert_active_consultant',
    ]) {
      const start = consultantRlsSql.indexOf(policy)
      expect(start).toBeGreaterThan(-1)
      const section = consultantRlsSql.slice(start, start + 400)
      expect(section).toMatch(/status = 'active'/)
      expect(section).toMatch(/role = 'consultant'/)
    }
  })

  it('never references the anonymous role -- anonymous sessions get no eval access from this file', () => {
    expect(consultantRlsSql).not.toMatch(/anonymous/)
  })

  it('requires a consultant-created run to be attributed to themselves', () => {
    const section = consultantRlsSql.slice(consultantRlsSql.indexOf('eval_runs_insert_active_consultant'))
    expect(section).toMatch(/created_by = auth\.uid\(\)/)
  })
})

describe('Evaluation consultant run-update RLS (additive)', () => {
  // Regression test for a live bug: executeEvalRun's status transitions
  // (pending -> running -> completed/failed) are UPDATEs on eval_runs run
  // with the caller's own session. Without this policy, a consultant-created
  // run's results are inserted successfully but the run itself stays stuck
  // at status='pending' forever -- RLS silently drops the UPDATE rather than
  // erroring, so nothing surfaces the failure except the stuck status.
  it('lets a consultant update only their own run', () => {
    expect(consultantRunUpdateRlsSql).toMatch(/for update using \(\s*created_by = auth\.uid\(\)/)
    expect(consultantRunUpdateRlsSql).toMatch(/role = 'consultant'/)
  })
})

describe('Evaluation consultant vector-read RLS (additive)', () => {
  // Regression test for a second live bug in the same family: match_documents
  // and match_wiki_vectors are not SECURITY DEFINER, so they run under RLS
  // with the caller's permissions -- kb_vectors/wiki_vectors were curator/
  // admin-only, so a consultant's retrieval step silently returned zero
  // evidence for every retrieval config (confirmed live: 0% Hit@K on a
  // benchmark that scores well for the same config as curator/admin).
  it('grants consultants select access to both vector tables retrieval depends on', () => {
    for (const table of ['kb_vectors', 'wiki_vectors']) {
      expect(consultantVectorRlsSql).toMatch(new RegExp(`create policy "${table}_select_consultant" on ${table}`))
    }
    expect(consultantVectorRlsSql).toMatch(/role = 'consultant'/)
  })
})

describe('Evaluation operations admin-only RLS (Ember Readiness, Stage 1)', () => {
  // Running evals, marking a baseline and human review are platform-admin
  // work. Every insert/update policy that let curators or consultants write
  // eval_runs / eval_results is dropped and replaced by an is_admin one.
  it('drops every curator and consultant write policy on eval_runs and eval_results', () => {
    for (const policy of [
      'eval_runs_insert_staff',
      'eval_runs_update_staff',
      'eval_runs_insert_active_consultant',
      'eval_runs_update_own_consultant',
      'eval_results_insert_staff',
      'eval_results_update_staff',
      'eval_results_insert_active_consultant',
    ]) {
      expect(adminOnlyRlsSql).toMatch(new RegExp(`drop policy if exists "${policy}"`))
    }
  })

  it('gates eval_runs and eval_results inserts and updates to platform admins', () => {
    for (const table of ['eval_runs', 'eval_results']) {
      expect(adminOnlyRlsSql).toMatch(
        new RegExp(`create policy "${table}_insert_admin" on ${table}\\s+for insert with check \\(is_admin\\(auth\\.uid\\(\\)\\)\\)`)
      )
      expect(adminOnlyRlsSql).toMatch(
        new RegExp(
          `create policy "${table}_update_admin" on ${table}\\s+for update using \\(is_admin\\(auth\\.uid\\(\\)\\)\\) with check \\(is_admin\\(auth\\.uid\\(\\)\\)\\)`
        )
      )
    }
  })

  it('leaves dataset and case authoring alone', () => {
    const statements = adminOnlyRlsSql.split('\n').filter((l) => !l.trimStart().startsWith('--'))
    expect(statements.join('\n')).not.toMatch(/eval_datasets|eval_cases/)
  })
})
