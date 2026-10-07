import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Static SQL-shape assertions -- same pattern as project-ontology-rls.test.ts
// and every other *-rls.test.ts in this repo. No live database in this suite.
const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260927100001_methods_schema.sql'), 'utf-8')

describe('methods RLS', () => {
  it('select allows published, staff, or the originating builder (own draft)', () => {
    const start = sql.indexOf('"methods_select_published_or_own_draft"')
    const section = sql.slice(start, start + 500)
    expect(section).toMatch(/status = 'published'/)
    expect(section).toMatch(/is_curator_or_admin\(auth\.uid\(\)\)/)
    expect(section).toMatch(/can_curate_project\(w\.project_id, auth\.uid\(\)\)/)
  })

  it('insert requires created_by = self and curator/owner on the source workstream\'s project', () => {
    const start = sql.indexOf('"methods_insert_own"')
    const section = sql.slice(start, start + 400)
    expect(section).toMatch(/created_by = auth\.uid\(\)/)
    expect(section).toMatch(/can_curate_project\(w\.project_id, auth\.uid\(\)\)/)
  })

  it('the owner-draft update policy\'s WITH CHECK excludes published -- a raw API call cannot self-publish', () => {
    const start = sql.indexOf('"methods_manage_own_draft"')
    const section = sql.slice(start, start + 600)
    expect(section).toMatch(/with check \(\s*status = 'draft'/)
  })

  it('publishing is a separate, staff-only policy (is_curator_or_admin), not folded into the owner-draft policy', () => {
    const start = sql.indexOf('"methods_publish_staff"')
    const section = sql.slice(start, start + 300)
    expect(section).toMatch(/using \(is_curator_or_admin\(auth\.uid\(\)\)\)/)
    expect(section).toMatch(/with check \(is_curator_or_admin\(auth\.uid\(\)\)\)/)
  })
})

describe('methods schema', () => {
  it('originally made derived_from_workstream_id not null and cascading (superseded by 20261031100001 below)', () => {
    expect(sql).toMatch(/derived_from_workstream_id uuid not null references project_workstreams\(id\) on delete cascade/)
  })

  it('status is constrained to draft/published only -- no separate "rejected" state', () => {
    expect(sql).toMatch(/status text not null default 'draft' check \(status in \('draft', 'published'\)\)/)
  })

  it('extends project_workstreams and ai_operation_logs additively, no existing column touched', () => {
    expect(sql).toMatch(/alter table project_workstreams add column derived_from_method_id/)
    expect(sql).toMatch(/alter table ai_operation_logs add column applied_method_id/)
    expect(sql).not.toMatch(/drop column/)
  })

  it('reuses is_curator_or_admin/can_curate_project by name, never redefines them', () => {
    expect(sql).not.toMatch(/create or replace function is_curator_or_admin\(/)
    expect(sql).not.toMatch(/create or replace function can_curate_project\(/)
  })
})

describe('methods outlive their workstream (20261031100001)', () => {
  const later = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261031100001_methods_outlive_workstreams.sql'), 'utf-8').replace(/\r\n/g, '\n')

  it('clears the link instead of deleting the Method when the workstream goes', () => {
    expect(later).toMatch(/alter column derived_from_workstream_id drop not null/)
    expect(later).toMatch(/references project_workstreams\(id\) on delete set null/)
  })

  it("keeps a draft visible and editable to its creator once the workstream is gone", () => {
    const select = later.slice(later.indexOf('create policy "methods_select_published_or_own_draft"'))
    expect(select.slice(0, 300)).toMatch(/or created_by = auth\.uid\(\)/)
    const manage = later.slice(later.indexOf('create policy "methods_manage_own_draft"'))
    expect(manage).toMatch(/created_by = auth\.uid\(\)/)
  })

  it('lets the originator edit only drafts, so a published Method cannot be unpublished that way', () => {
    const manage = later.slice(later.indexOf('create policy "methods_manage_own_draft"'))
    expect(manage).toMatch(/for update\s+using \(\s+status = 'draft'\s+and \(/)
    expect(manage).toMatch(/with check \(\s+status = 'draft'/)
  })
})
