-- Paste-in part 1 of 3 of supabase/migrations/20261025100001_collaboration_shared_chat.sql
-- (the SQL Editor runs only about the first 20,000 characters). Run the parts
-- in order; each is safe to re-run. Generated from the migration -- edit that, not this.

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

