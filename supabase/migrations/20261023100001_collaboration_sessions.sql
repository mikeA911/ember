-- Shared workspace sessions, Phase 1: session foundation
-- (docs/dev-request-shared-workspace-sessions.md).
--
-- Two active members of the same Project work in one live session: both
-- browsers show the Project or Workstream page the controller is on, either
-- can ask for control, the host can take it back, and the shared
-- conversation stays in both people's history afterwards. Phase 1 shares
-- navigation only -- shared form drafts are Phase 2 and shared Ember chat is
-- Phase 3, so the conversation here is a shell (participants and sessions).
--
-- Authority lives in these tables and the functions below, never in the
-- browser: every call resolves the caller from auth.uid(), re-checks that
-- BOTH people are still active members of the Project (no admin bypass),
-- locks the session row, and validates the caller's browser tab
-- (connection) and the control generation. A command from a tab that lost
-- control, or that was issued before a handover, is rejected.
--
-- No client reads or writes the tables directly; RLS is on with no
-- policies and grants are revoked. Clients call the security-definer
-- functions, which return minimal DTOs (never connection ids).
--
-- Nothing here deletes a row: sessions and invitations end or expire by
-- status. Safe to re-run.

-- Shared conversation: a fixed pair in one Project, persisting across live
-- sessions. user_a < user_b so the pair has one spelling.
create table if not exists collaboration_conversations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  user_a uuid not null references profiles(id) on delete cascade,
  user_b uuid not null references profiles(id) on delete cascade,
  created_by uuid not null references profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  check (user_a < user_b),
  check (created_by in (user_a, user_b))
);

create index if not exists collaboration_conversations_user_a_idx on collaboration_conversations(user_a, last_activity_at desc);
create index if not exists collaboration_conversations_user_b_idx on collaboration_conversations(user_b, last_activity_at desc);

-- Invitation to a live session: a new conversation, or (conversation_id set
-- at creation) resuming an existing one. Admission only -- never grants
-- Project membership or evidence access. Expires; only the invitee can
-- accept, so a forwarded link grants nothing.
create table if not exists collaboration_invitations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  conversation_id uuid references collaboration_conversations(id) on delete cascade,
  inviter_id uuid not null references profiles(id) on delete cascade,
  invitee_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_via text not null default 'ui' check (created_via in ('ui', 'assistant')),
  assistant_conversation_id uuid references conversations(id) on delete set null,
  expires_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  check (inviter_id <> invitee_id)
);

create index if not exists collaboration_invitations_invitee_idx on collaboration_invitations(invitee_id, status, expires_at);
create index if not exists collaboration_invitations_inviter_idx on collaboration_invitations(inviter_id, status, expires_at);

-- Live session. The inviter is host and starts in control. Control moves
-- only by a recorded grant, reclaim, or the controller explicitly leaving;
-- never because someone disconnected. control_generation increases on
-- every change of controller or of the controller's tab, and on end.
-- state_revision increases on any visible change, so a poll can skip
-- unchanged snapshots. location_workstream_id null = the Project page.
create table if not exists collaboration_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references collaboration_conversations(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  host_id uuid not null references profiles(id) on delete cascade,
  guest_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  end_reason text check (end_reason in ('ended_by_host', 'everyone_left', 'expired', 'access_revoked')),
  ended_by uuid references profiles(id) on delete set null,
  controller_id uuid not null references profiles(id) on delete cascade,
  control_generation integer not null default 1,
  state_revision integer not null default 1,
  control_requested_by uuid references profiles(id) on delete set null,
  control_requested_at timestamptz,
  location_workstream_id uuid references project_workstreams(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  check (host_id <> guest_id),
  check (controller_id in (host_id, guest_id)),
  check ((status = 'ended') = (ended_at is not null))
);

create unique index if not exists collaboration_sessions_one_live_idx on collaboration_sessions(conversation_id) where status = 'active';
create index if not exists collaboration_sessions_conversation_idx on collaboration_sessions(conversation_id, started_at desc);

alter table collaboration_invitations
  add column if not exists session_id uuid references collaboration_sessions(id) on delete set null;

-- One row per person per session. connection_id is the one browser tab
-- that currently speaks for this person; last_seen_at is its presence.
create table if not exists collaboration_participants (
  session_id uuid not null references collaboration_sessions(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null check (role in ('host', 'guest')),
  connection_id uuid,
  last_seen_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  primary key (session_id, user_id)
);

create index if not exists collaboration_participants_user_idx on collaboration_participants(user_id);

-- Minimal, server-attributed audit: invitations, joins, leaves, control
-- changes and ends. No navigation trail, no content.
create table if not exists collaboration_events (
  id bigint generated always as identity primary key,
  session_id uuid references collaboration_sessions(id) on delete cascade,
  conversation_id uuid references collaboration_conversations(id) on delete cascade,
  invitation_id uuid references collaboration_invitations(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  event text not null,
  control_generation integer,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_events_session_idx on collaboration_events(session_id, created_at);

alter table collaboration_conversations enable row level security;
alter table collaboration_invitations enable row level security;
alter table collaboration_sessions enable row level security;
alter table collaboration_participants enable row level security;
alter table collaboration_events enable row level security;
revoke all on collaboration_conversations, collaboration_invitations, collaboration_sessions,
  collaboration_participants, collaboration_events from anon, authenticated;

-- Internal helpers -----------------------------------------------------------------
-- Errors meant for the person use SQLSTATE class EC (EC001 general, EC002
-- "open in another tab", EC003 "out of date -- refresh"); the app shows
-- those messages and hides anything else.

-- How long a tab counts as present without polling, how long an invitation
-- lasts, and when an idle or very long session ends on its own.
create or replace function collaboration_presence_window() returns interval
language sql immutable as $$ select interval '30 seconds' $$;
create or replace function collaboration_invitation_lifetime() returns interval
language sql immutable as $$ select interval '1 hour' $$;
create or replace function collaboration_idle_limit() returns interval
language sql immutable as $$ select interval '30 minutes' $$;
create or replace function collaboration_max_duration() returns interval
language sql immutable as $$ select interval '12 hours' $$;

-- Actual active membership with an active profile. Deliberately no admin
-- bypass: admission needs real membership for both people.
create or replace function collaboration_has_access(p_project uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_members m join profiles p on p.id = m.user_id
    where m.project_id = p_project and m.user_id = p_user and m.status = 'active' and p.is_active
  );
$$;

create or replace function collaboration_display_name(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(full_name), ''), email, 'Project member') from profiles where id = p_user;
$$;

-- The signed-in caller, with an active profile.
create or replace function collaboration_actor()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from profiles where id = v_actor and is_active) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Same, for anything that writes: an external MCP client token
-- (20261005100001_external_mcp_access.sql) is read-only, and these
-- functions run as their owner, past its restrictive policies.
create or replace function collaboration_writer()
returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'An external client cannot change collaboration sessions' using errcode = '42501';
  end if;
  return collaboration_actor();
end;
$$;

create or replace function collaboration_is_present(p collaboration_participants)
returns boolean
language sql stable as $$
  select p.left_at is null and p.connection_id is not null
    and p.last_seen_at is not null and p.last_seen_at > now() - collaboration_presence_window();
$$;

-- Ends a session (status only -- nothing is deleted).
create or replace function collaboration_end_session(p_session uuid, p_reason text, p_actor uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  update collaboration_sessions
    set status = 'ended', end_reason = p_reason, ended_by = p_actor, ended_at = now(),
        control_requested_by = null, control_requested_at = null,
        control_generation = control_generation + 1, state_revision = state_revision + 1
    where id = p_session and status = 'active';
  if found then
    update collaboration_conversations set last_activity_at = now()
      where id = (select conversation_id from collaboration_sessions where id = p_session);
    insert into collaboration_events(session_id, actor_id, event, control_generation)
      select id, p_actor, 'ended:' || p_reason, control_generation from collaboration_sessions where id = p_session;
  end if;
end;
$$;

-- Ends a live session that has lost a participant's access, gone idle, or
-- run too long. Called with the session row locked; returns true if ended.
create or replace function collaboration_settle(p_session uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  s collaboration_sessions;
  v_last_seen timestamptz;
begin
  select * into s from collaboration_sessions where id = p_session;
  if not found or s.status <> 'active' then
    return false;
  end if;
  if not collaboration_has_access(s.project_id, s.host_id) or not collaboration_has_access(s.project_id, s.guest_id) then
    perform collaboration_end_session(s.id, 'access_revoked', null);
    return true;
  end if;
  select max(last_seen_at) into v_last_seen from collaboration_participants where session_id = s.id;
  if coalesce(v_last_seen, s.started_at) < now() - collaboration_idle_limit()
     or s.started_at < now() - collaboration_max_duration() then
    perform collaboration_end_session(s.id, 'expired', null);
    return true;
  end if;
  return false;
end;
$$;

-- Ends any of this person's live sessions that have expired or lost access,
-- so a stale one never blocks a new invitation.
create or replace function collaboration_settle_user(p_user uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_session uuid;
begin
  for v_session in
    select s.id from collaboration_sessions s join collaboration_participants p on p.session_id = s.id
    where p.user_id = p_user and s.status = 'active'
    order by s.id
    for update of s
  loop
    perform collaboration_settle(v_session);
  end loop;
end;
$$;

create or replace function collaboration_in_live_session(p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from collaboration_sessions s join collaboration_participants p on p.session_id = s.id
    where p.user_id = p_user and s.status = 'active' and p.left_at is null
  );
$$;

-- Locks the session for a command from the caller. Requires the caller to
-- be a participant with access; with p_connection, also that this tab is
-- the caller's current, present tab in a live session.
create or replace function collaboration_lock(p_session uuid, p_connection uuid, p_actor uuid)
returns collaboration_sessions
language plpgsql security definer set search_path = public as $$
declare
  s collaboration_sessions;
  me collaboration_participants;
begin
  select * into s from collaboration_sessions where id = p_session for update;
  if not found or p_actor not in (s.host_id, s.guest_id) or not collaboration_has_access(s.project_id, p_actor) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if collaboration_settle(s.id) then
    select * into s from collaboration_sessions where id = p_session;
  end if;
  if s.status <> 'active' then
    raise exception 'This live session has ended' using errcode = 'EC001';
  end if;
  if p_connection is not null then
    select * into me from collaboration_participants where session_id = s.id and user_id = p_actor;
    if me.connection_id is distinct from p_connection or not coalesce(collaboration_is_present(me), false) then
      raise exception 'This tab is no longer connected to the live session -- rejoin to continue' using errcode = 'EC003';
    end if;
  end if;
  return s;
end;
$$;

create or replace function collaboration_log(s collaboration_sessions, p_actor uuid, p_event text)
returns void
language sql security definer set search_path = public as $$
  insert into collaboration_events(session_id, conversation_id, actor_id, event, control_generation)
  values (s.id, s.conversation_id, p_actor, p_event, s.control_generation);
$$;

-- What a participant's browser sees. Never includes connection ids.
create or replace function collaboration_snapshot(p_session uuid, p_actor uuid, p_connection uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s collaboration_sessions;
  h collaboration_participants;
  g collaboration_participants;
  me collaboration_participants;
  v_workstream_name text;
begin
  select * into s from collaboration_sessions where id = p_session;
  select * into h from collaboration_participants where session_id = s.id and user_id = s.host_id;
  select * into g from collaboration_participants where session_id = s.id and user_id = s.guest_id;
  me := case when p_actor = s.host_id then h else g end;
  if s.location_workstream_id is not null then
    select name into v_workstream_name from project_workstreams where id = s.location_workstream_id;
  end if;
  return jsonb_build_object(
    'id', s.id,
    'conversationId', s.conversation_id,
    'projectId', s.project_id,
    'projectName', (select name from projects where id = s.project_id),
    'status', s.status,
    'endReason', s.end_reason,
    'myRole', case when p_actor = s.host_id then 'host' else 'guest' end,
    'host', jsonb_build_object('id', s.host_id, 'name', collaboration_display_name(s.host_id),
      'present', coalesce(collaboration_is_present(h), false), 'left', h.left_at is not null),
    'guest', jsonb_build_object('id', s.guest_id, 'name', collaboration_display_name(s.guest_id),
      'present', coalesce(collaboration_is_present(g), false), 'left', g.left_at is not null),
    'controllerId', s.controller_id,
    'controlGeneration', s.control_generation,
    'stateRevision', s.state_revision,
    'controlRequestedBy', s.control_requested_by,
    'location', jsonb_build_object('workstreamId', s.location_workstream_id, 'workstreamName', v_workstream_name),
    -- This tab is the caller's current tab (and still present).
    'thisTabJoined', coalesce(p_connection is not null and me.connection_id = p_connection and collaboration_is_present(me), false),
    -- The caller is present from some other tab.
    'otherTabActive', me.connection_id is distinct from p_connection and coalesce(collaboration_is_present(me), false),
    'iLeft', me.left_at is not null
  );
end;
$$;

create or replace function collaboration_invitation_dto(i collaboration_invitations)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', i.id,
    'projectId', i.project_id,
    'projectName', (select name from projects where id = i.project_id),
    'conversationId', i.conversation_id,
    'inviterId', i.inviter_id,
    'inviterName', collaboration_display_name(i.inviter_id),
    'inviteeId', i.invitee_id,
    'inviteeName', collaboration_display_name(i.invitee_id),
    'status', case when i.status = 'pending' and i.expires_at <= now() then 'expired' else i.status end,
    'expiresAt', i.expires_at,
    'sessionId', i.session_id
  );
$$;

revoke all on function collaboration_presence_window() from public, anon, authenticated;
revoke all on function collaboration_invitation_lifetime() from public, anon, authenticated;
revoke all on function collaboration_idle_limit() from public, anon, authenticated;
revoke all on function collaboration_max_duration() from public, anon, authenticated;
revoke all on function collaboration_has_access(uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_display_name(uuid) from public, anon, authenticated;
revoke all on function collaboration_actor() from public, anon, authenticated;
revoke all on function collaboration_writer() from public, anon, authenticated;
revoke all on function collaboration_is_present(collaboration_participants) from public, anon, authenticated;
revoke all on function collaboration_end_session(uuid, text, uuid) from public, anon, authenticated;
revoke all on function collaboration_settle(uuid) from public, anon, authenticated;
revoke all on function collaboration_settle_user(uuid) from public, anon, authenticated;
revoke all on function collaboration_in_live_session(uuid) from public, anon, authenticated;
revoke all on function collaboration_lock(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_log(collaboration_sessions, uuid, text) from public, anon, authenticated;
revoke all on function collaboration_snapshot(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_invitation_dto(collaboration_invitations) from public, anon, authenticated;

-- Reads ---------------------------------------------------------------------------

-- Who the caller can invite in this Project: other active members.
create or replace function collaboration_candidates(p_project uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_actor();
begin
  if not collaboration_has_access(p_project, v_actor) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', m.user_id, 'name', collaboration_display_name(m.user_id), 'role', m.role)
      order by lower(collaboration_display_name(m.user_id)))
    from project_members m join profiles p on p.id = m.user_id
    where m.project_id = p_project and m.status = 'active' and p.is_active and m.user_id <> v_actor
  ), '[]'::jsonb);
end;
$$;

-- The caller's shared conversations, newest activity first. A conversation
-- disappears from both histories while either person lacks access to its
-- Project (fail closed); it returns if access does.
create or replace function collaboration_history()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_actor();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id,
      'projectId', c.project_id,
      'projectName', pr.name,
      'otherUserId', case when c.user_a = v_actor then c.user_b else c.user_a end,
      'otherName', collaboration_display_name(case when c.user_a = v_actor then c.user_b else c.user_a end),
      'createdAt', c.created_at,
      'lastActivityAt', c.last_activity_at,
      'liveSessionId', (select s.id from collaboration_sessions s where s.conversation_id = c.id and s.status = 'active')
    ) order by c.last_activity_at desc)
    from collaboration_conversations c join projects pr on pr.id = c.project_id
    where v_actor in (c.user_a, c.user_b)
      and collaboration_has_access(c.project_id, c.user_a)
      and collaboration_has_access(c.project_id, c.user_b)
  ), '[]'::jsonb);
end;
$$;

-- One shared conversation's shell: the pair, the Project and its sessions.
create or replace function collaboration_conversation(p_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_actor();
  c collaboration_conversations;
  v_other uuid;
begin
  select * into c from collaboration_conversations where id = p_conversation;
  if not found or v_actor not in (c.user_a, c.user_b)
     or not collaboration_has_access(c.project_id, c.user_a) or not collaboration_has_access(c.project_id, c.user_b) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  v_other := case when c.user_a = v_actor then c.user_b else c.user_a end;
  return jsonb_build_object(
    'id', c.id,
    'projectId', c.project_id,
    'projectName', (select name from projects where id = c.project_id),
    'otherUserId', v_other,
    'otherName', collaboration_display_name(v_other),
    'createdAt', c.created_at,
    'lastActivityAt', c.last_activity_at,
    'pendingInvitation', (
      select collaboration_invitation_dto(i) from collaboration_invitations i
      where i.conversation_id = c.id and i.status = 'pending' and i.expires_at > now()
      order by i.created_at desc limit 1
    ),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'hostName', collaboration_display_name(s.host_id), 'status', s.status,
        'endReason', s.end_reason, 'startedAt', s.started_at, 'endedAt', s.ended_at
      ) order by s.started_at desc)
      from collaboration_sessions s where s.conversation_id = c.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Polled by the browser (directly against Supabase, not through the app
-- server): the caller's live session, if any, and pending invitations.
-- With the caller's current tab id, also records that tab's presence --
-- the only write, and only to the caller's own participant row.
create or replace function collaboration_status(p_connection uuid default null, p_session uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  v_session uuid;
begin
  -- The caller's live session; or, if the tab asks about one that just
  -- ended, that one, so it can say why.
  select s.id into v_session from collaboration_sessions s
    join collaboration_participants p on p.session_id = s.id and p.user_id = v_actor
    where s.status = 'active' order by (p.left_at is null) desc, s.started_at desc limit 1
    for update of s;
  if v_session is not null and collaboration_settle(v_session) and p_session is null then
    p_session := v_session;
  end if;
  if v_session is not null and exists (select 1 from collaboration_sessions where id = v_session and status = 'active') then
    if not collaboration_has_access((select project_id from collaboration_sessions where id = v_session), v_actor) then
      v_session := null;
    elsif p_connection is not null then
      update collaboration_participants set last_seen_at = now()
        where session_id = v_session and user_id = v_actor and connection_id = p_connection and left_at is null;
    end if;
  else
    v_session := null;
  end if;
  if v_session is null and p_session is not null then
    -- Only report on an ended session the caller was in and still has access to.
    select s.id into v_session from collaboration_sessions s
      where s.id = p_session and v_actor in (s.host_id, s.guest_id) and collaboration_has_access(s.project_id, v_actor);
  end if;
  return jsonb_build_object(
    'session', case when v_session is null then null else collaboration_snapshot(v_session, v_actor, p_connection) end,
    'incoming', coalesce((
      select jsonb_agg(collaboration_invitation_dto(i) order by i.created_at desc)
      from collaboration_invitations i
      where i.invitee_id = v_actor and i.status = 'pending' and i.expires_at > now()
        and collaboration_has_access(i.project_id, i.inviter_id) and collaboration_has_access(i.project_id, v_actor)
    ), '[]'::jsonb),
    'outgoing', coalesce((
      select jsonb_agg(collaboration_invitation_dto(i) order by i.created_at desc)
      from collaboration_invitations i
      where i.inviter_id = v_actor and i.status = 'pending' and i.expires_at > now()
    ), '[]'::jsonb)
  );
end;
$$;

-- Invitations ---------------------------------------------------------------------

create or replace function collaboration_invite(
  p_project uuid,
  p_invitee uuid,
  p_conversation uuid default null,
  p_created_via text default 'ui',
  p_assistant_conversation uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  c collaboration_conversations;
  i collaboration_invitations;
begin
  if p_invitee is null or p_invitee = v_actor then
    raise exception 'Choose another Project member to invite' using errcode = 'EC001';
  end if;
  if not collaboration_has_access(p_project, v_actor) or not collaboration_has_access(p_project, p_invitee) then
    raise exception 'Both people must be active members of this Project' using errcode = 'EC001';
  end if;
  if p_created_via not in ('ui', 'assistant') then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if p_assistant_conversation is not null
     and not exists (select 1 from conversations where id = p_assistant_conversation and user_id = v_actor) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if p_conversation is not null then
    select * into c from collaboration_conversations where id = p_conversation;
    if not found or c.project_id <> p_project or least(v_actor, p_invitee) <> c.user_a or greatest(v_actor, p_invitee) <> c.user_b then
      raise exception 'Collaboration access denied' using errcode = '42501';
    end if;
    if exists (select 1 from collaboration_sessions where conversation_id = c.id and status = 'active') then
      raise exception 'This conversation already has a live session' using errcode = 'EC001';
    end if;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_actor::text, 1955));
  perform collaboration_settle_user(v_actor);
  if collaboration_in_live_session(v_actor) then
    raise exception 'You are already in a live session -- leave or end it first' using errcode = 'EC001';
  end if;

  -- Re-sending the same invitation returns the pending one.
  select * into i from collaboration_invitations
    where inviter_id = v_actor and invitee_id = p_invitee and project_id = p_project
      and conversation_id is not distinct from p_conversation and status = 'pending' and expires_at > now()
    order by created_at desc limit 1;
  if found then
    return collaboration_invitation_dto(i);
  end if;
  -- Only one pending invitation from the caller at a time.
  update collaboration_invitations set status = 'cancelled', responded_at = now()
    where inviter_id = v_actor and status = 'pending';

  insert into collaboration_invitations(project_id, conversation_id, inviter_id, invitee_id, created_via, assistant_conversation_id, expires_at)
    values (p_project, p_conversation, v_actor, p_invitee, p_created_via, p_assistant_conversation, now() + collaboration_invitation_lifetime())
    returning * into i;
  insert into collaboration_events(invitation_id, conversation_id, actor_id, event)
    values (i.id, p_conversation, v_actor, 'invited');
  return collaboration_invitation_dto(i);
end;
$$;

create or replace function collaboration_cancel_invitation(p_invitation uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  i collaboration_invitations;
begin
  select * into i from collaboration_invitations where id = p_invitation for update;
  if not found or i.inviter_id <> v_actor then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if i.status = 'pending' then
    update collaboration_invitations set status = 'cancelled', responded_at = now() where id = i.id returning * into i;
    insert into collaboration_events(invitation_id, actor_id, event) values (i.id, v_actor, 'invitation_cancelled');
  end if;
  return collaboration_invitation_dto(i);
end;
$$;

-- Accepting starts the live session with the inviter as host and
-- controller. p_connection joins the accepting tab straight away.
create or replace function collaboration_respond_invitation(p_invitation uuid, p_accept boolean, p_connection uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  i collaboration_invitations;
  c collaboration_conversations;
  s collaboration_sessions;
begin
  select * into i from collaboration_invitations where id = p_invitation for update;
  if not found or i.invitee_id <> v_actor then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if i.status = 'accepted' and p_accept and i.session_id is not null then
    -- A repeated accept (double click, retry) returns the same session.
    return jsonb_build_object('invitation', collaboration_invitation_dto(i), 'sessionId', i.session_id);
  end if;
  if i.status <> 'pending' or i.expires_at <= now() then
    raise exception 'This invitation is no longer available' using errcode = 'EC001';
  end if;
  if not p_accept then
    update collaboration_invitations set status = 'declined', responded_at = now() where id = i.id returning * into i;
    insert into collaboration_events(invitation_id, actor_id, event) values (i.id, v_actor, 'invitation_declined');
    return jsonb_build_object('invitation', collaboration_invitation_dto(i), 'sessionId', null);
  end if;

  if not collaboration_has_access(i.project_id, i.inviter_id) or not collaboration_has_access(i.project_id, v_actor) then
    raise exception 'Both people must be active members of this Project' using errcode = 'EC001';
  end if;
  -- Lock both people in a fixed order so two crossing accepts serialize.
  perform pg_advisory_xact_lock(hashtextextended(least(i.inviter_id, v_actor)::text, 1955));
  perform pg_advisory_xact_lock(hashtextextended(greatest(i.inviter_id, v_actor)::text, 1955));
  perform collaboration_settle_user(i.inviter_id);
  perform collaboration_settle_user(v_actor);
  if collaboration_in_live_session(v_actor) then
    raise exception 'You are already in a live session -- leave it first' using errcode = 'EC001';
  end if;
  if collaboration_in_live_session(i.inviter_id) then
    raise exception '% is already in another live session', collaboration_display_name(i.inviter_id) using errcode = 'EC001';
  end if;

  if i.conversation_id is not null then
    select * into c from collaboration_conversations where id = i.conversation_id for update;
    if exists (select 1 from collaboration_sessions where conversation_id = c.id and status = 'active') then
      raise exception 'This conversation already has a live session' using errcode = 'EC001';
    end if;
    update collaboration_conversations set last_activity_at = now() where id = c.id;
  else
    insert into collaboration_conversations(project_id, user_a, user_b, created_by)
      values (i.project_id, least(i.inviter_id, v_actor), greatest(i.inviter_id, v_actor), i.inviter_id)
      returning * into c;
  end if;

  insert into collaboration_sessions(conversation_id, project_id, host_id, guest_id, controller_id)
    values (c.id, i.project_id, i.inviter_id, v_actor, i.inviter_id)
    returning * into s;
  insert into collaboration_participants(session_id, user_id, role) values (s.id, i.inviter_id, 'host');
  insert into collaboration_participants(session_id, user_id, role, connection_id, last_seen_at, joined_at)
    values (s.id, v_actor, 'guest', p_connection, case when p_connection is null then null else now() end,
            case when p_connection is null then null else now() end);
  update collaboration_invitations set status = 'accepted', responded_at = now(), conversation_id = c.id, session_id = s.id
    where id = i.id returning * into i;
  insert into collaboration_events(invitation_id, session_id, conversation_id, actor_id, event, control_generation)
    values (i.id, s.id, c.id, v_actor, 'invitation_accepted', s.control_generation);
  return jsonb_build_object('invitation', collaboration_invitation_dto(i), 'sessionId', s.id);
end;
$$;

-- Session commands ----------------------------------------------------------------

-- Makes this tab the caller's tab in the session. If another of the
-- caller's tabs is present, refuses unless p_take_over -- two tabs of one
-- account never act as two controllers. A new tab for the controller
-- bumps the control generation, so the old tab's commands fail.
create or replace function collaboration_join(p_session uuid, p_connection uuid, p_take_over boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  me collaboration_participants;
begin
  if p_connection is null then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  s := collaboration_lock(p_session, null, v_actor);
  select * into me from collaboration_participants where session_id = s.id and user_id = v_actor for update;
  if me.connection_id is distinct from p_connection and coalesce(collaboration_is_present(me), false) and not p_take_over then
    raise exception 'This live session is open in another of your tabs' using errcode = 'EC002';
  end if;
  if me.left_at is not null and exists (
    select 1 from collaboration_sessions o join collaboration_participants op on op.session_id = o.id
    where op.user_id = v_actor and o.status = 'active' and op.left_at is null and o.id <> s.id
  ) then
    raise exception 'You are in another live session -- leave it first' using errcode = 'EC001';
  end if;
  if me.connection_id is distinct from p_connection or me.left_at is not null then
    if s.controller_id = v_actor and me.connection_id is distinct from p_connection then
      update collaboration_sessions set control_generation = control_generation + 1 where id = s.id;
    end if;
    update collaboration_sessions set state_revision = state_revision + 1 where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, case when me.joined_at is null then 'joined' else 'rejoined' end);
  end if;
  update collaboration_participants
    set connection_id = p_connection, last_seen_at = now(), joined_at = coalesce(joined_at, now()), left_at = null
    where session_id = s.id and user_id = v_actor;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- The controller moves both browsers: null = the Project page, or one of
-- its workstreams. p_generation is the control generation the tab last saw.
create or replace function collaboration_navigate(p_session uuid, p_connection uuid, p_generation integer, p_workstream uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock(p_session, p_connection, v_actor);
  if s.controller_id <> v_actor then
    raise exception 'Ask for control before moving the shared view' using errcode = 'EC001';
  end if;
  if p_generation is distinct from s.control_generation then
    raise exception 'Control changed -- the shared view was not moved' using errcode = 'EC003';
  end if;
  if p_workstream is not null and not exists (select 1 from project_workstreams where id = p_workstream and project_id = s.project_id) then
    raise exception 'That workstream is not in this Project' using errcode = 'EC001';
  end if;
  if s.location_workstream_id is distinct from p_workstream then
    update collaboration_sessions set location_workstream_id = p_workstream, state_revision = state_revision + 1 where id = s.id;
  end if;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

create or replace function collaboration_request_control(p_session uuid, p_connection uuid, p_withdraw boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock(p_session, p_connection, v_actor);
  if p_withdraw then
    if s.control_requested_by = v_actor then
      update collaboration_sessions set control_requested_by = null, control_requested_at = null, state_revision = state_revision + 1
        where id = s.id returning * into s;
      perform collaboration_log(s, v_actor, 'control_request_withdrawn');
    end if;
  else
    if s.controller_id = v_actor then
      raise exception 'You already have control' using errcode = 'EC001';
    end if;
    if s.control_requested_by is distinct from v_actor then
      update collaboration_sessions set control_requested_by = v_actor, control_requested_at = now(), state_revision = state_revision + 1
        where id = s.id returning * into s;
      perform collaboration_log(s, v_actor, 'control_requested');
    end if;
  end if;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- The controller grants or declines the pending request. Granting needs
-- the requester present, so control never lands on an absent person.
create or replace function collaboration_answer_control_request(p_session uuid, p_connection uuid, p_generation integer, p_grant boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  r collaboration_participants;
begin
  s := collaboration_lock(p_session, p_connection, v_actor);
  if s.controller_id <> v_actor then
    raise exception 'Only the person in control can answer a request' using errcode = 'EC001';
  end if;
  if p_generation is distinct from s.control_generation then
    raise exception 'Control changed -- refresh and try again' using errcode = 'EC003';
  end if;
  if s.control_requested_by is null then
    raise exception 'There is no request for control to answer' using errcode = 'EC003';
  end if;
  if p_grant then
    select * into r from collaboration_participants where session_id = s.id and user_id = s.control_requested_by;
    if not coalesce(collaboration_is_present(r), false) then
      raise exception '% is not connected right now', collaboration_display_name(r.user_id) using errcode = 'EC001';
    end if;
    update collaboration_sessions
      set controller_id = control_requested_by, control_requested_by = null, control_requested_at = null,
          control_generation = control_generation + 1, state_revision = state_revision + 1
      where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, 'control_granted');
  else
    update collaboration_sessions set control_requested_by = null, control_requested_at = null, state_revision = state_revision + 1
      where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, 'control_request_declined');
  end if;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- The host takes control back at any time; visible and recorded.
create or replace function collaboration_reclaim_control(p_session uuid, p_connection uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock(p_session, p_connection, v_actor);
  if s.host_id <> v_actor then
    raise exception 'Only the host can take control back' using errcode = 'EC001';
  end if;
  if s.controller_id <> v_actor then
    update collaboration_sessions
      set controller_id = v_actor, control_requested_by = null, control_requested_at = null,
          control_generation = control_generation + 1, state_revision = state_revision + 1
      where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, 'control_reclaimed');
  end if;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- Leaving is explicit (closing a tab is a disconnect, not a leave). If the
-- leaver had control and the other person is still in the session, control
-- passes to them -- recorded, never silent. When nobody is left, the
-- session ends. Works from any of the caller's tabs.
create or replace function collaboration_leave(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  v_other uuid;
  other collaboration_participants;
begin
  s := collaboration_lock(p_session, null, v_actor);
  v_other := case when v_actor = s.host_id then s.guest_id else s.host_id end;
  select * into other from collaboration_participants where session_id = s.id and user_id = v_other;
  update collaboration_participants set left_at = now(), connection_id = null where session_id = s.id and user_id = v_actor;
  update collaboration_sessions
    set control_requested_by = case when control_requested_by = v_actor then null else control_requested_by end,
        control_requested_at = case when control_requested_by = v_actor then null else control_requested_at end,
        state_revision = state_revision + 1
    where id = s.id returning * into s;
  perform collaboration_log(s, v_actor, 'left');
  if other.left_at is not null then
    perform collaboration_end_session(s.id, 'everyone_left', v_actor);
  elsif s.controller_id = v_actor then
    update collaboration_sessions
      set controller_id = v_other, control_requested_by = null, control_requested_at = null,
          control_generation = control_generation + 1, state_revision = state_revision + 1
      where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, 'control_passed_on_leave');
  end if;
  return collaboration_snapshot(s.id, v_actor, null);
end;
$$;

-- Only the host ends the session. The conversation stays in both histories.
create or replace function collaboration_end(p_session uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock(p_session, null, v_actor);
  if s.host_id <> v_actor then
    raise exception 'Only the host can end the session' using errcode = 'EC001';
  end if;
  perform collaboration_end_session(s.id, 'ended_by_host', v_actor);
  return collaboration_snapshot(s.id, v_actor, null);
end;
$$;

revoke all on function collaboration_candidates(uuid) from public, anon;
revoke all on function collaboration_history() from public, anon;
revoke all on function collaboration_conversation(uuid) from public, anon;
revoke all on function collaboration_status(uuid, uuid) from public, anon;
revoke all on function collaboration_invite(uuid, uuid, uuid, text, uuid) from public, anon;
revoke all on function collaboration_cancel_invitation(uuid) from public, anon;
revoke all on function collaboration_respond_invitation(uuid, boolean, uuid) from public, anon;
revoke all on function collaboration_join(uuid, uuid, boolean) from public, anon;
revoke all on function collaboration_navigate(uuid, uuid, integer, uuid) from public, anon;
revoke all on function collaboration_request_control(uuid, uuid, boolean) from public, anon;
revoke all on function collaboration_answer_control_request(uuid, uuid, integer, boolean) from public, anon;
revoke all on function collaboration_reclaim_control(uuid, uuid) from public, anon;
revoke all on function collaboration_leave(uuid) from public, anon;
revoke all on function collaboration_end(uuid) from public, anon;
grant execute on function collaboration_candidates(uuid) to authenticated;
grant execute on function collaboration_history() to authenticated;
grant execute on function collaboration_conversation(uuid) to authenticated;
grant execute on function collaboration_status(uuid, uuid) to authenticated;
grant execute on function collaboration_invite(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function collaboration_cancel_invitation(uuid) to authenticated;
grant execute on function collaboration_respond_invitation(uuid, boolean, uuid) to authenticated;
grant execute on function collaboration_join(uuid, uuid, boolean) to authenticated;
grant execute on function collaboration_navigate(uuid, uuid, integer, uuid) to authenticated;
grant execute on function collaboration_request_control(uuid, uuid, boolean) to authenticated;
grant execute on function collaboration_answer_control_request(uuid, uuid, integer, boolean) to authenticated;
grant execute on function collaboration_reclaim_control(uuid, uuid) to authenticated;
grant execute on function collaboration_leave(uuid) to authenticated;
grant execute on function collaboration_end(uuid) to authenticated;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
