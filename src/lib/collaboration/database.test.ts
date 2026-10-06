import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Real PostgreSQL, in memory: the checked-in migration runs against a small
// stand-in for the tables it references. Never reads .env.local or
// contacts Supabase. PGlite has one connection, so lock races are covered
// separately by scripts/collaboration-concurrency-check.mjs.
const MIGRATIONS = ['supabase/migrations/20261023100001_collaboration_sessions.sql', 'supabase/migrations/20261024100001_collaboration_shared_editing.sql']
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const host = id(1), guest = id(2), outsider = id(3), third = id(4)
const project = id(10), otherProject = id(11)
const workstream = id(20), foreignWorkstream = id(21)
const hostTab = id(30), guestTab = id(31), hostTab2 = id(32), guestTab2 = id(33)

let db: PGlite
// The functions return JSON DTOs; tests read into them freely.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any

async function as(user: string, jwt: Record<string, unknown> = {}) {
  await db.query("select set_config('test.actor', $1, false), set_config('test.jwt', $2, false)", [user, JSON.stringify(jwt)])
}
async function call<T = Json>(fn: string, ...args: unknown[]): Promise<T> {
  const params = args.map((_, i) => `$${i + 1}`).join(', ')
  const { rows } = await db.query<{ r: T }>(`select public.${fn}(${params}) as r`, args)
  return rows[0].r
}
async function asAdmin(sql: string) {
  await db.exec(`reset role; ${sql}; set role authenticated;`)
}
async function errorOf(p: Promise<unknown>): Promise<{ code?: string; message: string }> {
  try {
    await p
  } catch (e) {
    return e as { code?: string; message: string }
  }
  throw new Error('expected an error')
}

// Host invites, guest accepts from guestTab, host joins from hostTab.
async function liveSession() {
  await as(host)
  const inv = await call('collaboration_invite', project, guest)
  await as(guest)
  const { sessionId } = await call('collaboration_respond_invitation', inv.id, true, guestTab)
  await as(host)
  const snap = await call('collaboration_join', sessionId, hostTab, false)
  return { sessionId: sessionId as string, snap }
}

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.actor', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt', true), ''), '{}')::jsonb $$;
    create table profiles(id uuid primary key, email text not null, full_name text, is_active boolean not null default true, role text not null default 'member');
    create table projects(id uuid primary key, name text not null, goal text, objective text, starter_prompt text);
    create table project_members(project_id uuid references projects(id), user_id uuid references profiles(id), role text not null default 'viewer', status text not null default 'active');
    create table project_workstreams(id uuid primary key, project_id uuid references projects(id), name text not null, summary text, deliverables jsonb not null default '[]');
    -- The app's permission helpers, as defined in 20260808190009 / 20260810120001.
    create function is_admin(uid uuid) returns boolean language sql stable as $$ select exists (select 1 from profiles where id = uid and role = 'admin' and is_active) $$;
    create function can_manage_project(pid uuid, uid uuid) returns boolean language sql stable as $$
      select is_admin(uid) or exists (select 1 from project_members where project_id = pid and user_id = uid and status = 'active' and role = 'owner') $$;
    create function can_curate_project(pid uuid, uid uuid) returns boolean language sql stable as $$
      select is_admin(uid) or exists (select 1 from project_members where project_id = pid and user_id = uid and status = 'active' and role in ('owner', 'curator')) $$;
    create table conversations(id uuid primary key, user_id uuid references profiles(id));
    grant usage on schema auth to authenticated;
  `)
  for (const file of MIGRATIONS) {
    const migration = readFileSync(file, 'utf8')
    await db.exec(migration)
    // Safe to re-run.
    await db.exec(migration)
  }
}, 60000)

beforeEach(async () => {
  await db.exec(`
    reset role;
    truncate collaboration_saves, collaboration_drafts, collaboration_events, collaboration_watchers, collaboration_viewers, collaboration_participants, collaboration_invitations, collaboration_sessions,
      collaboration_conversations, conversations, project_members, project_workstreams, projects, profiles cascade;
    insert into profiles values ('${host}', 'host@example.test', 'Hana Host', true), ('${guest}', 'guest@example.test', 'Gil Guest', true),
      ('${outsider}', 'out@example.test', 'Olu Outsider', true), ('${third}', 'third@example.test', null, true);
    insert into projects values ('${project}', 'Test Project'), ('${otherProject}', 'Other Project');
    insert into project_members values ('${project}', '${host}', 'owner', 'active'), ('${project}', '${guest}', 'viewer', 'active'),
      ('${project}', '${third}', 'curator', 'active'), ('${otherProject}', '${outsider}', 'owner', 'active');
    insert into project_workstreams(id, project_id, name, deliverables) values
      ('${workstream}', '${project}', 'Intake', '[{"label":"Call flow","completed":false},{"label":"Staffing","completed":false}]'),
      ('${foreignWorkstream}', '${otherProject}', 'Elsewhere', '[]');
    insert into conversations values ('${id(40)}', '${host}'), ('${id(41)}', '${guest}');
    set role authenticated;
  `)
  await as(host)
})

afterAll(async () => {
  await db?.close()
})

describe('invitations', () => {
  it('offers only other active members of the Project as candidates', async () => {
    const candidates = await call<{ userId: string; name: string }[]>('collaboration_candidates', project)
    expect(candidates.map((c) => c.userId).sort()).toEqual([guest, third].sort())
    expect(candidates.find((c) => c.userId === third)?.name).toBe('third@example.test')
    await as(outsider)
    expect((await errorOf(call('collaboration_candidates', project))).code).toBe('42501')
  })

  it('requires both people to be active members, and refuses self-invites', async () => {
    expect((await errorOf(call('collaboration_invite', project, outsider))).message).toMatch(/active members/)
    expect((await errorOf(call('collaboration_invite', project, host))).message).toMatch(/another Project member/)
    await as(outsider)
    expect((await errorOf(call('collaboration_invite', project, guest))).message).toMatch(/active members/)
  })

  it('returns the same pending invitation when re-sent, and only the invitee can answer it', async () => {
    const a = await call('collaboration_invite', project, guest)
    const b = await call('collaboration_invite', project, guest)
    expect(b.id).toBe(a.id)
    expect((await errorOf(call('collaboration_respond_invitation', a.id, true, hostTab))).code).toBe('42501')
    // A forwarded invitation grants nothing to another member.
    await as(third)
    expect((await errorOf(call('collaboration_respond_invitation', a.id, true, null))).code).toBe('42501')
    await as(guest)
    const status = await call('collaboration_status', guestTab, null)
    expect(status.incoming).toMatchObject([{ id: a.id, inviterName: 'Hana Host', projectName: 'Test Project', status: 'pending' }])
  })

  it('accepting starts a session with the host in control; a repeated accept returns the same session', async () => {
    const inv = await call('collaboration_invite', project, guest)
    await as(guest)
    const first = await call('collaboration_respond_invitation', inv.id, true, guestTab)
    const again = await call('collaboration_respond_invitation', inv.id, true, guestTab)
    expect(again.sessionId).toBe(first.sessionId)
    const status = await call('collaboration_status', guestTab, null)
    expect(status.session).toMatchObject({
      id: first.sessionId,
      status: 'active',
      myRole: 'guest',
      controllerId: host,
      thisTabJoined: true,
      location: { workstreamId: null },
    })
    expect(status.incoming).toEqual([])
  })

  it('records a decline and a cancel, and refuses expired invitations', async () => {
    const inv = await call('collaboration_invite', project, guest)
    await as(guest)
    expect((await call('collaboration_respond_invitation', inv.id, false, null)).invitation.status).toBe('declined')
    await as(host)
    const second = await call('collaboration_invite', project, guest)
    expect(second.id).not.toBe(inv.id)
    expect((await call('collaboration_cancel_invitation', second.id)).status).toBe('cancelled')
    const third_ = await call('collaboration_invite', project, guest)
    await asAdmin(`update collaboration_invitations set expires_at = now() - interval '1 second' where id = '${third_.id}'`)
    await as(guest)
    expect((await errorOf(call('collaboration_respond_invitation', third_.id, true, guestTab))).message).toMatch(/no longer available/)
    expect((await call('collaboration_status', null, null)).incoming).toEqual([])
  })

  it('keeps one pending invitation per inviter and one live session per person', async () => {
    const toGuest = await call('collaboration_invite', project, guest)
    await call('collaboration_invite', project, third)
    await as(guest)
    expect((await errorOf(call('collaboration_respond_invitation', toGuest.id, true, guestTab))).message).toMatch(/no longer available/)
    await liveSession()
    await as(host)
    expect((await errorOf(call('collaboration_invite', project, third))).message).toMatch(/already in a live session/)
  })

  it('records an Ember-created invitation only against the caller’s own conversation', async () => {
    expect((await errorOf(call('collaboration_invite', project, guest, null, 'assistant', id(41)))).code).toBe('42501')
    const inv = await call('collaboration_invite', project, guest, null, 'assistant', id(40))
    expect(inv.status).toBe('pending')
  })
})

describe('direct access', () => {
  it('denies direct table reads and writes, even to a participant', async () => {
    await liveSession()
    expect((await errorOf(db.query('select * from collaboration_sessions'))).message).toMatch(/permission denied/)
    expect((await errorOf(db.query(`update collaboration_sessions set controller_id = '${guest}'`))).message).toMatch(/permission denied/)
    expect((await errorOf(db.query('select public.collaboration_has_access($1, $2)', [project, host]))).message).toMatch(/permission denied/)
  })

  it('never returns connection ids', async () => {
    const { snap } = await liveSession()
    const text = JSON.stringify(snap) + JSON.stringify(await call('collaboration_status', hostTab, null))
    for (const tab of [hostTab, guestTab]) expect(text).not.toContain(tab)
  })

  it('lets an external read-only MCP token read but never write', async () => {
    const { sessionId } = await liveSession()
    await as(host, { client_id: 'some-chatbot' })
    expect(await call('collaboration_history')).toHaveLength(1)
    expect((await errorOf(call('collaboration_status', hostTab, null))).code).toBe('42501')
    expect((await errorOf(call('collaboration_end', sessionId))).code).toBe('42501')
    expect((await errorOf(call('collaboration_invite', project, third))).code).toBe('42501')
  })
})

describe('browser tabs', () => {
  it('refuses a second tab unless it takes over, and the old tab then loses control', async () => {
    const { sessionId, snap } = await liveSession()
    expect((await errorOf(call('collaboration_join', sessionId, hostTab2, false))).code).toBe('EC002')
    const taken = await call('collaboration_join', sessionId, hostTab2, true)
    expect(taken.controlGeneration).toBe(snap.controlGeneration + 1)
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, taken.controlGeneration, workstream))).code).toBe('EC003')
    expect((await call('collaboration_navigate', sessionId, hostTab2, taken.controlGeneration, workstream)).location.workstreamId).toBe(workstream)
    // The old tab sees it is no longer the joined tab.
    expect((await call('collaboration_status', hostTab, null)).session).toMatchObject({ thisTabJoined: false, otherTabActive: true })
  })

  it('a refresh in the same tab rejoins without changing control', async () => {
    const { sessionId, snap } = await liveSession()
    const again = await call('collaboration_join', sessionId, hostTab, false)
    expect(again.controlGeneration).toBe(snap.controlGeneration)
  })

  it('a non-controller taking over a tab does not change the control generation', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    const taken = await call('collaboration_join', sessionId, guestTab2, true)
    expect(taken.controlGeneration).toBe(snap.controlGeneration)
  })
})

describe('navigation', () => {
  it('only the controller moves the shared view, within the Project', async () => {
    const { sessionId, snap } = await liveSession()
    const moved = await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    expect(moved.location).toEqual({ workstreamId: workstream, workstreamName: 'Intake' })
    expect(moved.stateRevision).toBeGreaterThan(snap.stateRevision)
    const same = await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    expect(same.stateRevision).toBe(moved.stateRevision)
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, foreignWorkstream))).message).toMatch(/not in this Project/)
    await as(guest)
    expect((await errorOf(call('collaboration_navigate', sessionId, guestTab, snap.controlGeneration, null))).message).toMatch(/Ask for control/)
    expect((await call('collaboration_status', guestTab, null)).session.location.workstreamId).toBe(workstream)
  })
})

describe('control', () => {
  it('hands over by request and grant, and rejects the former controller and stale grants', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    const requested = await call('collaboration_request_control', sessionId, guestTab, false)
    expect(requested.controlRequestedBy).toBe(guest)
    await as(host)
    const granted = await call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true)
    expect(granted).toMatchObject({ controllerId: guest, controlGeneration: snap.controlGeneration + 1, controlRequestedBy: null })
    expect((await errorOf(call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true))).message).toMatch(/Only the person in control/)
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, granted.controlGeneration, workstream))).message).toMatch(/Ask for control/)
    await as(guest)
    // A navigation issued before the handover (old generation) is refused.
    expect((await errorOf(call('collaboration_navigate', sessionId, guestTab, snap.controlGeneration, workstream))).code).toBe('EC003')
    expect((await call('collaboration_navigate', sessionId, guestTab, granted.controlGeneration, workstream)).location.workstreamId).toBe(workstream)
  })

  it('declines and withdrawals clear the request without moving control', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    await as(host)
    const declined = await call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, false)
    expect(declined).toMatchObject({ controllerId: host, controlRequestedBy: null, controlGeneration: snap.controlGeneration })
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    expect((await call('collaboration_request_control', sessionId, guestTab, true)).controlRequestedBy).toBeNull()
    await as(host)
    expect((await errorOf(call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true))).message).toMatch(/no request/)
  })

  it('the host can reclaim control; the guest cannot', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    expect((await errorOf(call('collaboration_reclaim_control', sessionId, guestTab))).message).toMatch(/Only the host/)
    await as(host)
    await call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true)
    const reclaimed = await call('collaboration_reclaim_control', sessionId, hostTab)
    expect(reclaimed).toMatchObject({ controllerId: host, controlGeneration: snap.controlGeneration + 2 })
  })

  it('never moves control because someone disconnected', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    // The host's tab stops polling (past the 90-second presence window).
    await asAdmin(`update collaboration_participants set last_seen_at = now() - interval '2 minutes' where user_id = '${host}'`)
    const seen = (await call('collaboration_status', guestTab, null)).session
    expect(seen).toMatchObject({ controllerId: host, host: { present: false }, guest: { present: true } })
    await as(host)
    // The stale tab cannot act until it rejoins; rejoining the same tab keeps control.
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream))).code).toBe('EC003')
    const back = await call('collaboration_join', sessionId, hostTab, false)
    expect(back).toMatchObject({ controllerId: host, controlGeneration: snap.controlGeneration })
    // Granting to someone who is not connected is refused.
    await asAdmin(`update collaboration_participants set last_seen_at = now() - interval '2 minutes' where user_id = '${guest}'`)
    expect((await errorOf(call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true))).message).toMatch(/not connected/)
  })
})

describe('leaving, ending and history', () => {
  it('a controller who leaves passes control on, visibly; when both leave the session ends', async () => {
    const { sessionId, snap } = await liveSession()
    const left = await call('collaboration_leave', sessionId)
    expect(left).toMatchObject({ controllerId: guest, iLeft: true, controlGeneration: snap.controlGeneration + 1 })
    await as(guest)
    expect((await call('collaboration_status', guestTab, null)).session).toMatchObject({ controllerId: guest, host: { left: true } })
    const ended = await call('collaboration_leave', sessionId)
    expect(ended).toMatchObject({ status: 'ended', endReason: 'everyone_left' })
  })

  it('a participant who left can rejoin while the session is live', async () => {
    const { sessionId } = await liveSession()
    await as(guest)
    await call('collaboration_leave', sessionId)
    expect(await call('collaboration_join', sessionId, guestTab, false)).toMatchObject({ iLeft: false, thisTabJoined: true })
  })

  it('only the host ends; the conversation stays in both histories and can be resumed', async () => {
    const { sessionId } = await liveSession()
    await as(guest)
    expect((await errorOf(call('collaboration_end', sessionId))).message).toMatch(/Only the host/)
    await as(host)
    expect(await call('collaboration_end', sessionId)).toMatchObject({ status: 'ended', endReason: 'ended_by_host' })
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, 99, null))).message).toMatch(/has ended/)
    const hostHistory = await call<Json[]>('collaboration_history')
    await as(guest)
    const guestHistory = await call<Json[]>('collaboration_history')
    expect(hostHistory).toHaveLength(1)
    expect(guestHistory).toMatchObject([{ id: hostHistory[0].id, otherName: 'Hana Host', projectName: 'Test Project', liveSessionId: null }])
    expect(hostHistory[0]).toMatchObject({ otherName: 'Gil Guest' })
    // The guest invites the host to resume: same conversation, guest hosts.
    const resume = await call('collaboration_invite', project, host, guestHistory[0].id)
    await as(host)
    const { sessionId: second } = await call('collaboration_respond_invitation', resume.id, true, hostTab)
    expect(second).not.toBe(sessionId)
    const shell = await call('collaboration_conversation', guestHistory[0].id)
    expect(shell.sessions).toHaveLength(2)
    expect(shell.sessions[0]).toMatchObject({ id: second, hostName: 'Gil Guest', status: 'active' })
    // Nobody else can read it, or resume it into a different pair.
    await as(third)
    expect((await errorOf(call('collaboration_conversation', guestHistory[0].id))).code).toBe('42501')
    expect(await call('collaboration_history')).toEqual([])
    expect((await errorOf(call('collaboration_invite', project, guest, guestHistory[0].id))).code).toBe('42501')
  })

  it('a previous session’s tab cannot act on the next one', async () => {
    const { sessionId } = await liveSession()
    await call('collaboration_end', sessionId)
    const [conversation] = await call<Json[]>('collaboration_history')
    const resume = await call('collaboration_invite', project, guest, conversation.id)
    await as(guest)
    await call('collaboration_respond_invitation', resume.id, true, guestTab)
    await as(host)
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, 1, null))).message).toMatch(/has ended/)
  })
})

describe('revocation and expiry', () => {
  it('ends the session and hides history when either person loses Project access', async () => {
    const { sessionId } = await liveSession()
    await asAdmin(`update project_members set status = 'inactive' where user_id = '${guest}'`)
    const status = await call('collaboration_status', hostTab, sessionId)
    expect(status.session).toMatchObject({ id: sessionId, status: 'ended', endReason: 'access_revoked' })
    expect(await call('collaboration_history')).toEqual([])
    await as(guest)
    expect((await errorOf(call('collaboration_join', sessionId, guestTab, false))).code).toBe('42501')
    expect((await call('collaboration_status', guestTab, sessionId)).session).toBeNull()
    // Access restored: history returns; the ended session stays ended.
    await asAdmin(`update project_members set status = 'active' where user_id = '${guest}'`)
    expect(await call('collaboration_history')).toHaveLength(1)
    await asAdmin(`update profiles set is_active = false where id = '${host}'`)
    await as(host)
    expect((await errorOf(call('collaboration_history'))).code).toBe('42501')
  })

  it('ends a session nobody has used for 30 minutes, so it never blocks a new invitation', async () => {
    const { sessionId } = await liveSession()
    await asAdmin(`update collaboration_participants set last_active_at = now() - interval '31 minutes'`)
    const inv = await call('collaboration_invite', project, third)
    expect(inv.status).toBe('pending')
    expect((await call('collaboration_status', hostTab, sessionId)).session).toMatchObject({ status: 'ended', endReason: 'inactive' })
  })

  it('keeps every row: ending and expiring only change status', async () => {
    const { sessionId } = await liveSession()
    await call('collaboration_end', sessionId)
    await db.exec('reset role')
    const { rows } = await db.query<{ sessions: number; participants: number; invitations: number; events: number }>(
      `select (select count(*)::int from collaboration_sessions) sessions, (select count(*)::int from collaboration_participants) participants,
              (select count(*)::int from collaboration_invitations) invitations, (select count(*)::int from collaboration_events) events`
    )
    await db.exec('set role authenticated')
    expect(rows[0]).toMatchObject({ sessions: 1, participants: 2, invitations: 1 })
    expect(rows[0].events).toBeGreaterThanOrEqual(4)
  })
})

describe('inactivity', () => {
  const inactive = (user: string, minutes: number) =>
    asAdmin(`update collaboration_participants set last_active_at = now() - interval '${minutes} minutes' where user_id = '${user}'`)

  it('shows a person as away after 10 minutes without input, and back when they use their tab', async () => {
    const { sessionId } = await liveSession()
    await inactive(guest, 11)
    const seen = (await call('collaboration_status', hostTab, null)).session
    expect(seen.guest).toMatchObject({ away: true, present: true })
    expect(seen.guest.inactiveSeconds).toBeGreaterThanOrEqual(660)
    expect(seen.host.away).toBe(false)
    await as(guest)
    // A poll without input keeps them away; with input brings them back.
    expect((await call('collaboration_status', guestTab, sessionId, false)).session.guest.away).toBe(true)
    expect((await call('collaboration_status', guestTab, sessionId, true)).session.guest.away).toBe(false)
  })

  it('counts a session command as activity', async () => {
    const { sessionId } = await liveSession()
    await inactive(guest, 11)
    await as(guest)
    expect((await call('collaboration_request_control', sessionId, guestTab, false)).guest.away).toBe(false)
  })

  it('lets the other person take control only while the controller is away or not connected', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    expect((await call('collaboration_status', guestTab, null)).session.canTakeControl).toBe(false)
    expect((await errorOf(call('collaboration_take_control', sessionId, guestTab))).message).toMatch(/is active -- ask for control/)
    await inactive(host, 11)
    expect((await call('collaboration_status', guestTab, null)).session.canTakeControl).toBe(true)
    const taken = await call('collaboration_take_control', sessionId, guestTab)
    expect(taken).toMatchObject({ controllerId: guest, controlGeneration: snap.controlGeneration + 1 })
    // The host's tab, issued before, can't move the view; the host can take control back.
    await as(host)
    expect((await errorOf(call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream))).message).toMatch(/Ask for control/)
    expect((await call('collaboration_reclaim_control', sessionId, hostTab)).controllerId).toBe(host)
  })

  it('a closed tab shows as not connected at once, without changing control, and comes back on its next poll', async () => {
    const { sessionId } = await liveSession()
    await call('collaboration_disconnect', sessionId, hostTab2)
    await as(guest)
    expect((await call('collaboration_status', guestTab, null)).session.host.present).toBe(true)
    await as(host)
    await call('collaboration_disconnect', sessionId, hostTab)
    await as(guest)
    const seen = (await call('collaboration_status', guestTab, null)).session
    expect(seen).toMatchObject({ controllerId: host, host: { present: false }, canTakeControl: true })
    await as(host)
    expect((await call('collaboration_status', hostTab, null)).session).toMatchObject({ thisTabJoined: true, host: { present: true } })
  })

  it('warns before the end: nobody active for 30 minutes, or one person inactive for 60', async () => {
    const { sessionId } = await liveSession()
    const fresh = (await call('collaboration_status', hostTab, null)).session
    expect(fresh.endingReason).toBe('inactive')
    expect(fresh.endsInSeconds).toBeGreaterThan(29 * 60)
    await inactive(host, 26)
    await inactive(guest, 26)
    await as(guest)
    const both = (await call('collaboration_status', guestTab, sessionId, false)).session
    expect(both).toMatchObject({ endingReason: 'inactive' })
    expect(both.endsInSeconds).toBeLessThanOrEqual(240)
    await asAdmin(`update collaboration_participants set last_active_at = now() where user_id = '${host}'`)
    await inactive(guest, 58)
    const one = (await call('collaboration_status', guestTab, sessionId, false)).session
    expect(one.endingReason).toBe('participant_inactive')
    expect(one.endsInSeconds).toBeLessThanOrEqual(120)
    await inactive(guest, 61)
    await as(host)
    expect((await call('collaboration_status', hostTab, sessionId)).session).toMatchObject({ status: 'ended', endReason: 'participant_inactive' })
  })

  it('never calls an overdue session live in history, even before it is settled', async () => {
    await liveSession()
    expect((await call<Json[]>('collaboration_history'))[0].liveSessionId).not.toBeNull()
    await inactive(host, 31)
    await inactive(guest, 31)
    const [item] = await call<Json[]>('collaboration_history')
    expect(item.liveSessionId).toBeNull()
    const shell = await call('collaboration_conversation', item.id)
    expect(shell.sessions[0]).toMatchObject({ status: 'ended', endReason: 'inactive' })
  })

  it('drops a control request once the requester has gone away', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    await inactive(guest, 11)
    await as(host)
    expect((await call('collaboration_status', hostTab, null)).session.controlRequestedBy).toBeNull()
    expect((await errorOf(call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true))).message).toMatch(/no request/)
  })
})

describe('viewers', () => {
  async function conversationWithViewer() {
    const { sessionId } = await liveSession()
    const [conversation] = await call<Json[]>('collaboration_history')
    await as(host)
    await call('collaboration_add_viewer', conversation.id, third)
    return { sessionId, conversationId: conversation.id as string }
  }

  it('either of the pair adds another active member; the bar lists them; re-adding is harmless', async () => {
    const { conversationId } = await conversationWithViewer()
    expect((await call('collaboration_status', hostTab, null)).session.viewers).toMatchObject([{ userId: third, name: 'third@example.test', addedByName: 'Hana Host' }])
    await as(guest)
    expect(await call('collaboration_add_viewer', conversationId, third)).toHaveLength(1)
    expect((await errorOf(call('collaboration_add_viewer', conversationId, host))).message).toMatch(/other than the two of you/)
    expect((await errorOf(call('collaboration_add_viewer', conversationId, outsider))).message).toMatch(/active members/)
  })

  it('a viewer, or anyone else, cannot add viewers', async () => {
    const { conversationId } = await conversationWithViewer()
    await as(third)
    expect((await errorOf(call('collaboration_add_viewer', conversationId, guest))).code).toBe('42501')
    await as(outsider)
    expect((await errorOf(call('collaboration_add_viewer', conversationId, third))).code).toBe('42501')
  })

  it('a viewer sees the conversation in their history and its page, read-only, and never the live session', async () => {
    const { sessionId, conversationId } = await conversationWithViewer()
    await as(third)
    expect(await call<Json[]>('collaboration_history')).toMatchObject([
      { id: conversationId, myRole: 'viewer', otherUserId: null, otherName: 'Hana Host & Gil Guest' },
    ])
    const shell = await call('collaboration_conversation', conversationId)
    expect(shell).toMatchObject({ myRole: 'viewer', otherUserId: null, pendingInvitation: null })
    expect(shell.participants.map((p: Json) => p.name)).toEqual(['Hana Host', 'Gil Guest'])
    // No live view: no session in their status, and no session commands.
    expect((await call('collaboration_status', id(50), null)).session).toBeNull()
    expect((await errorOf(call('collaboration_join', sessionId, id(50), false))).code).toBe('42501')
    expect((await errorOf(call('collaboration_invite', project, host, conversationId))).code).toBe('42501')
    expect((await errorOf(call('collaboration_end', sessionId))).code).toBe('42501')
  })

  it('removing a viewer (by the pair, or themselves) hides it from them; nothing is deleted', async () => {
    const { conversationId } = await conversationWithViewer()
    await as(third)
    await call('collaboration_remove_viewer', conversationId, third)
    expect(await call<Json[]>('collaboration_history')).toEqual([])
    expect((await errorOf(call('collaboration_conversation', conversationId))).code).toBe('42501')
    await as(host)
    await call('collaboration_add_viewer', conversationId, third)
    await as(guest)
    expect(await call('collaboration_remove_viewer', conversationId, third)).toEqual([])
    await db.exec('reset role')
    const { rows } = await db.query<{ status: string; events: number }>(
      `select (select status from collaboration_viewers) status, (select count(*)::int from collaboration_events where event like 'viewer_%') events`
    )
    await db.exec('set role authenticated')
    expect(rows[0]).toEqual({ status: 'removed', events: 4 })
  })

  it('a viewer who loses Project access drops out without ending anything; losing the pair hides it from the viewer too', async () => {
    const { conversationId } = await conversationWithViewer()
    await asAdmin(`update project_members set status = 'inactive' where user_id = '${third}'`)
    await as(third)
    expect(await call<Json[]>('collaboration_history')).toEqual([])
    await as(host)
    const seen = (await call('collaboration_status', hostTab, null)).session
    expect(seen).toMatchObject({ status: 'active', viewers: [] })
    await asAdmin(`update project_members set status = 'active' where user_id = '${third}'`)
    await asAdmin(`update project_members set status = 'inactive' where user_id = '${guest}'`)
    await as(third)
    expect(await call<Json[]>('collaboration_history')).toEqual([])
    expect((await errorOf(call('collaboration_conversation', conversationId))).code).toBe('42501')
  })
})

describe('watching', () => {
  const viewerTab = id(60), viewerTab2 = id(61)
  async function watchable() {
    const { sessionId, snap } = await liveSession()
    const [conversation] = await call<Json[]>('collaboration_history')
    await call('collaboration_add_viewer', conversation.id, third)
    await as(third)
    return { sessionId, snap, conversationId: conversation.id as string }
  }

  it('a viewer is told a session is live without watching it, and watches only when they choose', async () => {
    const { sessionId } = await watchable()
    const status = await call('collaboration_status', viewerTab, null)
    expect(status.session).toBeNull()
    expect(status.watchable).toMatchObject([{ sessionId, hostName: 'Hana Host', guestName: 'Gil Guest', projectName: 'Test Project' }])
    await as(host)
    expect((await call('collaboration_status', hostTab, null)).session.watching).toEqual([])
    await as(third)
    const watching = await call('collaboration_watch', sessionId, viewerTab)
    expect(watching).toMatchObject({ status: 'active', thisTabWatching: true, controllerId: host, location: { workstreamId: null } })
    await as(host)
    expect((await call('collaboration_status', hostTab, null)).session.watching).toMatchObject([{ userId: third }])
  })

  it('a watcher follows the controller but has no control at all', async () => {
    const { sessionId, snap } = await watchable()
    await call('collaboration_watch', sessionId, viewerTab)
    await as(host)
    await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    await as(third)
    expect((await call('collaboration_watch_status', sessionId, viewerTab)).location).toEqual({ workstreamId: workstream, workstreamName: 'Intake' })
    for (const [fn, args] of [
      ['collaboration_request_control', [sessionId, viewerTab, false]],
      ['collaboration_take_control', [sessionId, viewerTab]],
      ['collaboration_navigate', [sessionId, viewerTab, snap.controlGeneration, null]],
      ['collaboration_join', [sessionId, viewerTab, true]],
      ['collaboration_end', [sessionId]],
    ] as const) {
      expect((await errorOf(call(fn, ...args))).code, fn).toBe('42501')
    }
  })

  it('watching never touches the pair’s rules: no session of their own, no effect on the deadline', async () => {
    const { sessionId } = await watchable()
    await call('collaboration_watch', sessionId, viewerTab)
    expect((await call('collaboration_status', viewerTab, null)).session).toBeNull()
    // Watching isn't being in a live session: the watcher can still invite someone.
    const inv = await call('collaboration_invite', project, host)
    expect(inv.status).toBe('pending')
    // Both of the pair inactive past the limit: the session ends however active the watcher is.
    await asAdmin(`update collaboration_participants set last_active_at = now() - interval '31 minutes'`)
    await as(third)
    expect((await call('collaboration_watch_status', sessionId, viewerTab))).toMatchObject({ status: 'ended', endReason: 'inactive' })
    expect((await call('collaboration_status', viewerTab, null)).watchable).toEqual([])
    expect((await errorOf(call('collaboration_watch', sessionId, viewerTab))).message).toMatch(/has ended/)
  })

  it('a later tab takes over watching; stopping is quiet and recorded', async () => {
    const { sessionId } = await watchable()
    await call('collaboration_watch', sessionId, viewerTab)
    await call('collaboration_watch', sessionId, viewerTab2)
    expect((await call('collaboration_watch_status', sessionId, viewerTab)).thisTabWatching).toBe(false)
    await call('collaboration_stop_watching', sessionId, viewerTab)
    expect((await call('collaboration_watch_status', sessionId, viewerTab2)).thisTabWatching).toBe(true)
    await call('collaboration_stop_watching', sessionId, viewerTab2)
    await as(host)
    expect((await call('collaboration_status', hostTab, null)).session.watching).toEqual([])
  })

  it('only viewers watch; removal or lost access stops it on the next poll', async () => {
    const { sessionId, conversationId } = await watchable()
    await as(outsider)
    expect((await errorOf(call('collaboration_watch', sessionId, id(70)))).code).toBe('42501')
    await as(third)
    await call('collaboration_watch', sessionId, viewerTab)
    await as(host)
    await call('collaboration_remove_viewer', conversationId, third)
    expect((await call('collaboration_status', hostTab, null)).session.watching).toEqual([])
    await as(third)
    expect((await errorOf(call('collaboration_watch_status', sessionId, viewerTab))).code).toBe('42501')
  })

  it('a viewer in a live session of their own can’t watch another', async () => {
    const { sessionId } = await watchable()
    await as(third)
    const inv = await call('collaboration_invite', project, outsider).catch(() => null)
    expect(inv).toBeNull()
    await asAdmin(`insert into project_members values ('${project}', '${outsider}', 'viewer', 'active')`)
    const own = await call('collaboration_invite', project, outsider)
    await as(outsider)
    await call('collaboration_respond_invitation', own.id, true, id(71))
    await as(third)
    expect((await errorOf(call('collaboration_watch', sessionId, viewerTab))).message).toMatch(/in a live session yourself/)
  })
})

describe('shared editing (Phase 2)', () => {
  const field = (snap: Json, name: string) => snap.fields.find((f: Json) => f.field === name)
  const asRole = (user: string, role: string) => asAdmin(`update project_members set role = '${role}' where user_id = '${user}' and project_id = '${project}'`)
  const saved = async (column: string) => {
    await db.exec('reset role')
    const { rows } = await db.query<{ v: string | null }>(`select ${column} as v from projects where id = '${project}'`)
    await db.exec('set role authenticated')
    return rows[0].v
  }

  it('the controller drafts, the other person sees it as it is typed, and Save writes it', async () => {
    const { sessionId, snap } = await liveSession()
    expect(field(snap, 'project_goal')).toMatchObject({ saved: null, draft: null, canEdit: true })
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, '  Ship the new CAD  ', false)
    await as(guest)
    const seen = (await call('collaboration_status', guestTab, null)).session
    expect(field(seen, 'project_goal')).toMatchObject({ saved: null, canEdit: false, draft: { value: '  Ship the new CAD  ', editorName: 'Hana Host', baseChanged: false } })
    expect(seen.openDrafts).toMatchObject([{ field: 'project_goal', editorName: 'Hana Host' }])
    await as(host)
    const after = await call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, id(80))
    expect(field(after, 'project_goal')).toMatchObject({ saved: 'Ship the new CAD', draft: null })
    expect(after.openDrafts).toEqual([])
    expect(await saved('goal')).toBe('Ship the new CAD')
  })

  it('a retried save returns the first result and never saves twice', async () => {
    const { sessionId, snap } = await liveSession()
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_objective', project, 'First', false)
    await call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_objective', project, id(81))
    await asAdmin(`update projects set objective = 'Changed later' where id = '${project}'`)
    // The same request again: no error, and the later text isn't overwritten.
    await call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_objective', project, id(81))
    expect(await saved('objective')).toBe('Changed later')
  })

  it('only the controller edits, on the page being shared', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    expect((await errorOf(call('collaboration_set_draft', sessionId, guestTab, snap.controlGeneration, 'project_goal', project, 'x', false))).message).toMatch(/Ask for control/)
    await as(host)
    expect((await errorOf(call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'workstream_summary', workstream, 'x', false))).message).toMatch(/isn't on the page being shared/)
    const moved = await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    expect(moved.fields.map((f: Json) => f.field)).toEqual(['workstream_summary', 'workstream_deliverables'])
    expect((await errorOf(call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'x', false))).message).toMatch(/isn't on the page being shared/)
    expect((await errorOf(call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'workstream_summary', foreignWorkstream, 'x', false))).message).toMatch(/isn't on the page being shared/)
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'workstream_summary', workstream, 'Findings', false)
    expect(field(await call('collaboration_status', hostTab, null).then((r: Json) => r.session), 'workstream_summary').draft.value).toBe('Findings')
  })

  it('control never lends anyone else’s rights: each field keeps its own permission rule', async () => {
    const { sessionId, snap } = await liveSession()
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    await as(host)
    const granted = await call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true)
    await as(guest)
    // Gil is a Project viewer: in control, but may edit nothing.
    const mine = (await call('collaboration_status', guestTab, null)).session
    expect(mine.fields.every((f: Json) => f.canEdit === false)).toBe(true)
    expect((await errorOf(call('collaboration_set_draft', sessionId, guestTab, granted.controlGeneration, 'project_objective', project, 'x', false))).message).toMatch(/can't edit this field/)
    // As a curator: the description yes, the goal (owner only) no.
    await asRole(guest, 'curator')
    await as(guest)
    await call('collaboration_set_draft', sessionId, guestTab, granted.controlGeneration, 'project_objective', project, 'Curated', false)
    expect((await errorOf(call('collaboration_set_draft', sessionId, guestTab, granted.controlGeneration, 'project_goal', project, 'x', false))).message).toMatch(/can't edit this field/)
  })

  it('a handover keeps the draft: the new controller saves it; the old one can’t', async () => {
    const { sessionId, snap } = await liveSession()
    await asRole(guest, 'curator')
    await as(host)
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_starter_prompt', project, 'Ask about the cutover', false)
    await as(guest)
    await call('collaboration_request_control', sessionId, guestTab, false)
    await as(host)
    const granted = await call('collaboration_answer_control_request', sessionId, hostTab, snap.controlGeneration, true)
    // Hana's save, sent before the handover landed, is refused; the draft stays.
    expect((await errorOf(call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_starter_prompt', project, id(82)))).message).toMatch(/Ask for control/)
    await as(guest)
    const inherited = (await call('collaboration_status', guestTab, null)).session
    expect(field(inherited, 'project_starter_prompt').draft).toMatchObject({ value: 'Ask about the cutover', editorName: 'Hana Host' })
    // A save on the old generation is refused even from the new controller's tab.
    expect((await errorOf(call('collaboration_save_field', sessionId, guestTab, snap.controlGeneration, 'project_starter_prompt', project, id(83)))).code).toBe('EC003')
    await call('collaboration_save_field', sessionId, guestTab, granted.controlGeneration, 'project_starter_prompt', project, id(84))
    expect(await saved('starter_prompt')).toBe('Ask about the cutover')
  })

  it('a change made outside the session is a visible conflict, never silently overwritten', async () => {
    const { sessionId, snap } = await liveSession()
    await asAdmin(`update projects set goal = 'Original' where id = '${project}'`)
    await as(host)
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'Mine', false)
    await asAdmin(`update projects set goal = 'Theirs' where id = '${project}'`)
    await as(host)
    const seen = (await call('collaboration_status', hostTab, null)).session
    expect(field(seen, 'project_goal')).toMatchObject({ saved: 'Theirs', draft: { value: 'Mine', baseChanged: true } })
    expect((await errorOf(call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, id(85)))).code).toBe('EC004')
    expect(await saved('goal')).toBe('Theirs')
    // Choosing to keep the draft moves its base to the current text; then it saves.
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'Mine', true)
    await call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, id(86))
    expect(await saved('goal')).toBe('Mine')
  })

  it('Cancel discards the draft and leaves the saved text alone', async () => {
    const { sessionId, snap } = await liveSession()
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'Never mind', false)
    const after = await call('collaboration_discard_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project)
    expect(field(after, 'project_goal')).toMatchObject({ saved: null, draft: null })
    expect((await errorOf(call('collaboration_save_field', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, id(87)))).message).toMatch(/no unsaved draft/)
  })

  it('deliverables are set to a value, guarded against a changed list, and a retry can’t flip them back', async () => {
    const { sessionId, snap } = await liveSession()
    await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    const done = await call('collaboration_set_deliverable', sessionId, hostTab, snap.controlGeneration, workstream, 0, 'Call flow', true, id(88))
    expect(field(done, 'workstream_deliverables').deliverables[0]).toEqual({ label: 'Call flow', completed: true })
    // The same request again, and a new request with the same value: still done.
    await call('collaboration_set_deliverable', sessionId, hostTab, snap.controlGeneration, workstream, 0, 'Call flow', true, id(88))
    const again = await call('collaboration_set_deliverable', sessionId, hostTab, snap.controlGeneration, workstream, 0, 'Call flow', true, id(89))
    expect(field(again, 'workstream_deliverables').deliverables[0].completed).toBe(true)
    expect((await errorOf(call('collaboration_set_deliverable', sessionId, hostTab, snap.controlGeneration, workstream, 1, 'Renamed', true, id(90)))).code).toBe('EC004')
    expect((await errorOf(call('collaboration_set_deliverable', sessionId, hostTab, snap.controlGeneration, workstream, 5, 'Call flow', true, id(91)))).code).toBe('EC004')
    await as(guest)
    expect(field((await call('collaboration_status', guestTab, null)).session, 'workstream_deliverables')).toMatchObject({ canEdit: false, deliverables: [{ completed: true }, { completed: false }] })
  })

  it('ending the session keeps unsaved drafts as abandoned and never saves them', async () => {
    const { sessionId, snap } = await liveSession()
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'Half-written', false)
    await call('collaboration_navigate', sessionId, hostTab, snap.controlGeneration, workstream)
    // The draft on the Project page still counts while the view is elsewhere.
    expect((await call('collaboration_status', hostTab, null)).session.openDrafts).toMatchObject([{ field: 'project_goal' }])
    await call('collaboration_end', sessionId)
    expect(await saved('goal')).toBeNull()
    await db.exec('reset role')
    const { rows } = await db.query<{ status: string }>('select status from collaboration_drafts')
    await db.exec('set role authenticated')
    expect(rows).toEqual([{ status: 'abandoned' }])
  })

  it('watchers see the fields and drafts, never with edit rights', async () => {
    const { sessionId, snap } = await liveSession()
    const [conversation] = await call<Json[]>('collaboration_history')
    await call('collaboration_add_viewer', conversation.id, third)
    await call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'Draft', false)
    await as(third)
    const watching = await call('collaboration_watch', sessionId, id(60))
    expect(field(watching, 'project_goal')).toMatchObject({ canEdit: false, draft: { value: 'Draft' } })
    // third is a Project curator, but a watcher has no edit functions at all.
    expect((await errorOf(call('collaboration_set_draft', sessionId, id(60), snap.controlGeneration, 'project_objective', project, 'x', false))).code).toBe('42501')
  })

  it('refuses over-long text and external MCP clients', async () => {
    const { sessionId, snap } = await liveSession()
    expect((await errorOf(call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'x'.repeat(20001), false))).message).toMatch(/too long/)
    await as(host, { client_id: 'chatbot' })
    expect((await errorOf(call('collaboration_set_draft', sessionId, hostTab, snap.controlGeneration, 'project_goal', project, 'x', false))).code).toBe('42501')
  })
})
