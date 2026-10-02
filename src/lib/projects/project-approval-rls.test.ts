import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// No live database in this suite -- asserts the migration's shape, same
// approach as every other *-rls.test.ts file here.
const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261004100001_project_creation_approval.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')

describe('project creation approval migration', () => {
  it('backfills existing projects as approved', () => {
    expect(sql).toMatch(/add column approval_status text not null default 'approved'/)
    expect(sql).toMatch(/check \(approval_status in \('pending', 'approved', 'rejected'\)\)/)
  })

  it('forces pending for a signed-in creator below curator, whatever the client sent', () => {
    expect(sql).toMatch(/if auth\.uid\(\) is not null and not is_curator_or_admin\(auth\.uid\(\)\) then\n\s+new\.approval_status := 'pending';/)
  })

  it('lets only the service role change the approval decision or held members', () => {
    expect(sql).toMatch(/elsif auth\.uid\(\) is not null and \(\n\s+new\.approval_status is distinct from old\.approval_status/)
    expect(sql).toMatch(/new\.pending_members is distinct from old\.pending_members/)
  })

  it('keeps an unapproved project private and members-only', () => {
    expect(sql).toMatch(/new\.approval_status <> 'approved' and \(new\.visibility <> 'private' or new\.discoverability <> 'members_only'\)/)
  })

  it('refuses active members other than the owner until approved', () => {
    expect(sql).toMatch(/before insert or update on project_members/)
    expect(sql).toMatch(/p\.approval_status <> 'approved' and new\.user_id is distinct from p\.owner_id/)
  })
})
