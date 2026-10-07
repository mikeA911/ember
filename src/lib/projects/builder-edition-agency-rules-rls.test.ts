import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Shape test, like the other *-rls.test.ts files: no live database here.
const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261028100001_builder_edition_agency_rules.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')

function policy(name: string, length = 900) {
  const start = sql.indexOf(`create policy "${name}"`)
  expect(start).toBeGreaterThan(-1)
  return sql.slice(start, start + length)
}

describe('builder edition agency rules (20261028100001)', () => {
  it('records when the builder confirmed their client agreed', () => {
    expect(sql).toMatch(/add column if not exists client_agreed_at timestamptz/)
  })

  it('keeps per-builder shares between 0 and 100, readable by the builder and their agency, written by the admin only', () => {
    expect(sql).toMatch(/share_pct numeric\(5, 2\) not null check \(share_pct >= 0 and share_pct <= 100\)/)
    expect(sql).toMatch(/alter table builder_billing_shares enable row level security/)
    const select = policy('builder_billing_shares_select_own_agency_or_admin', 300)
    expect(select).toMatch(/builder_id = auth\.uid\(\)/)
    expect(select).toMatch(/is_builder_agency\(builder_id, auth\.uid\(\)\)/)
    const write = policy('builder_billing_shares_admin_write', 200)
    expect(write).toMatch(/for all using \(is_admin\(auth\.uid\(\)\)\) with check \(is_admin\(auth\.uid\(\)\)\)/)
  })

  it("never lets the submitter decide, and leaves a builder's work to their agency or the admin", () => {
    const decide = policy('workstream_promotions_decide_curator_or_agency', 1200)
    expect(decide.match(/submitted_by != auth\.uid\(\)/g)).toHaveLength(2)
    expect(decide.match(/p\.portfolio_category is distinct from 'builder_lab'\s+and can_curate_project/g)).toHaveLength(2)
    expect(decide).toMatch(/is_builder_agency\(submitted_by, auth\.uid\(\)\)/)
  })

  it("lets only the builder of record or the admin request promotion of a builder's work", () => {
    const insert = policy('workstream_promotions_insert_member', 600)
    expect(insert).toMatch(/submitted_by = auth\.uid\(\)/)
    expect(insert).toMatch(/coalesce\(p\.builder_id, p\.owner_id\) = auth\.uid\(\)/)
  })

  it("puts builders on no roster under the admin's agency only when there is exactly one admin", () => {
    expect(sql).toMatch(/where role = 'admin' and is_active = true\) = 1/)
    expect(sql).toMatch(/on conflict \(builder_id\) do nothing/)
  })
})
