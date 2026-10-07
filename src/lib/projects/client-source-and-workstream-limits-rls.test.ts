import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Shape test, like the other *-rls.test.ts files: no live database here.
const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261029100001_client_source_and_workstream_limits.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')

describe('client source and workstream limits (20261029100001)', () => {
  it('records who found the client, settable only by the service layer or an admin', () => {
    expect(sql).toMatch(/add column if not exists client_source text check \(client_source in \('builder', 'ember'\)\)/)
    expect(sql).toMatch(/new\.client_source is distinct from old\.client_source/)
    expect(sql).toMatch(/create trigger projects_enforce_client_source/)
  })

  it('moves recorded fees to shares that add up to 100%', () => {
    expect(sql).toMatch(/set builder_share_pct = 100 - f\.platform_rate_pct/)
    expect(sql).toMatch(/set platform_rate_pct = 100 - f\.builder_share_pct/)
  })

  it('limits workspace workstreams to 20 by default, outside promoted projects, never for admins or the service role', () => {
    expect(sql).toMatch(/coalesce\(\(select workstream_limit from builder_workstream_limits where builder_id = builder\), 20\)/)
    expect(sql).toMatch(/not exists \(select 1 from workstream_promotions wp where wp\.created_project_id = p\.id and wp\.status = 'approved'\)/)
    expect(sql).toMatch(/if auth\.uid\(\) is null or is_admin\(auth\.uid\(\)\) or not is_builder_workspace\(new\.project_id\) then/)
    expect(sql).toMatch(/before insert on project_workstreams/)
  })

  it('lets a builder ask for more with a reason, one open request at a time, and only the admin decide', () => {
    expect(sql).toMatch(/reason text not null check \(length\(trim\(reason\)\) > 0\)/)
    expect(sql).toMatch(/on builder_workstream_limit_requests\(builder_id\) where status = 'pending'/)
    expect(sql).toMatch(/with check \(builder_id = auth\.uid\(\) and status = 'pending' and decided_by is null and decided_at is null\)/)
    expect(sql).toMatch(/"builder_workstream_limit_requests_admin_decide" on builder_workstream_limit_requests\s+for update using \(is_admin\(auth\.uid\(\)\)\)/)
    expect(sql).toMatch(/"builder_workstream_limits_admin_write" on builder_workstream_limits\s+for all using \(is_admin\(auth\.uid\(\)\)\)/)
  })
})
