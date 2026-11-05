import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

// The calm workspace's saved view (20261112100001_view_settings.sql), on
// real PostgreSQL in memory with a stand-in for auth and profiles.
const me = '00000000-0000-4000-8000-000000000001'
const other = '00000000-0000-4000-8000-000000000002'
let db: PGlite

async function as(user: string, jwt: Record<string, unknown> = {}) {
  await db.query("select set_config('test.actor', $1, false), set_config('test.jwt', $2, false)", [user, JSON.stringify(jwt)])
}
async function call<T = unknown>(fn: string, ...args: unknown[]): Promise<T> {
  const { rows } = await db.query<{ r: T }>(`select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) as r`, args)
  return rows[0].r
}
async function errorOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (e) {
    return (e as Error).message
  }
  throw new Error('expected an error')
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
    create table profiles(id uuid primary key, is_active boolean not null default true);
    insert into profiles(id) values ('${me}'), ('${other}');
  `)
  const migration = readFileSync('supabase/migrations/20261112100001_view_settings.sql', 'utf8')
  await db.exec(migration)
  await db.exec(migration)
  await db.exec('grant usage on schema auth to authenticated; set role authenticated')
}, 30000)

describe('saved view', () => {
  it('keeps each person’s view to themselves', async () => {
    await as(me)
    expect(await call('view_settings_get')).toBeNull()
    await call('view_settings_save', 'mist', 30, 4)
    expect(await call('view_settings_get')).toEqual({ scene: 'mist', dim: 30, soften: 4, photoPath: null })
    await as(other)
    expect(await call('view_settings_get')).toBeNull()
    await as('')
    expect(await errorOf(call('view_settings_get'))).toMatch(/Not signed in/)
  })

  it('takes a photo only from the person’s own folder, and hands back the old one to delete', async () => {
    await as(me)
    expect(await errorOf(call('view_settings_save', 'photo', 15, 0))).toMatch(/Choose a photo first/)
    expect(await errorOf(call('view_settings_set_photo', `${other}/a.jpg`))).toMatch(/isn't yours/)
    expect(await errorOf(call('view_settings_set_photo', `${me}/../${other}/a.jpg`))).toMatch(/isn't yours/)
    expect(await call('view_settings_set_photo', `${me}/1.jpg`)).toBeNull()
    expect(await call('view_settings_get')).toMatchObject({ scene: 'photo', photoPath: `${me}/1.jpg`, dim: 30 })
    expect(await call('view_settings_set_photo', `${me}/2.jpg`)).toBe(`${me}/1.jpg`)
    expect(await call('view_settings_set_photo', null)).toBe(`${me}/2.jpg`)
    expect(await call('view_settings_get')).toMatchObject({ scene: 'ember', photoPath: null })
  })

  it('refuses changes from an external client', async () => {
    await as(me, { client_id: 'some-app' })
    expect(await errorOf(call('view_settings_save', 'dusk', 0, 0))).toMatch(/external client/)
  })

  it('rejects values out of range', async () => {
    await as(me)
    expect(await errorOf(call('view_settings_save', 'dusk', 90, 0))).toMatch(/check/)
  })
})
