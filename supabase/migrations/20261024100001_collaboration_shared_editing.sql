-- Shared workspace sessions, Phase 2: shared editing on the Project and
-- Workstream pages (docs/dev-request-shared-workspace-sessions.md).
--
-- In a live session, the person in control edits the Project's goal,
-- description (objective) and starter prompt, and a Workstream's summary,
-- as shared drafts the other browser (and any watcher) sees as they type;
-- Save is explicit. Deliverable checkboxes save at once, as set-to-value
-- operations so a retry can't flip one back.
--
-- Authority stays in the database: every draft write and save locks the
-- session row and checks the caller's tab, that they're in control, the
-- control generation, that the field is on the page being shared, and
-- that their own account may edit that field (the same rules as the
-- ordinary forms: goal -- the Project's owner or a platform admin; the
-- rest -- owner, curator or platform admin). Control never borrows anyone
-- else's rights.
--
-- Conflicts: a draft remembers the saved text it started from. Saving
-- succeeds only if the field still holds that text; if someone changed it
-- outside the session meanwhile, the save is refused (EC004) and the
-- person chooses what to do. Saves carry a request id, so a retry returns
-- the first result instead of saving twice. No existing table is altered.
--
-- Nothing here deletes a row: drafts end as saved, discarded or abandoned
-- (when their session ends). Safe to re-run. Requires 20261023100001.

create table if not exists collaboration_drafts (
  session_id uuid not null references collaboration_sessions(id) on delete cascade,
  field text not null check (field in ('project_goal', 'project_objective', 'project_starter_prompt', 'workstream_summary')),
  -- The Project for project_* fields, the workstream for workstream_*.
  target_id uuid not null,
  value text not null default '' check (length(value) <= 20000),
  -- The saved text when the draft was opened (null = the field was empty).
  base_value text,
  editor_id uuid references profiles(id) on delete set null,
  revision integer not null default 1,
  status text not null default 'open' check (status in ('open', 'saved', 'discarded', 'abandoned')),
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (session_id, field, target_id)
);

-- One row per save request (text fields and checkboxes): makes a retried
-- save return its first result, and records who saved what, when.
create table if not exists collaboration_saves (
  request_id uuid primary key,
  session_id uuid not null references collaboration_sessions(id) on delete cascade,
  actor_id uuid references profiles(id) on delete set null,
  field text not null,
  target_id uuid not null,
  item_index integer,
  created_at timestamptz not null default now()
);

create index if not exists collaboration_saves_session_idx on collaboration_saves(session_id, created_at);

alter table collaboration_drafts enable row level security;
alter table collaboration_saves enable row level security;
revoke all on collaboration_drafts, collaboration_saves from anon, authenticated;

-- Field helpers -------------------------------------------------------------------

-- Who may edit a shared field: the same bar as the ordinary forms.
create or replace function collaboration_can_edit_field(p_project uuid, p_field text, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when p_user is null then false
    when p_field = 'project_goal' then can_manage_project(p_project, p_user)
    when p_field in ('project_objective', 'project_starter_prompt', 'workstream_summary', 'workstream_deliverables') then can_curate_project(p_project, p_user)
    else false
  end;
$$;

-- The saved text of a field right now.
create or replace function collaboration_field_value(p_field text, p_target uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case p_field
    when 'project_goal' then (select goal from projects where id = p_target)
    when 'project_objective' then (select objective from projects where id = p_target)
    when 'project_starter_prompt' then (select starter_prompt from projects where id = p_target)
    when 'workstream_summary' then (select summary from project_workstreams where id = p_target)
  end;
$$;

-- The field's target must be what the session is showing: the Project's
-- own fields on the Project page, a workstream's on that workstream's page.
create or replace function collaboration_check_target(s collaboration_sessions, p_field text, p_target uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if p_field like 'project\_%' then
    if p_target is distinct from s.project_id or s.location_workstream_id is not null then
      raise exception 'That field isn''t on the page being shared' using errcode = 'EC003';
    end if;
  elsif p_field like 'workstream\_%' then
    if p_target is distinct from s.location_workstream_id then
      raise exception 'That field isn''t on the page being shared' using errcode = 'EC003';
    end if;
  else
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
end;
$$;

-- Locks the session for an edit: the caller's current tab, in control, on
-- the generation they last saw, editing a field on the shared page that
-- their own account may edit.
create or replace function collaboration_lock_for_edit(p_session uuid, p_connection uuid, p_generation integer, p_field text, p_target uuid, p_actor uuid)
returns collaboration_sessions
language plpgsql security definer set search_path = public as $$
declare
  s collaboration_sessions;
begin
  if p_connection is null then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  s := collaboration_lock(p_session, p_connection, p_actor);
  if s.controller_id <> p_actor then
    raise exception 'Ask for control before editing' using errcode = 'EC001';
  end if;
  if p_generation is distinct from s.control_generation then
    raise exception 'Control changed -- nothing was changed' using errcode = 'EC003';
  end if;
  perform collaboration_check_target(s, p_field, p_target);
  if not collaboration_can_edit_field(s.project_id, p_field, p_actor) then
    raise exception 'Your account can''t edit this field' using errcode = 'EC001';
  end if;
  return s;
end;
$$;

-- The shared fields on the page the session is showing: saved value,
-- open draft (if any), and whether p_actor may edit (null actor: a
-- watcher, never). Called from the snapshots.
create or replace function collaboration_fields_json(p_session uuid, p_actor uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s collaboration_sessions;
  v_fields text[];
  v_target uuid;
  v_out jsonb := '[]'::jsonb;
  v_field text;
  v_saved text;
  dr collaboration_drafts;
begin
  select * into s from collaboration_sessions where id = p_session;
  if s.location_workstream_id is null then
    v_fields := array['project_goal', 'project_objective', 'project_starter_prompt'];
    v_target := s.project_id;
  else
    v_fields := array['workstream_summary'];
    v_target := s.location_workstream_id;
  end if;
  foreach v_field in array v_fields loop
    v_saved := collaboration_field_value(v_field, v_target);
    select * into dr from collaboration_drafts where session_id = s.id and field = v_field and target_id = v_target and status = 'open';
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'field', v_field,
      'targetId', v_target,
      'saved', v_saved,
      'canEdit', collaboration_can_edit_field(s.project_id, v_field, p_actor),
      'draft', case when dr.session_id is null then null else jsonb_build_object(
        'value', dr.value,
        'revision', dr.revision,
        'editorId', dr.editor_id,
        'editorName', collaboration_display_name(dr.editor_id),
        'updatedAt', dr.updated_at,
        -- The field was changed outside the session since this draft opened.
        'baseChanged', v_saved is distinct from dr.base_value
      ) end
    ));
  end loop;
  if s.location_workstream_id is not null then
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'field', 'workstream_deliverables',
      'targetId', v_target,
      'deliverables', (select deliverables from project_workstreams where id = v_target),
      'canEdit', collaboration_can_edit_field(s.project_id, 'workstream_deliverables', p_actor)
    ));
  end if;
  return v_out;
end;
$$;

-- Every unsaved draft in the session, wherever it is.
create or replace function collaboration_open_drafts_json(p_session uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'field', d.field, 'targetId', d.target_id,
    'workstreamName', case when d.field like 'workstream\_%' then (select name from project_workstreams where id = d.target_id) end,
    'editorName', collaboration_display_name(d.editor_id)
  ) order by d.opened_at), '[]'::jsonb)
  from collaboration_drafts d where d.session_id = p_session and d.status = 'open';
$$;

revoke all on function collaboration_can_edit_field(uuid, text, uuid) from public, anon, authenticated;
revoke all on function collaboration_field_value(text, uuid) from public, anon, authenticated;
revoke all on function collaboration_check_target(collaboration_sessions, text, uuid) from public, anon, authenticated;
revoke all on function collaboration_lock_for_edit(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_fields_json(uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_open_drafts_json(uuid) from public, anon, authenticated;

-- Snapshots and ending, extended (otherwise as in 20261023100001) ---------------------

create or replace function collaboration_snapshot(p_session uuid, p_actor uuid, p_connection uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s collaboration_sessions;
  h collaboration_participants;
  g collaboration_participants;
  me collaboration_participants;
  ctl collaboration_participants;
  v_workstream_name text;
  d record;
begin
  select * into s from collaboration_sessions where id = p_session;
  select * into h from collaboration_participants where session_id = s.id and user_id = s.host_id;
  select * into g from collaboration_participants where session_id = s.id and user_id = s.guest_id;
  me := case when p_actor = s.host_id then h else g end;
  ctl := case when s.controller_id = s.host_id then h else g end;
  select * into d from collaboration_deadline(s.id);
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
      'present', coalesce(collaboration_is_present(h), false), 'left', h.left_at is not null,
      'away', collaboration_is_away(h, s.started_at),
      'inactiveSeconds', floor(extract(epoch from now() - collaboration_last_active(h, s.started_at)))::int),
    'guest', jsonb_build_object('id', s.guest_id, 'name', collaboration_display_name(s.guest_id),
      'present', coalesce(collaboration_is_present(g), false), 'left', g.left_at is not null,
      'away', collaboration_is_away(g, s.started_at),
      'inactiveSeconds', floor(extract(epoch from now() - collaboration_last_active(g, s.started_at)))::int),
    'controllerId', s.controller_id,
    'controlGeneration', s.control_generation,
    'stateRevision', s.state_revision,
    'controlRequestedBy', s.control_requested_by,
    'location', jsonb_build_object('workstreamId', s.location_workstream_id, 'workstreamName', v_workstream_name),
    -- This tab is the caller's current tab (and still present).
    'thisTabJoined', coalesce(p_connection is not null and me.connection_id = p_connection and collaboration_is_present(me), false),
    -- The caller is present from some other tab.
    'otherTabActive', me.connection_id is distinct from p_connection and coalesce(collaboration_is_present(me), false),
    'iLeft', me.left_at is not null,
    'viewers', collaboration_viewers_json(s.conversation_id),
    'watching', collaboration_watching_json(s.id),
    -- Phase 2: the shared fields where the session is, and every unsaved
    -- draft in the session (for the bar and the end/leave warnings).
    'fields', collaboration_fields_json(s.id, p_actor),
    'openDrafts', collaboration_open_drafts_json(s.id),
    -- Seconds until the session ends on its own, and which rule ends it.
    'endsInSeconds', case when s.status = 'active' then greatest(0, floor(extract(epoch from d.ends_at - now())))::int end,
    'endingReason', case when s.status = 'active' then d.reason end,
    -- Someone not in control may take it while the controller is away or
    -- not connected (the host can always take it back).
    'canTakeControl', s.status = 'active' and s.controller_id <> p_actor
      and (collaboration_is_away(ctl, s.started_at) or not coalesce(collaboration_is_present(ctl), false))
  );
end;
$$;

create or replace function collaboration_watch_snapshot(p_session uuid, p_actor uuid, p_connection uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s collaboration_sessions;
  h collaboration_participants;
  g collaboration_participants;
  w collaboration_watchers;
  d record;
  v_workstream_name text;
begin
  select * into s from collaboration_sessions where id = p_session;
  select * into h from collaboration_participants where session_id = s.id and user_id = s.host_id;
  select * into g from collaboration_participants where session_id = s.id and user_id = s.guest_id;
  select * into w from collaboration_watchers where session_id = s.id and user_id = p_actor;
  select * into d from collaboration_deadline(s.id);
  if s.location_workstream_id is not null then
    select name into v_workstream_name from project_workstreams where id = s.location_workstream_id;
  end if;
  return jsonb_build_object(
    'id', s.id,
    'conversationId', s.conversation_id,
    'projectId', s.project_id,
    'projectName', (select name from projects where id = s.project_id),
    'status', case when s.status = 'active' and d.ends_at <= now() then 'ended' else s.status end,
    'endReason', case when s.status = 'active' and d.ends_at <= now() then d.reason else s.end_reason end,
    'host', jsonb_build_object('id', s.host_id, 'name', collaboration_display_name(s.host_id),
      'present', coalesce(collaboration_is_present(h), false), 'away', collaboration_is_away(h, s.started_at), 'left', h.left_at is not null),
    'guest', jsonb_build_object('id', s.guest_id, 'name', collaboration_display_name(s.guest_id),
      'present', coalesce(collaboration_is_present(g), false), 'away', collaboration_is_away(g, s.started_at), 'left', g.left_at is not null),
    'controllerId', s.controller_id,
    'stateRevision', s.state_revision,
    'location', jsonb_build_object('workstreamId', s.location_workstream_id, 'workstreamName', v_workstream_name),
    -- Watchers see the shared fields and drafts too, with no edit rights.
    'fields', collaboration_fields_json(s.id, null),
    -- This tab is the caller's watching tab.
    'thisTabWatching', coalesce(p_connection is not null and w.connection_id = p_connection and w.stopped_at is null, false)
  );
end;
$$;

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
    -- Unsaved drafts end with the session: kept, marked abandoned, never saved.
    update collaboration_drafts set status = 'abandoned', updated_at = now() where session_id = p_session and status = 'open';
    update collaboration_conversations set last_activity_at = now()
      where id = (select conversation_id from collaboration_sessions where id = p_session);
    insert into collaboration_events(session_id, actor_id, event, control_generation)
      select id, p_actor, 'ended:' || p_reason, control_generation from collaboration_sessions where id = p_session;
  end if;
end;
$$;

-- Shared editing --------------------------------------------------------------------

-- The controller's latest text for a field (sent as they type). Opening a
-- draft records the field's saved text as its base; p_rebase moves the
-- base to the current saved text (the person chose to keep their draft
-- after a change outside the session).
create or replace function collaboration_set_draft(
  p_session uuid, p_connection uuid, p_generation integer, p_field text, p_target uuid, p_value text, p_rebase boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock_for_edit(p_session, p_connection, p_generation, p_field, p_target, v_actor);
  if p_value is null or length(p_value) > 20000 then
    raise exception 'That text is too long (20,000 characters at most)' using errcode = 'EC001';
  end if;
  insert into collaboration_drafts as d (session_id, field, target_id, value, base_value, editor_id)
    values (s.id, p_field, p_target, p_value, collaboration_field_value(p_field, p_target), v_actor)
    on conflict (session_id, field, target_id) do update
      set value = excluded.value,
          -- A draft reopened after it was saved or discarded starts again
          -- from the current saved text.
          base_value = case when d.status <> 'open' or p_rebase then excluded.base_value else d.base_value end,
          opened_at = case when d.status <> 'open' then now() else d.opened_at end,
          editor_id = excluded.editor_id,
          revision = d.revision + 1,
          status = 'open',
          updated_at = now();
  update collaboration_sessions set state_revision = state_revision + 1 where id = s.id;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- The controller drops a draft (Cancel). The saved text is unchanged.
create or replace function collaboration_discard_draft(p_session uuid, p_connection uuid, p_generation integer, p_field text, p_target uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
begin
  s := collaboration_lock_for_edit(p_session, p_connection, p_generation, p_field, p_target, v_actor);
  update collaboration_drafts set status = 'discarded', editor_id = v_actor, updated_at = now()
    where session_id = s.id and field = p_field and target_id = p_target and status = 'open';
  if found then
    update collaboration_sessions set state_revision = state_revision + 1 where id = s.id;
  end if;
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- Saves the open draft to the Project or workstream -- in the same
-- transaction as the control checks, so a handover can't slip between
-- them. Refused (EC004) if the field changed since the draft opened.
-- Text is trimmed and an empty field saved as empty, as the forms do.
create or replace function collaboration_save_field(
  p_session uuid, p_connection uuid, p_generation integer, p_field text, p_target uuid, p_request uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  dr collaboration_drafts;
  v_new text;
begin
  if p_request is null then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  -- A retried save returns the session as it is; it never saves twice.
  if exists (select 1 from collaboration_saves where request_id = p_request and session_id = p_session and actor_id = v_actor) then
    return collaboration_snapshot(p_session, v_actor, p_connection);
  end if;
  s := collaboration_lock_for_edit(p_session, p_connection, p_generation, p_field, p_target, v_actor);
  -- Checked again under the lock: the same request sent twice at once.
  if exists (select 1 from collaboration_saves where request_id = p_request) then
    return collaboration_snapshot(s.id, v_actor, p_connection);
  end if;
  select * into dr from collaboration_drafts where session_id = s.id and field = p_field and target_id = p_target and status = 'open' for update;
  if not found then
    raise exception 'There''s no unsaved draft for that field' using errcode = 'EC003';
  end if;
  if collaboration_field_value(p_field, p_target) is distinct from dr.base_value then
    raise exception 'This was changed outside the session since editing began -- review the saved text before saving' using errcode = 'EC004';
  end if;
  v_new := nullif(trim(dr.value), '');
  if p_field = 'project_goal' then
    update projects set goal = v_new where id = p_target;
  elsif p_field = 'project_objective' then
    update projects set objective = v_new where id = p_target;
  elsif p_field = 'project_starter_prompt' then
    update projects set starter_prompt = v_new where id = p_target;
  elsif p_field = 'workstream_summary' then
    update project_workstreams set summary = v_new where id = p_target;
  end if;
  update collaboration_drafts set status = 'saved', editor_id = v_actor, updated_at = now()
    where session_id = s.id and field = p_field and target_id = p_target;
  insert into collaboration_saves(request_id, session_id, actor_id, field, target_id) values (p_request, s.id, v_actor, p_field, p_target);
  update collaboration_sessions set state_revision = state_revision + 1 where id = s.id returning * into s;
  perform collaboration_log(s, v_actor, 'saved:' || p_field);
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

-- Sets one deliverable's checkbox to a value (not a toggle, so a retry
-- can't flip it back). p_label is the item's text as the caller saw it;
-- if the list changed underneath (reordered or renamed), it's refused.
create or replace function collaboration_set_deliverable(
  p_session uuid, p_connection uuid, p_generation integer, p_workstream uuid,
  p_index integer, p_label text, p_completed boolean, p_request uuid
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  v_items jsonb;
begin
  if p_request is null or p_index is null or p_completed is null then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if exists (select 1 from collaboration_saves where request_id = p_request and session_id = p_session and actor_id = v_actor) then
    return collaboration_snapshot(p_session, v_actor, p_connection);
  end if;
  s := collaboration_lock_for_edit(p_session, p_connection, p_generation, 'workstream_deliverables', p_workstream, v_actor);
  if exists (select 1 from collaboration_saves where request_id = p_request) then
    return collaboration_snapshot(s.id, v_actor, p_connection);
  end if;
  select deliverables into v_items from project_workstreams where id = p_workstream for update;
  if p_index < 0 or p_index >= jsonb_array_length(v_items) or (v_items -> p_index ->> 'label') is distinct from p_label then
    raise exception 'The deliverables changed -- refresh and try again' using errcode = 'EC004';
  end if;
  if (v_items -> p_index ->> 'completed')::boolean is distinct from p_completed then
    update project_workstreams
      set deliverables = jsonb_set(v_items, array[p_index::text, 'completed'], to_jsonb(p_completed))
      where id = p_workstream;
    update collaboration_sessions set state_revision = state_revision + 1 where id = s.id returning * into s;
    perform collaboration_log(s, v_actor, 'saved:workstream_deliverables');
  end if;
  insert into collaboration_saves(request_id, session_id, actor_id, field, target_id, item_index)
    values (p_request, s.id, v_actor, 'workstream_deliverables', p_workstream, p_index);
  return collaboration_snapshot(s.id, v_actor, p_connection);
end;
$$;

revoke all on function collaboration_set_draft(uuid, uuid, integer, text, uuid, text, boolean) from public, anon;
revoke all on function collaboration_discard_draft(uuid, uuid, integer, text, uuid) from public, anon;
revoke all on function collaboration_save_field(uuid, uuid, integer, text, uuid, uuid) from public, anon;
revoke all on function collaboration_set_deliverable(uuid, uuid, integer, uuid, integer, text, boolean, uuid) from public, anon;
grant execute on function collaboration_set_draft(uuid, uuid, integer, text, uuid, text, boolean) to authenticated;
grant execute on function collaboration_discard_draft(uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function collaboration_save_field(uuid, uuid, integer, text, uuid, uuid) to authenticated;
grant execute on function collaboration_set_deliverable(uuid, uuid, integer, uuid, integer, text, boolean, uuid) to authenticated;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
