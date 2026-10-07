import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Shape test, like the other *-rls.test.ts files: no live database here.
const sql = fs
  .readFileSync(path.join(process.cwd(), 'supabase/migrations/20261030100001_builder_assigned_knowledge_bases.sql'), 'utf-8')
  .replace(/\r\n/g, '\n')

describe('builder assigned knowledge bases (20261030100001)', () => {
  for (const op of ['delete', 'insert']) {
    it(`leaves ${op} of an assigned attachment to the platform admin`, () => {
      const start = sql.indexOf(`create policy "project_knowledge_bases_${op}_curator"`)
      expect(start).toBeGreaterThan(-1)
      const section = sql.slice(start, start + 300)
      expect(section).toMatch(/can_curate_project\(project_id, auth\.uid\(\)\)/)
      expect(section).toMatch(/purpose is distinct from 'assigned_by_platform' or is_admin\(auth\.uid\(\)\)/)
    })
  }
})
