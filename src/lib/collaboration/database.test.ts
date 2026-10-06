import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

// Real PostgreSQL, in memory: the checked-in migration runs against a small
// stand-in for the tables it references. Never reads .env.local or
// contacts Supabase. PGlite has one connection, so lock races are covered
// separately by scripts/collaboration-concurrency-check.mjs.
const MIGRATION = 'supabase/migrations/20261023100001_collaboration_sessions.sql'
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
    create table profiles(id uuid primary key, email text not null, full_name text, is_active boolean not null default true);
    create table projects(id uuid primary key, name text not null);
    create table project_members(project_id uuid references projects(id), user_id uuid references profiles(id), role text not null default 'viewer', status text not null default 'active');
    create table project_workstreams(id uuid primary key, project_id uuid references projects(id), name text not null);
    create table conversations(id uuid primary key, user_id uuid references profiles(id));
    grant usage on schema auth to authenticated;
  `)
  const migration = readFileSync(MIGRATION, 'utf8')
  await db.exec(migration)
  // Safe to re-run.
  await db.exec(migration)
}, 60000)

beforeEach(async () => {
  await db.exec(`
    reset role;
    truncate collaboration_events, collaboration_viewers, collaboration_participants, collaboration_invitations, collaboration_sessions,
      collaboration_conversations, conversations, project_members, project_workstreams, projects, profiles cascade;
    insert into profiles values ('${host}', 'host@example.test', 'Hana Host', true), ('${guest}', 'guest@example.test', 'Gil Guest', true),
      ('${outsider}', 'out@example.test', 'Olu Outsider', true), ('${third}', 'third@example.test', null, true);
    insert into projects values ('${project}', 'Test Project'), ('${otherProject}', 'Other Project');
    insert into project_members values ('${project}', '${host}', 'owner', 'active'), ('${project}', '${guest}', 'viewer', 'active'),
      ('${project}', '${third}', 'curator', 'active'), ('${otherProject}', '${outsider}', 'owner', 'active');
    insert into project_workstreams values ('${workstream}', '${project}', 'Intake'), ('${foreignWorkstream}', '${otherProject}', 'Elsewhere');
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
