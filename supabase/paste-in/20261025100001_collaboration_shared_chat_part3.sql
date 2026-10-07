-- Paste-in part 3 of 3 of supabase/migrations/20261025100001_collaboration_shared_chat.sql
-- (the SQL Editor runs only about the first 20,000 characters). Run the parts
-- in order; each is safe to re-run. Generated from the migration -- edit that, not this.

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
