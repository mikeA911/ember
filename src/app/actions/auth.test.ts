import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

let supabase: ReturnType<typeof createFakeSupabase> & { auth?: unknown }
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => supabase }))

const { ensureProfile } = await import('./auth')

function withUser(user: { id: string; email?: string; is_anonymous?: boolean } | null, queued: Parameters<typeof createFakeSupabase>[0]) {
  supabase = Object.assign(createFakeSupabase(queued), { auth: { getUser: async () => ({ data: { user } }) } })
}

// Self-registration is off: only an admin creates real accounts.
describe('ensureProfile', () => {
  beforeEach(() => {
    supabase = createFakeSupabase({})
  })

  it('returns an existing profile', async () => {
    withUser({ id: 'u-1', email: 'a@example.com' }, { profiles: [{ data: { id: 'u-1', role: 'consultant' }, error: null }] })
    expect(await ensureProfile()).toEqual({ id: 'u-1', role: 'consultant' })
  })

  it('never creates a profile for a real user an admin did not set up', async () => {
    withUser({ id: 'u-2', email: 'stranger@example.com' }, { profiles: [{ data: null, error: null }] })
    expect(await ensureProfile()).toBeNull()
    expect(supabase._calls.some((c) => c.method === 'insert')).toBe(false)
  })

  it('still creates the anonymous profile for an anonymous session', async () => {
    withUser({ id: 'anon-1', is_anonymous: true }, {
      profiles: [
        { data: null, error: null },
        { data: { id: 'anon-1', role: 'anonymous' }, error: null },
      ],
    })
    await ensureProfile()
    const insert = supabase._calls.find((c) => c.table === 'profiles' && c.method === 'insert')
    expect(insert?.args).toMatchObject({ id: 'anon-1', role: 'anonymous' })
  })
})

describe('disable self-registration migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261009100001_disable_self_registration.sql'), 'utf-8')

  it('drops the policy that let a signed-up user make themselves a consultant', () => {
    expect(sql).toMatch(/drop policy if exists "profiles_insert_self_consultant" on profiles;/)
    expect(sql.replace(/^--.*$/gm, '')).not.toMatch(/create policy/)
  })
})
