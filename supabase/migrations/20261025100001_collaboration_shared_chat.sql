-- Shared workspace sessions, Phase 3: shared Ember chat
-- (docs/dev-request-shared-workspace-sessions.md).
--
-- A shared conversation gets one ordered chat. In a live session either of
-- the pair asks Ember; each question is an attributed message and a queued
-- turn, answered one at a time in order. The conversation's viewers read
-- the chat (the recap) and post comments; Ember doesn't answer a comment
-- unless one of the pair passes it on, and the answer is then attributed
-- to both.
--
-- Who reads what: everyone who can read the chat -- the pair and its
-- viewers -- is the audience, so Ember may only use evidence (knowledge
-- sources and wiki articles) that every one of them can open. That is
-- checked with the real access rules, not a copy of them:
-- collaboration_common_evidence evaluates the ordinary row-level security
-- of knowledge_sources and wiki_articles as each reader in turn. A reply
-- records the evidence it was built from; a reply is readable only by a
-- reader who can still open all of it (a row-level-security policy on
-- collaboration_messages), so someone who loses access to a source stops
-- seeing answers that drew on it, and a newly added viewer never sees
-- answers built from sources they can't open.
--
-- Turns run in the app server (a Route Handler with the service role):
-- claiming, completing and failing a turn are callable by the service role
-- only, so no browser can write an Ember reply. A claimed turn holds a
-- lease; a run that stops is retried once, then marked failed. A question
-- carries a request id, so a retried send never posts twice, and a
-- completed turn never gets a second reply.
--
-- Nothing here deletes a row: turns end as done, failed or cancelled.
-- No existing table is altered. Safe to re-run. Requires 20261023100001
-- and 20261024100001.

create table if not exists collaboration_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references collaboration_conversations(id) on delete cascade,
  -- Server order within the conversation.
  seq bigint not null,
  -- message: one of the pair asking Ember; comment: a viewer's comment;
  -- reply: Ember's answer.
  kind text not null check (kind in ('message', 'comment', 'reply')),
  author_id uuid references profiles(id) on delete set null,
  session_id uuid references collaboration_sessions(id) on delete set null,
  content text not null check (char_length(content) between 1 and 20000),
  -- The knowledge sources and wiki articles a reply was built from:
  -- [{"type": "knowledge_source" | "wiki_article", "id": ..., "title": ...}].
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  turn_id uuid,
  request_id uuid unique,
  provider text,
  model text,
  created_at timestamptz not null default now(),
  unique (conversation_id, seq),
  check (kind <> 'reply' or turn_id is not null)
);

create table if not exists collaboration_turns (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references collaboration_conversations(id) on delete cascade,
  session_id uuid not null references collaboration_sessions(id) on delete cascade,
  -- The question or passed-on comment being answered: one turn each.
  prompt_id uuid not null unique references collaboration_messages(id) on delete cascade,
  requested_by uuid not null references profiles(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  lease_id uuid,
  lease_expires_at timestamptz,
  attempts integer not null default 0,
  claimed_by uuid references profiles(id) on delete set null,
  reply_id uuid references collaboration_messages(id) on delete set null,
  error text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists collaboration_turns_open_idx on collaboration_turns(conversation_id, status, created_at);

alter table collaboration_messages enable row level security;
alter table collaboration_turns enable row level security;
revoke all on collaboration_messages, collaboration_turns from anon, authenticated;
-- Messages are read through their row-level-security policy (below), so
-- that the evidence check runs as the reader. Writes go through functions.
grant select on collaboration_messages to authenticated;

-- Limits ----------------------------------------------------------------------------

create or replace function collaboration_chat_max_chars() returns integer
language sql immutable as $$ select 4000 $$;
-- Questions waiting or being answered, per conversation.
create or replace function collaboration_chat_queue_limit() returns integer
language sql immutable as $$ select 3 $$;
create or replace function collaboration_comments_per_hour() returns integer
language sql immutable as $$ select 30 $$;
-- How long a claimed turn may run before another run may take it over.
create or replace function collaboration_turn_lease() returns interval
language sql immutable as $$ select interval '150 seconds' $$;

-- Reading -----------------------------------------------------------------------------

-- The caller may read this conversation (one of the pair, or a viewer,
-- with access).
create or replace function collaboration_is_reader(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select collaboration_conversation_role(c, auth.uid()) is not null
    from collaboration_conversations c where c.id = p_conversation), false);
$$;

-- Whether the current user can open every item of p_evidence, by the
-- ordinary row-level security of the two tables (security invoker: it
-- runs as whoever is asking).
create or replace function collaboration_evidence_visible(p_evidence jsonb)
returns boolean
language sql stable security invoker set search_path = public as $$
  select not exists (
    select 1 from jsonb_array_elements(coalesce(p_evidence, '[]'::jsonb)) e
    where not case e->>'type'
      when 'knowledge_source' then case when (e->>'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then exists (select 1 from knowledge_sources k where k.id = (e->>'id')::uuid) else false end
      when 'wiki_article' then exists (select 1 from wiki_articles w where w.slug = e->>'id')
      else false
    end
  );
$$;

create or replace function collaboration_message_readable(p_conversation uuid, p_evidence jsonb)
returns boolean
language sql stable security invoker set search_path = public as $$
  select collaboration_is_reader(p_conversation) and collaboration_evidence_visible(p_evidence);
$$;

drop policy if exists collaboration_messages_select_readers on collaboration_messages;
create policy collaboration_messages_select_readers on collaboration_messages
  for select to authenticated
  using (collaboration_message_readable(conversation_id, evidence));

-- Everyone who reads the conversation: the pair and its viewers with
-- access. Only one of the pair may ask.
create or replace function collaboration_reader_ids(p_conversation uuid)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  c collaboration_conversations;
begin
  select * into c from collaboration_conversations where id = p_conversation;
  if not found or collaboration_conversation_role(c, auth.uid()) is distinct from 'participant' then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return array[c.user_a, c.user_b] || coalesce((
    select array_agg(v.user_id order by v.user_id) from collaboration_viewers v
    where v.conversation_id = c.id and v.status = 'active' and collaboration_has_access(c.project_id, v.user_id)
  ), '{}');
end;
$$;

-- The items of p_evidence that every reader of the conversation can open.
-- Evaluates the real access rules as each reader: the request's identity
-- (the claims auth.uid() reads) is switched to each reader in turn, for
-- this transaction only, and put back before returning. Called by the app
-- server with the signed-in caller's own credentials, before evidence
-- reaches Ember; the caller must be one of the pair.
create or replace function collaboration_common_evidence(p_conversation uuid, p_evidence jsonb)
returns jsonb
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_readers uuid[];
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_items jsonb;
  v_reader uuid;
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'An external client cannot use shared chat' using errcode = '42501';
  end if;
  v_readers := collaboration_reader_ids(p_conversation);
  if jsonb_typeof(p_evidence) is distinct from 'array' or jsonb_array_length(p_evidence) > 200 then
    raise exception 'Evidence must be a list of at most 200 items' using errcode = 'EC001';
  end if;
  -- Well-formed items, once each.
  select coalesce(jsonb_agg(x), '[]'::jsonb) into v_items from (
    select distinct on (e->>'type', e->>'id') e as x from jsonb_array_elements(p_evidence) e
    where e->>'type' in ('knowledge_source', 'wiki_article') and coalesce(e->>'id', '') <> ''
  ) d;
  foreach v_reader in array v_readers loop
    exit when jsonb_array_length(v_items) = 0;
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_reader, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_reader::text, true);
    select coalesce(jsonb_agg(e), '[]'::jsonb) into v_items
      from jsonb_array_elements(v_items) e where collaboration_evidence_visible(jsonb_build_array(e));
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_items;
end;
$$;

-- A session in which Ember may answer: live, both of the pair still in it
-- and with access.
create or replace function collaboration_session_live(s collaboration_sessions)
returns boolean
language sql stable security definer set search_path = public as $$
  select s.status = 'active'
    and (select d.ends_at > now() from collaboration_deadline(s.id) d)
    and collaboration_has_access(s.project_id, s.host_id) and collaboration_has_access(s.project_id, s.guest_id)
    and not exists (select 1 from collaboration_participants p where p.session_id = s.id and p.left_at is not null);
$$;

-- The chat's state for the polled snapshots (no content): the client
-- reloads the chat when the version changes, and a participant's browser
-- starts the turn runner when work is waiting and nobody is running it.
create or replace function collaboration_chat_state_json(p_conversation uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', coalesce((select max(seq) from collaboration_messages where conversation_id = p_conversation), 0)::text || ':' ||
      coalesce((select floor(extract(epoch from max(updated_at)) * 1000)::bigint from collaboration_turns where conversation_id = p_conversation), 0)::text,
    'waiting', (select count(*) from collaboration_turns where conversation_id = p_conversation and status = 'queued')::int,
    'answering', exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running' and lease_expires_at > now()),
    'needsRunner', exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running' and lease_expires_at <= now())
      or (exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'queued')
          and not exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running'))
  );
$$;

revoke all on function collaboration_chat_max_chars() from public, anon, authenticated;
revoke all on function collaboration_chat_queue_limit() from public, anon, authenticated;
revoke all on function collaboration_comments_per_hour() from public, anon, authenticated;
revoke all on function collaboration_turn_lease() from public, anon, authenticated;
revoke all on function collaboration_session_live(collaboration_sessions) from public, anon, authenticated;
revoke all on function collaboration_chat_state_json(uuid) from public, anon, authenticated;
-- Called from the read policy and the evidence check, so callable by
-- signed-in users; each answers only for the caller.
revoke all on function collaboration_is_reader(uuid) from public, anon;
revoke all on function collaboration_evidence_visible(jsonb) from public, anon;
revoke all on function collaboration_message_readable(uuid, jsonb) from public, anon;
revoke all on function collaboration_reader_ids(uuid) from public, anon;
revoke all on function collaboration_common_evidence(uuid, jsonb) from public, anon;
grant execute on function collaboration_is_reader(uuid) to authenticated;
grant execute on function collaboration_evidence_visible(jsonb) to authenticated;
grant execute on function collaboration_message_readable(uuid, jsonb) to authenticated;
grant execute on function collaboration_reader_ids(uuid) to authenticated;
grant execute on function collaboration_common_evidence(uuid, jsonb) to authenticated;

-- The chat without its text: order, kinds, authors, turn states. Every
-- reader gets the whole outline; text comes from collaboration_chat.
create or replace function collaboration_chat_outline(p_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_actor();
  c collaboration_conversations;
  v_role text;
begin
  select * into c from collaboration_conversations where id = p_conversation;
  v_role := case when found then collaboration_conversation_role(c, v_actor) end;
  if v_role is null then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'conversationId', c.id,
    'projectId', c.project_id,
    'myRole', v_role,
    'liveSessionId', (select s.id from collaboration_sessions s where s.conversation_id = c.id and s.status = 'active'
      order by s.started_at desc limit 1),
    'state', collaboration_chat_state_json(c.id),
    'messages', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id, 'seq', m.seq, 'kind', m.kind, 'authorId', m.author_id,
        'authorName', case when m.author_id is not null then collaboration_display_name(m.author_id) end,
        'createdAt', m.created_at,
        -- A reply: the question it answers.
        'promptId', (select t.prompt_id from collaboration_turns t where t.id = m.turn_id),
        -- A question or comment: its turn, if it has one.
        'turn', (select jsonb_build_object('id', t.id,
            'status', case when t.status = 'queued' and not collaboration_session_live(s) then 'cancelled' else t.status end,
            'requestedById', t.requested_by, 'requestedByName', collaboration_display_name(t.requested_by),
            'replyId', t.reply_id, 'error', t.error)
          from collaboration_turns t join collaboration_sessions s on s.id = t.session_id where t.prompt_id = m.id)
      ) order by m.seq)
      from (select * from collaboration_messages where conversation_id = c.id order by seq desc limit 300) m
    ), '[]'::jsonb)
  );
end;
$$;

-- The chat for the caller: the outline, with each message's text where
-- the caller may read it (the read policy decides, as the caller), and
-- "hidden" where they may not.
create or replace function collaboration_chat(p_conversation uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  o jsonb := collaboration_chat_outline(p_conversation);
begin
  return o || jsonb_build_object('messages', coalesce((
    select jsonb_agg(case when x.id is null then m || jsonb_build_object('hidden', true)
                          else m || jsonb_build_object('content', x.content, 'evidence', x.evidence) end
                     order by (m->>'seq')::bigint)
    from jsonb_array_elements(o->'messages') m
    left join collaboration_messages x on x.id = (m->>'id')::uuid
  ), '[]'::jsonb));
end;
$$;

revoke all on function collaboration_chat_outline(uuid) from public, anon;
revoke all on function collaboration_chat(uuid) from public, anon;
grant execute on function collaboration_chat_outline(uuid) to authenticated;
grant execute on function collaboration_chat(uuid) to authenticated;

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

-- Running turns (the app server, service role only) -------------------------------------

-- Takes the next waiting turn for p_actor (one of the pair, checked by the
-- app server's own signed-in call first and again here). One turn runs at
-- a time per conversation. Returns the question and the conversation so
-- far, unfiltered: the app server filters it to common evidence (with
-- collaboration_common_evidence, as the caller) before Ember sees it.
create or replace function collaboration_claim_turn(p_conversation uuid, p_actor uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  c collaboration_conversations;
  t collaboration_turns;
  p collaboration_messages;
  v_lease uuid := gen_random_uuid();
begin
  select * into c from collaboration_conversations where id = p_conversation for update;
  if not found or collaboration_conversation_role(c, p_actor) is distinct from 'participant' then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  -- A run that stopped without finishing: run again once, then failed.
  update collaboration_turns
    set status = case when attempts < 2 then 'queued' else 'failed' end,
        error = case when attempts < 2 then null else 'Ember didn''t finish answering. Ask again.' end,
        finished_at = case when attempts < 2 then null else now() end,
        lease_expires_at = null, updated_at = now()
    where conversation_id = c.id and status = 'running' and lease_expires_at <= now();
  if exists (select 1 from collaboration_turns where conversation_id = c.id and status = 'running') then
    return jsonb_build_object('state', 'busy');
  end if;
  -- Waiting questions from a session that is no longer live aren't answered.
  update collaboration_turns q
    set status = 'cancelled', error = 'The live session ended before Ember answered.', finished_at = now(), updated_at = now()
    from collaboration_sessions s
    where s.id = q.session_id and q.conversation_id = c.id and q.status = 'queued' and not collaboration_session_live(s);
  select * into t from collaboration_turns where conversation_id = c.id and status = 'queued' order by created_at, id limit 1;
  if not found then
    return jsonb_build_object('state', 'idle');
  end if;
  update collaboration_turns
    set status = 'running', lease_id = v_lease, lease_expires_at = now() + collaboration_turn_lease(),
        attempts = attempts + 1, claimed_by = p_actor, started_at = coalesce(started_at, now()), updated_at = now()
    where id = t.id returning * into t;
  select * into p from collaboration_messages where id = t.prompt_id;
  return jsonb_build_object(
    'state', 'claimed',
    'turnId', t.id,
    'leaseId', v_lease,
    'conversationId', c.id,
    'projectId', c.project_id,
    'sessionId', t.session_id,
    'requestedByName', collaboration_display_name(t.requested_by),
    'prompt', jsonb_build_object('id', p.id, 'kind', p.kind, 'content', p.content, 'authorName', collaboration_display_name(p.author_id)),
    -- Earlier questions and passed-on comments, each followed by its reply
    -- (a reply can be posted after later questions were asked); the latest 30.
    'history', coalesce((
      select jsonb_agg(jsonb_build_object('kind', h.kind,
        'authorName', case when h.author_id is not null then collaboration_display_name(h.author_id) end,
        'content', h.content, 'evidence', h.evidence) order by h.ord, h.seq)
      from (
        select m.*, coalesce(pm.seq, m.seq) as ord from collaboration_messages m
        left join collaboration_turns rt on rt.id = m.turn_id
        left join collaboration_messages pm on pm.id = rt.prompt_id
        where m.conversation_id = c.id and coalesce(pm.seq, m.seq) < p.seq
          and (m.kind <> 'comment' or exists (select 1 from collaboration_turns x where x.prompt_id = m.id))
        order by coalesce(pm.seq, m.seq) desc, m.seq desc limit 30
      ) h
    ), '[]'::jsonb)
  );
end;
$$;

-- Records Ember's answer for a claimed turn, once. A repeat with the same
-- lease returns the first result; a turn no longer held by this lease is
-- refused (EC003). p_evidence: everything the answer was built from.
create or replace function collaboration_complete_turn(p_turn uuid, p_lease uuid, p_content text, p_evidence jsonb, p_provider text, p_model text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_conversation uuid;
  t collaboration_turns;
  r collaboration_messages;
begin
  select conversation_id into v_conversation from collaboration_turns where id = p_turn;
  if not found then
    raise exception 'Unknown turn' using errcode = 'EC001';
  end if;
  perform 1 from collaboration_conversations where id = v_conversation for update;
  select * into t from collaboration_turns where id = p_turn for update;
  if t.status = 'done' and t.lease_id = p_lease then
    return jsonb_build_object('status', 'done', 'replyId', t.reply_id);
  end if;
  if t.status <> 'running' or t.lease_id is distinct from p_lease then
    raise exception 'This answer is no longer wanted' using errcode = 'EC003';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(p_evidence) e
    where e->>'type' not in ('knowledge_source', 'wiki_article') or coalesce(e->>'id', '') = ''
  ) then
    raise exception 'Malformed evidence' using errcode = 'EC001';
  end if;
  insert into collaboration_messages(conversation_id, seq, kind, session_id, content, evidence, turn_id, provider, model)
    values (t.conversation_id, collaboration_next_seq(t.conversation_id), 'reply', t.session_id,
      coalesce(nullif(left(btrim(coalesce(p_content, '')), 20000), ''), '(no answer)'), p_evidence, t.id, p_provider, p_model)
    returning * into r;
  update collaboration_turns
    set status = 'done', reply_id = r.id, error = null, lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = t.id;
  update collaboration_conversations set last_activity_at = now() where id = t.conversation_id;
  return jsonb_build_object('status', 'done', 'replyId', r.id);
end;
$$;

-- Records that a claimed turn couldn't be answered (shown to everyone;
-- either of the pair can ask again).
create or replace function collaboration_fail_turn(p_turn uuid, p_lease uuid, p_error text)
returns void
language sql security definer set search_path = public as $$
  update collaboration_turns
    set status = 'failed', error = left(coalesce(nullif(btrim(p_error), ''), 'Ember couldn''t answer.'), 300),
        lease_expires_at = null, finished_at = now(), updated_at = now()
    where id = p_turn and status = 'running' and lease_id = p_lease;
$$;

revoke all on function collaboration_claim_turn(uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_complete_turn(uuid, uuid, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function collaboration_fail_turn(uuid, uuid, text) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function collaboration_claim_turn(uuid, uuid) to service_role;
    grant execute on function collaboration_complete_turn(uuid, uuid, text, jsonb, text, text) to service_role;
    grant execute on function collaboration_fail_turn(uuid, uuid, text) to service_role;
  end if;
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
