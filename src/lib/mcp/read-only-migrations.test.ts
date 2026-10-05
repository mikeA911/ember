import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// Static SQL-shape assertions, same pattern as the *-rls.test.ts files (no
// live database in this suite). The external MCP server's "a chatbot token
// can never write" guarantee rests on a restrictive policy existing on every
// public table -- a table added later without it would be writable by any
// OAuth client token the owner's RLS permits.
const dir = path.join(process.cwd(), 'supabase/migrations')
const MCP_MIGRATION = '20261005100001_external_mcp_access.sql'
const sql = fs.readFileSync(path.join(dir, MCP_MIGRATION), 'utf-8')

describe('external MCP read-only enforcement', () => {
  it('applies restrictive insert/update/delete policies keyed on the client_id claim to every RLS table', () => {
    const fn = sql.slice(sql.indexOf('create or replace function apply_oauth_read_only_policies()'))
    expect(fn).toMatch(/c\.relrowsecurity/)
    for (const op of ['insert', 'update', 'delete']) {
      expect(fn).toMatch(new RegExp(`oauth_clients_no_${op} on public\\.%I as restrictive for ${op}`))
    }
    expect(fn).toMatch(/\(auth\.jwt\(\) ->> ''client_id''\) is null/)
    expect(sql).toMatch(/^select apply_oauth_read_only_policies\(\);$/m)
  })

  it('covers storage.objects', () => {
    for (const op of ['insert', 'update', 'delete']) {
      expect(sql).toMatch(new RegExp(`"oauth_clients_no_${op}" on storage\\.objects\\s+as restrictive for ${op}`))
    }
  })

  it('guards every SECURITY DEFINER function the app calls that writes', () => {
    for (const fn of ['increment_approved_chunks', 'increment_rejected_chunks', 'decrement_approved_chunks']) {
      const body = sql.slice(sql.indexOf(`create or replace function ${fn}(`))
      expect(body.slice(0, 400)).toMatch(/if \(auth\.jwt\(\) ->> 'client_id'\) is not null then\s+raise exception/)
    }
  })

  it('keeps the rate-limit and policy functions away from API roles', () => {
    expect(sql).toMatch(/revoke all on function mcp_rate_hit\(uuid, text, integer, integer\) from public, anon, authenticated;/)
    expect(sql).toMatch(/revoke all on function apply_oauth_read_only_policies\(\) from public, anon, authenticated;/)
  })

  it('every later migration that creates a table re-applies the read-only policies', () => {
    const later = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.sql') && f > MCP_MIGRATION)
      .sort()
    for (const file of later) {
      const text = fs.readFileSync(path.join(dir, file), 'utf-8')
      if (/create table/i.test(text)) {
        // Either the plain call, or the guarded form (for databases where
        // the MCP migration hasn't run yet -- when it does, its own call
        // covers every table that exists by then).
        expect(text, `${file} creates a table but never calls apply_oauth_read_only_policies()`).toMatch(
          /^select apply_oauth_read_only_policies\(\);$|if to_regprocedure\('public\.apply_oauth_read_only_policies\(\)'\) is not null then\s+perform apply_oauth_read_only_policies\(\);/m
        )
      }
    }
  })
})
