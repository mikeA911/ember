-- Shared workspace sessions, Phase 4: rollout controls
-- (docs/dev-request-shared-workspace-sessions.md).
--
-- The build flag (NEXT_PUBLIC_EMBER_COLLABORATION) stays the master
-- switch. Within it, platform admins choose where live collaboration is
-- on: every Project (mode 'all', the default -- unchanged behaviour), or
-- only the Projects they turn on (mode 'selected'). Where it's off, new
-- invitations -- from Collaborate, from Ember, or to resume a conversation
-- -- and accepting one are refused, and the Project page doesn't offer
-- Collaborate. Live sessions already running carry on (an admin can end
-- them); shared conversations, their chats and viewers stay readable.
--
-- Every change is recorded in collaboration_rollout_log. Nothing is
-- deleted: turning a Project off sets enabled = false. Replaces
-- collaboration_invite and collaboration_respond_invitation with versions
-- that also check the rollout (otherwise as in 20261023100001). Safe to
-- re-run. Requires 20261028100001.

create table if not exists collaboration_rollout (
  id boolean primary key default true check (id),
  mode text not null default 'all' check (mode in ('all', 'selected')),
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into collaboration_rollout(id) values (true) on conflict (id) do nothing;

create table if not exists collaboration_project_rollout (
  project_id uuid primary key references projects(id) on delete cascade,
  enabled boolean not null,
  updated_by uuid references profiles(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists collaboration_rollout_log (
  id bigint generated always as identity primary key,
  actor_id uuid references profiles(id) on delete set null,
  change text not null,
  project_id uuid references projects(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table collaboration_rollout enable row level security;
alter table collaboration_project_rollout enable row level security;
alter table collaboration_rollout_log enable row level security;
revoke all on collaboration_rollout, collaboration_project_rollout, collaboration_rollout_log from anon, authenticated;

-- Whether live collaboration is on for a Project. Callable by signed-in
-- users (the Project page asks); says nothing else.
create or replace function collaboration_project_enabled(p_project uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select mode = 'all' from collaboration_rollout where id), true)
    or exists (select 1 from collaboration_project_rollout where project_id = p_project and enabled);
$$;

revoke all on function collaboration_project_enabled(uuid) from public, anon;
grant execute on function collaboration_project_enabled(uuid) to authenticated;

-- Admin: the rollout as it stands, with recent changes.
create or replace function collaboration_admin_rollout()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  r collaboration_rollout;
begin
  perform v_admin;
  select * into r from collaboration_rollout where id;
  return jsonb_build_object(
    'mode', coalesce(r.mode, 'all'),
    'updatedAt', r.updated_at,
    'updatedByName', case when r.updated_by is not null then collaboration_display_name(r.updated_by) end,
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object('projectId', x.project_id, 'projectName', p.name, 'enabled', x.enabled,
        'updatedAt', x.updated_at, 'updatedByName', case when x.updated_by is not null then collaboration_display_name(x.updated_by) end)
        order by x.enabled desc, p.name)
      from collaboration_project_rollout x join projects p on p.id = x.project_id
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object('change', l.change, 'projectName', (select name from projects where id = l.project_id),
        'byName', case when l.actor_id is not null then collaboration_display_name(l.actor_id) end, 'at', l.created_at) order by l.id desc)
      from (select * from collaboration_rollout_log order by id desc limit 20) l
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function collaboration_admin_set_rollout_mode(p_mode text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  v_old text;
begin
  if p_mode not in ('all', 'selected') then
    raise exception 'Choose all Projects or selected Projects' using errcode = 'EC001';
  end if;
  select mode into v_old from collaboration_rollout where id for update;
  if coalesce(v_old, 'all') is distinct from p_mode then
    -- An upsert: the setting row normally exists (created above), but
    -- never depend on it.
    insert into collaboration_rollout(id, mode, updated_by, updated_at) values (true, p_mode, v_admin, now())
      on conflict (id) do update set mode = excluded.mode, updated_by = excluded.updated_by, updated_at = now();
    insert into collaboration_rollout_log(actor_id, change) values (v_admin, 'mode:' || p_mode);
  end if;
  return collaboration_admin_rollout();
end;
$$;

create or replace function collaboration_admin_set_project_enabled(p_project uuid, p_enabled boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := collaboration_admin();
  v_old boolean;
begin
  if not exists (select 1 from projects where id = p_project) then
    raise exception 'Unknown Project' using errcode = 'EC001';
  end if;
  select enabled into v_old from collaboration_project_rollout where project_id = p_project for update;
  if v_old is distinct from p_enabled then
    insert into collaboration_project_rollout(project_id, enabled, updated_by, updated_at)
      values (p_project, p_enabled, v_admin, now())
      on conflict (project_id) do update set enabled = excluded.enabled, updated_by = excluded.updated_by, updated_at = now();
    insert into collaboration_rollout_log(actor_id, change, project_id)
      values (v_admin, case when p_enabled then 'project_on' else 'project_off' end, p_project);
  end if;
  return collaboration_admin_rollout();
end;
$$;

revoke all on function collaboration_admin_rollout() from public, anon;
revoke all on function collaboration_admin_set_rollout_mode(text) from public, anon;
revoke all on function collaboration_admin_set_project_enabled(uuid, boolean) from public, anon;
grant execute on function collaboration_admin_rollout() to authenticated;
grant execute on function collaboration_admin_set_rollout_mode(text) to authenticated;
grant execute on function collaboration_admin_set_project_enabled(uuid, boolean) to authenticated;

-- Invitations, with the rollout check (otherwise as in 20261023100001) -----------------

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
  -- Phase 4 rollout: only where live collaboration is turned on.
  if not collaboration_project_enabled(p_project) then
    raise exception 'Live collaboration isn''t turned on for this Project' using errcode = 'EC001';
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
  -- Phase 4 rollout: turned off since the invitation was sent.
  if not collaboration_project_enabled(i.project_id) then
    raise exception 'Live collaboration isn''t turned on for this Project' using errcode = 'EC001';
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
  insert into collaboration_participants(session_id, user_id, role, connection_id, last_seen_at, last_active_at, joined_at)
    values (s.id, v_actor, 'guest', p_connection, case when p_connection is null then null else now() end, now(),
            case when p_connection is null then null else now() end);
  -- Joining a session as one of the pair ends any watching elsewhere.
  update collaboration_watchers set stopped_at = now(), connection_id = null where user_id = v_actor and stopped_at is null;
  update collaboration_invitations set status = 'accepted', responded_at = now(), conversation_id = c.id, session_id = s.id
    where id = i.id returning * into i;
  insert into collaboration_events(invitation_id, session_id, conversation_id, actor_id, event, control_generation)
    values (i.id, s.id, c.id, v_actor, 'invitation_accepted', s.control_generation);
  return jsonb_build_object('invitation', collaboration_invitation_dto(i), 'sessionId', s.id);
end;
$$;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
