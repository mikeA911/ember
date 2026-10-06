import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// No live database in this suite -- asserts the migration's shape, same
// approach as every other *-rls.test.ts file here.
const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261007100001_agency_scoped_builder_budgets.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')
const code = sql.replace(/^--.*$/gm, '')

describe('agency-scoped builder budgets migration', () => {
  it('lets only the admin or the builder\'s own agency manage a budget', () => {
    expect(sql).toMatch(/select is_admin\(uid\) or is_builder_agency\(builder, uid\);/)
  })

  it('never falls back to any curator', () => {
    expect(code).not.toMatch(/is_curator_or_admin/)
  })

  it('replaces every old staff-wide policy on the three budget tables', () => {
    for (const policy of [
      'builder_ai_allowances_select_own_or_operator',
      'builder_ai_allowances_manage_staff',
      'builder_credit_grants_select_own_or_operator',
      'builder_credit_grants_insert_staff',
      'builder_llm_credentials_select_own_or_operator',
      'builder_llm_credentials_manage_own_or_staff',
    ]) {
      expect(sql).toContain(`drop policy if exists "${policy}"`)
    }
  })

  it('still keeps a builder from raising their own allowance', () => {
    expect(sql).toMatch(
      /"builder_ai_allowances_manage_agency_or_admin" on builder_ai_allowances\n\s+for all\n\s+using \(can_manage_builder_budget\(builder_id, auth\.uid\(\)\)\)/
    )
  })

  it('records who granted credit', () => {
    expect(sql).toMatch(/with check \(granted_by = auth\.uid\(\) and can_manage_builder_budget\(builder_id, auth\.uid\(\)\)\)/)
  })
})
