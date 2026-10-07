-- Paste-in part 2 of 3 of supabase/migrations/20261025100001_collaboration_shared_chat.sql
-- (the SQL Editor runs only about the first 20,000 characters). Run the parts
-- in order; each is safe to re-run. Generated from the migration -- edit that, not this.

-- Snapshots, extended with the chat's state (otherwise as in 20261024100001) ----------

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
    -- Phase 3: the shared chat's state (no content).
    'chat', collaboration_chat_state_json(s.conversation_id),
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
    -- Phase 3: the shared chat's state (no content).
    'chat', collaboration_chat_state_json(s.conversation_id),
    -- This tab is the caller's watching tab.
    'thisTabWatching', coalesce(p_connection is not null and w.connection_id = p_connection and w.stopped_at is null, false)
  );
end;
$$;

-- Writing -----------------------------------------------------------------------------

create or replace function collaboration_next_seq(p_conversation uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select coalesce(max(seq), 0) + 1 from collaboration_messages where conversation_id = p_conversation;
$$;

-- Ember answers in a live session with both of the pair in it.
create or replace function collaboration_lock_for_chat(p_session uuid, p_connection uuid, p_actor uuid)
returns collaboration_sessions
language plpgsql security definer set search_path = public as $$
declare
  s collaboration_sessions;
begin
  s := collaboration_lock(p_session, p_connection, p_actor);
  if not collaboration_session_live(s) then
    raise exception 'Ember answers in the shared chat only while you are both in the live session' using errcode = 'EC001';
  end if;
  perform 1 from collaboration_conversations where id = s.conversation_id for update;
  return s;
end;
$$;

create or replace function collaboration_check_queue(p_conversation uuid)
returns void
language plpgsql stable security definer set search_path = public as $$
begin
  if (select count(*) from collaboration_turns where conversation_id = p_conversation and status in ('queued', 'running'))
     >= collaboration_chat_queue_limit() then
    raise exception 'Ember already has % questions waiting -- wait for an answer first', collaboration_chat_queue_limit() using errcode = 'EC001';
  end if;
end;
$$;

revoke all on function collaboration_next_seq(uuid) from public, anon, authenticated;
revoke all on function collaboration_lock_for_chat(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_check_queue(uuid) from public, anon, authenticated;

-- One of the pair asks Ember, from their session tab. A retry with the
-- same request id returns the first result.
create or replace function collaboration_ask_ember(p_session uuid, p_connection uuid, p_content text, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  v_content text := btrim(coalesce(p_content, ''));
  s collaboration_sessions;
  m collaboration_messages;
  t collaboration_turns;
begin
  if p_request is null then
    raise exception 'A request id is required' using errcode = 'EC001';
  end if;
  s := collaboration_lock_for_chat(p_session, p_connection, v_actor);
  select * into m from collaboration_messages where request_id = p_request;
  if found then
    if m.author_id is distinct from v_actor or m.conversation_id <> s.conversation_id then
      raise exception 'Collaboration access denied' using errcode = '42501';
    end if;
    select * into t from collaboration_turns where prompt_id = m.id;
    return jsonb_build_object('messageId', m.id, 'turnId', t.id);
  end if;
  if v_content = '' or char_length(v_content) > collaboration_chat_max_chars() then
    raise exception 'A message must be 1 to % characters', collaboration_chat_max_chars() using errcode = 'EC001';
  end if;
  perform collaboration_check_queue(s.conversation_id);
  insert into collaboration_messages(conversation_id, seq, kind, author_id, session_id, content, request_id)
    values (s.conversation_id, collaboration_next_seq(s.conversation_id), 'message', v_actor, s.id, v_content, p_request)
    returning * into m;
  insert into collaboration_turns(conversation_id, session_id, prompt_id, requested_by)
    values (s.conversation_id, s.id, m.id, v_actor) returning * into t;
  update collaboration_conversations set last_activity_at = now() where id = s.conversation_id;
  return jsonb_build_object('messageId', m.id, 'turnId', t.id);
end;
$$;

-- A viewer comments. Ember doesn't answer it unless one of the pair
-- passes it on (collaboration_queue_turn). No live session needed.
create or replace function collaboration_post_comment(p_conversation uuid, p_content text, p_request uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  v_content text := btrim(coalesce(p_content, ''));
  c collaboration_conversations;
  m collaboration_messages;
begin
  if p_request is null then
    raise exception 'A request id is required' using errcode = 'EC001';
  end if;
  select * into c from collaboration_conversations where id = p_conversation for update;
  if not found or collaboration_conversation_role(c, v_actor) is distinct from 'viewer' then
    raise exception 'Only the conversation''s viewers post comments' using errcode = '42501';
  end if;
  select * into m from collaboration_messages where request_id = p_request;
  if found then
    if m.author_id is distinct from v_actor or m.conversation_id <> c.id then
      raise exception 'Collaboration access denied' using errcode = '42501';
    end if;
    return jsonb_build_object('messageId', m.id);
  end if;
  if v_content = '' or char_length(v_content) > collaboration_chat_max_chars() then
    raise exception 'A comment must be 1 to % characters', collaboration_chat_max_chars() using errcode = 'EC001';
  end if;
  if (select count(*) from collaboration_messages where author_id = v_actor and kind = 'comment' and created_at > now() - interval '1 hour')
     >= collaboration_comments_per_hour() then
    raise exception 'That''s % comments in the last hour -- try again later', collaboration_comments_per_hour() using errcode = 'EC001';
  end if;
  insert into collaboration_messages(conversation_id, seq, kind, author_id, session_id, content, request_id)
    values (c.id, collaboration_next_seq(c.id), 'comment', v_actor,
      (select s.id from collaboration_sessions s where s.conversation_id = c.id and s.status = 'active' order by s.started_at desc limit 1),
      v_content, p_request)
    returning * into m;
  update collaboration_conversations set last_activity_at = now() where id = c.id;
  return jsonb_build_object('messageId', m.id);
end;
$$;

-- One of the pair passes a comment on to Ember, or asks again after a
-- failed or cancelled answer. Already waiting, answering or answered:
-- returned as it is.
create or replace function collaboration_queue_turn(p_session uuid, p_connection uuid, p_message uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_sessions;
  m collaboration_messages;
  t collaboration_turns;
begin
  s := collaboration_lock_for_chat(p_session, p_connection, v_actor);
  select * into m from collaboration_messages where id = p_message and conversation_id = s.conversation_id;
  if not found or m.kind = 'reply' then
    raise exception 'That isn''t a question or comment in this conversation' using errcode = 'EC001';
  end if;
  select * into t from collaboration_turns where prompt_id = m.id for update;
  if t.id is not null and t.status in ('queued', 'running', 'done') then
    return jsonb_build_object('messageId', m.id, 'turnId', t.id, 'status', t.status);
  end if;
  perform collaboration_check_queue(s.conversation_id);
  if t.id is not null then
    update collaboration_turns
      set status = 'queued', session_id = s.id, requested_by = v_actor, error = null, attempts = 0,
          lease_id = null, lease_expires_at = null, finished_at = null, updated_at = now()
      where id = t.id returning * into t;
  else
    insert into collaboration_turns(conversation_id, session_id, prompt_id, requested_by)
      values (s.conversation_id, s.id, m.id, v_actor) returning * into t;
  end if;
  update collaboration_conversations set last_activity_at = now() where id = s.conversation_id;
  return jsonb_build_object('messageId', m.id, 'turnId', t.id, 'status', t.status);
end;
$$;

revoke all on function collaboration_ask_ember(uuid, uuid, text, uuid) from public, anon;
revoke all on function collaboration_post_comment(uuid, text, uuid) from public, anon;
revoke all on function collaboration_queue_turn(uuid, uuid, uuid) from public, anon;
grant execute on function collaboration_ask_ember(uuid, uuid, text, uuid) to authenticated;
grant execute on function collaboration_post_comment(uuid, text, uuid) to authenticated;
grant execute on function collaboration_queue_turn(uuid, uuid, uuid) to authenticated;

