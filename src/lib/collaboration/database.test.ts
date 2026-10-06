import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import type { SharedSnapshot } from './contracts'

// Real PostgreSQL execution, entirely in memory. Never loads .env.local or
// contacts Supabase. The small base schema models the referenced existing rows.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const host = id(1), guest = id(2), outsider = id(3), project = id(4), conversation = id(5)
const hostConnection = id(6), guestConnection = id(7), workstream = id(8)
let db: PGlite
let sessionId: string | undefined
async function actor(user: string) {
  await db.query("select set_config('test.actor',$1,false)", [user])
}
async function command(name: string, options: { revision?: number; generation?: number; connection?: string; workstream?: string; guest?: string; session?: string } = {}) {
  const result = await db.query<{ result: SharedSnapshot }>(
    'select public.collaboration_command($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',
    [name, conversation, project, options.guest ?? guest, options.connection ?? null, options.revision ?? null, options.generation ?? null, options.workstream ?? null, options.session ?? sessionId ?? null],
  )
  const value = result.rows[0].result
  if (value.session) sessionId = value.session.id
  return value
}
async function joinedPair() {
  await command('invite')
  await actor(guest)
  await command('accept')
  await command('join', { connection: guestConnection })
  await actor(host)
  return command('join', { connection: hostConnection })
}
beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.actor',true),'')::uuid $$;
    create table profiles(id uuid primary key, full_name text, is_active boolean);
    create table projects(id uuid primary key, name text);
    create table project_members(project_id uuid, user_id uuid, status text);
    create table project_workstreams(id uuid primary key, project_id uuid, name text);
  `)
  await db.exec(readFileSync('supabase/migrations/20261026100001_collaboration_foundation.sql', 'utf8'))
}, 30000)
beforeEach(async () => {
  sessionId = undefined
  await db.exec(`reset role; truncate workspace_sessions,shared_conversations,project_members,project_workstreams,projects,profiles cascade;
    insert into profiles values('${host}','Host',true),('${guest}','Guest',true),('${outsider}','Outsider',true);
    insert into projects values('${project}','Test Project');
    insert into project_members values('${project}','${host}','active'),('${project}','${guest}','active');
    insert into project_workstreams values('${workstream}','${project}','Test Workstream');
    set role authenticated;`)
  await actor(host)
})
afterAll(async () => { await db?.close() })

describe('collaboration SQL boundary', () => {
  it('keeps invitations idempotent and requires invited-user acceptance', async () => {
    const first = await command('invite')
    expect((await command('invite')).id).toBe(first.id)
    await expect(command('accept')).rejects.toThrow('Invitation is not available')
    await actor(guest)
    expect((await command('accept')).session?.controller_id).toBe(host)
  })
  it('does not admit a non-member or expose someone else’s conversation', async () => {
    await expect(command('invite', { guest: outsider })).rejects.toThrow('active Project members')
    await command('invite')
    await actor(outsider)
    await expect(command('snapshot')).rejects.toThrow('access denied')
    expect(await command('history')).toEqual([])
  })
  it('denies direct table reads and writes even to a participant', async () => {
    await command('invite')
    await expect(db.query('select * from shared_conversations')).rejects.toThrow('permission denied')
    await expect(db.query("update workspace_sessions set controller_id=$1", [host])).rejects.toThrow('permission denied')
  })
  it('returns the same retained conversation to both participants after ending', async () => {
    await joinedPair()
    await command('end', { connection: hostConnection, revision: 0, generation: 0 })
    const hostHistory = await command('history')
    await actor(guest)
    const guestHistory = await command('history')
    expect(hostHistory).toMatchObject([{ id: conversation }])
    expect(guestHistory).toMatchObject([{ id: conversation }])
    expect((await command('snapshot')).session).toBeNull()
    expect((await command('resume')).session?.joined).toBe(false)
  })
  it('requires both connections and rejects observer navigation', async () => {
    await command('invite'); await actor(guest); await command('accept')
    await command('join', { connection: guestConnection })
    await expect(command('request', { connection: guestConnection, revision: 0, generation: 0 })).rejects.toThrow('Both participants')
    await actor(host); await command('join', { connection: hostConnection }); await actor(guest)
    await expect(command('navigate', { connection: guestConnection, revision: 0, generation: 0 })).rejects.toThrow('Request control')
  })
  it('hands over atomically and rejects stale controller and duplicate transitions', async () => {
    await joinedPair(); await actor(guest)
    await command('request', { connection: guestConnection, revision: 0, generation: 0 })
    await actor(host)
    const granted = await command('grant', { connection: hostConnection, revision: 1, generation: 0 })
    expect(granted.session).toMatchObject({ controller_id: guest, generation: 1, revision: 2 })
    await expect(command('grant', { connection: hostConnection, revision: 1, generation: 0 })).rejects.toThrow('Workspace changed')
    await expect(command('navigate', { connection: hostConnection, revision: 2, generation: 1 })).rejects.toThrow('Request control')
    await actor(guest)
    expect((await command('navigate', { connection: guestConnection, revision: 2, generation: 1, workstream })).session?.workstream_id).toBe(workstream)
  })
  it('binds control to a browser connection and never returns connection identifiers', async () => {
    const s = await joinedPair()
    expect(JSON.stringify(s)).not.toContain(hostConnection)
    await expect(command('join', { connection: id(90) })).rejects.toThrow('another browser tab')
    await expect(command('navigate', { connection: id(90), revision: 0, generation: 0 })).rejects.toThrow('Connection expired')
  })
  it('rejects cross-project navigation', async () => {
    await joinedPair()
    await expect(command('navigate', { connection: hostConnection, revision: 0, generation: 0, workstream: id(99) })).rejects.toThrow('outside this Project')
  })
  it('rejects delayed commands from a previous live session even when revisions match', async () => {
    await joinedPair()
    const old = sessionId!
    await command('end', { connection: hostConnection, revision: 0, generation: 0 })
    await command('resume')
    await expect(command('join', { connection: hostConnection, session: old })).rejects.toThrow('Session changed')
  })
  it('revokes reads and writes when either membership or profile becomes inactive', async () => {
    await joinedPair()
    await db.exec(`reset role; update project_members set status='inactive' where user_id='${guest}'; set role authenticated`)
    await expect(command('snapshot')).rejects.toThrow('access denied')
    expect(await command('history')).toEqual([])
    await expect(command('heartbeat', { connection: hostConnection })).rejects.toThrow('access denied')
    await db.exec(`reset role; update project_members set status='active'; update profiles set is_active=false where id='${host}'; set role authenticated`)
    await expect(command('history')).rejects.toThrow('access denied')
  })
  it('expires invitations and connection leases without silently transferring control', async () => {
    await command('invite')
    await db.exec(`reset role; update shared_conversations set invitation_expires_at=now()-interval '1 second'; set role authenticated`)
    await actor(guest); await expect(command('accept')).rejects.toThrow('Invitation is not available')
    await db.exec(`reset role; update shared_conversations set invitation_expires_at=now()+interval '1 day'; set role authenticated`)
    await command('accept'); await command('join', { connection: guestConnection }); await actor(host)
    await command('join', { connection: hostConnection })
    await db.exec(`reset role; update workspace_sessions set host_seen_at=now()-interval '1 minute'; set role authenticated`)
    await expect(command('heartbeat', { connection: hostConnection })).rejects.toThrow('Connection expired')
    const s = await command('snapshot')
    expect(s.session).toMatchObject({ host_online: false, controller_id: host })
    expect((await command('join', { connection: hostConnection })).session?.generation).toBe(1)
    await expect(command('navigate', { connection: hostConnection, revision: 0, generation: 0 })).rejects.toThrow('Workspace changed')
  })
})
