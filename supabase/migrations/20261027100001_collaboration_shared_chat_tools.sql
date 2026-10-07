-- Shared workspace sessions, Phase 3 completed: the shared chat's summary,
-- and Ember's proposals (docs/dev-request-shared-workspace-sessions.md).
--
-- Summary. Ember sees the latest 30 messages of a shared chat; what is
-- older is kept as a summary. The app server writes it (service role
-- only) from messages every reader can open, and records the evidence it
-- was built from. Like an answer, a summary is readable only by readers
-- who can still open all of that evidence, and Ember stops using one that
-- isn't fully common any more. Each summary is a new row; older ones are
-- kept. Either of the pair can review a summary and publish it as a
-- Project note (with their own note permissions).
--
-- Proposals. Ember's answer can carry proposals -- a Project note to send,
-- or new text for a Project or Workstream field -- stored on the answer, so
-- they are hidden wherever the answer is. Ember never acts: one of the pair
-- sends a note as themselves, and the person in control puts proposed
-- text into the shared draft, which saves under the Phase 2 rules.
-- collaboration_proposal_uses records what happened to each one.
--
-- Wider audiences. A note, or a Project or Workstream field, is read by more
-- people than the conversation. collaboration_evidence_project_visible
-- says whether every active member of the Project can open some evidence
-- (the real access rules, evaluated as each member); the app sends or
-- applies a proposal, or publishes a summary, only when it can. A Project
-- that isn't private takes field text only if it used no evidence at all.
--
-- Additive: adds a column to collaboration_messages (Phase 3's own table),
-- two tables and functions; changes no other table. Nothing is deleted.
-- Safe to re-run. Requires 20261025100001.

alter table collaboration_messages add column if not exists proposals jsonb not null default '[]';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'collaboration_messages_proposals_array') then
    alter table collaboration_messages add constraint collaboration_messages_proposals_array
      check (jsonb_typeof(proposals) = 'array' and jsonb_array_length(proposals) <= 3);
  end if;
end;
$$;

create table if not exists collaboration_summaries (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references collaboration_conversations(id) on delete cascade,
  -- Covers every message up to this point in reading order (an answer
  -- counts at its question's place).
  upto_ord bigint not null,
  content text not null check (char_length(content) between 1 and 8000),
  evidence jsonb not null default '[]' check (jsonb_typeof(evidence) = 'array'),
  provider text,
  model text,
  published_note_id uuid,
  published_by uuid references profiles(id) on delete set null,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  unique (conversation_id, upto_ord)
);

create table if not exists collaboration_proposal_uses (
  message_id uuid not null references collaboration_messages(id) on delete cascade,
  idx integer not null check (idx between 0 and 2),
  -- sending -> sent | failed (a note); applied (field text put into the
  -- shared draft); dismissed.
  status text not null check (status in ('sending', 'sent', 'failed', 'applied', 'dismissed')),
  by_user uuid references profiles(id) on delete set null,
  result jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (message_id, idx)
);

alter table collaboration_summaries enable row level security;
alter table collaboration_proposal_uses enable row level security;
revoke all on collaboration_summaries, collaboration_proposal_uses from anon, authenticated;
grant select on collaboration_summaries to authenticated;

drop policy if exists collaboration_summaries_select_readers on collaboration_summaries;
create policy collaboration_summaries_select_readers on collaboration_summaries
  for select to authenticated
  using (collaboration_message_readable(conversation_id, evidence));

-- Audiences ---------------------------------------------------------------------------

-- The Project's active members (actual membership, active accounts), for
-- one of the conversation's pair.
create or replace function collaboration_project_member_ids(p_conversation uuid)
returns uuid[]
language plpgsql stable security definer set search_path = public as $$
declare
  c collaboration_conversations;
begin
  select * into c from collaboration_conversations where id = p_conversation;
  if not found or collaboration_conversation_role(c, auth.uid()) is distinct from 'participant' then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return coalesce((
    select array_agg(m.user_id order by m.user_id) from project_members m join profiles p on p.id = m.user_id
    where m.project_id = c.project_id and m.status = 'active' and p.is_active
  ), '{}');
end;
$$;

-- Whether the conversation's Project is private (for its readers).
create or replace function collaboration_project_is_private(p_conversation uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.visibility = 'private' from collaboration_conversations c join projects p on p.id = c.project_id
    where c.id = p_conversation and collaboration_is_reader(c.id)), false);
$$;

-- Whether every active member of the conversation's Project can open all
-- of p_evidence, by the real access rules evaluated as each member (as in
-- collaboration_common_evidence). For one of the pair; refuses MCP tokens.
-- No evidence: true. p_require_private: also false when the Project isn't
-- private and there is evidence (text shown outside the membership).
create or replace function collaboration_evidence_project_visible(p_conversation uuid, p_evidence jsonb, p_require_private boolean default false)
returns boolean
language plpgsql volatile security invoker set search_path = public as $$
declare
  v_members uuid[];
  v_claims text := current_setting('request.jwt.claims', true);
  v_sub text := current_setting('request.jwt.claim.sub', true);
  v_member uuid;
  v_ok boolean := true;
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'An external client cannot use shared chat' using errcode = '42501';
  end if;
  v_members := collaboration_project_member_ids(p_conversation);
  if jsonb_typeof(p_evidence) is distinct from 'array' then
    raise exception 'Evidence must be a list' using errcode = 'EC001';
  end if;
  if jsonb_array_length(p_evidence) = 0 then
    return true;
  end if;
  if p_require_private and not collaboration_project_is_private(p_conversation) then
    return false;
  end if;
  if coalesce(array_length(v_members, 1), 0) > 500 then
    return false;
  end if;
  foreach v_member in array v_members loop
    perform set_config('request.jwt.claims', jsonb_build_object('sub', v_member, 'role', 'authenticated')::text, true);
    perform set_config('request.jwt.claim.sub', v_member::text, true);
    v_ok := collaboration_evidence_visible(p_evidence);
    exit when not v_ok;
  end loop;
  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  return v_ok;
end;
$$;

revoke all on function collaboration_project_member_ids(uuid) from public, anon;
revoke all on function collaboration_project_is_private(uuid) from public, anon;
grant execute on function collaboration_project_is_private(uuid) to authenticated;
revoke all on function collaboration_evidence_project_visible(uuid, jsonb, boolean) from public, anon;
grant execute on function collaboration_project_member_ids(uuid) to authenticated;
grant execute on function collaboration_evidence_project_visible(uuid, jsonb, boolean) to authenticated;

-- Reading -----------------------------------------------------------------------------

-- What happened to the proposals in the conversation (no proposal text).
create or replace function collaboration_proposal_uses_json(p_conversation uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
begin
  if not collaboration_is_reader(p_conversation) then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('messageId', u.message_id, 'index', u.idx, 'status', u.status,
      'byName', case when u.by_user is not null then collaboration_display_name(u.by_user) end, 'result', u.result))
    from collaboration_proposal_uses u join collaboration_messages m on m.id = u.message_id
    where m.conversation_id = p_conversation
  ), '[]'::jsonb);
end;
$$;

-- How far the latest summary reaches (whether or not the caller may read it).
create or replace function collaboration_latest_summary_ord(p_conversation uuid)
returns bigint
language sql stable security definer set search_path = public as $$
  select max(upto_ord) from collaboration_summaries where conversation_id = p_conversation and collaboration_is_reader(p_conversation);
$$;

revoke all on function collaboration_proposal_uses_json(uuid) from public, anon;
revoke all on function collaboration_latest_summary_ord(uuid) from public, anon;
grant execute on function collaboration_proposal_uses_json(uuid) to authenticated;
grant execute on function collaboration_latest_summary_ord(uuid) to authenticated;

-- The chat for the caller (as in 20261025100001), now with each readable
-- answer's proposals, what became of them, and the latest summary the
-- caller may read (or that one exists that they may not).
create or replace function collaboration_chat(p_conversation uuid)
returns jsonb
language plpgsql stable security invoker set search_path = public as $$
declare
  o jsonb := collaboration_chat_outline(p_conversation);
  v_latest bigint := collaboration_latest_summary_ord(p_conversation);
begin
  return o || jsonb_build_object(
    'messages', coalesce((
      select jsonb_agg(case when x.id is null then m || jsonb_build_object('hidden', true)
                            else m || jsonb_build_object('content', x.content, 'evidence', x.evidence, 'proposals', x.proposals) end
                       order by (m->>'seq')::bigint)
      from jsonb_array_elements(o->'messages') m
      left join collaboration_messages x on x.id = (m->>'id')::uuid
    ), '[]'::jsonb),
    'proposalUses', collaboration_proposal_uses_json(p_conversation),
    -- Read through the summaries' own policy: null if the caller may not
    -- read the latest one.
    'summary', (
      select jsonb_build_object('id', s.id, 'uptoOrd', s.upto_ord, 'content', s.content, 'evidence', s.evidence,
        'createdAt', s.created_at, 'publishedNoteId', s.published_note_id, 'publishedAt', s.published_at)
      from collaboration_summaries s where s.conversation_id = p_conversation and s.upto_ord = v_latest
    ),
    'summaryHidden', v_latest is not null and not exists (
      select 1 from collaboration_summaries s where s.conversation_id = p_conversation and s.upto_ord = v_latest)
  );
end;
$$;

-- The chat's polled state (as in 20261025100001), whose version now also
-- changes when a proposal is used or a summary is written, so the others'
-- chats reload.
create or replace function collaboration_chat_state_json(p_conversation uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'version', coalesce((select max(seq) from collaboration_messages where conversation_id = p_conversation), 0)::text || ':' ||
      coalesce((select floor(extract(epoch from max(updated_at)) * 1000)::bigint from collaboration_turns where conversation_id = p_conversation), 0)::text || ':' ||
      coalesce((select floor(extract(epoch from max(u.updated_at)) * 1000)::bigint from collaboration_proposal_uses u
        join collaboration_messages m on m.id = u.message_id where m.conversation_id = p_conversation), 0)::text || ':' ||
      coalesce((select floor(extract(epoch from max(coalesce(published_at, created_at))) * 1000)::bigint from collaboration_summaries
        where conversation_id = p_conversation), 0)::text,
    'waiting', (select count(*) from collaboration_turns where conversation_id = p_conversation and status = 'queued')::int,
    'answering', exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running' and lease_expires_at > now()),
    'needsRunner', exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running' and lease_expires_at <= now())
      or (exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'queued')
          and not exists (select 1 from collaboration_turns where conversation_id = p_conversation and status = 'running'))
  );
$$;

-- Proposals ---------------------------------------------------------------------------

-- One of the pair records what they did with a proposal: sending (a note,
-- before sending it), sent or failed (after), applied (field text put into
-- the shared draft), dismissed. A sent note can't be sent again; a note
-- being sent by someone else can't be taken over.
create or replace function collaboration_update_proposal(p_message uuid, p_index integer, p_status text, p_result jsonb default '{}')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  m collaboration_messages;
  c collaboration_conversations;
  u collaboration_proposal_uses;
  v_kind text;
begin
  select * into m from collaboration_messages where id = p_message;
  if found then
    select * into c from collaboration_conversations where id = m.conversation_id for update;
  end if;
  if not found or collaboration_conversation_role(c, v_actor) is distinct from 'participant' then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  v_kind := m.proposals -> p_index ->> 'kind';
  if m.kind <> 'reply' or v_kind is null then
    raise exception 'That proposal doesn''t exist' using errcode = 'EC001';
  end if;
  if p_status not in ('sending', 'sent', 'failed', 'applied', 'dismissed') then
    raise exception 'Unknown proposal status' using errcode = 'EC001';
  end if;
  if (v_kind = 'note' and p_status not in ('sending', 'sent', 'failed', 'dismissed'))
     or (v_kind = 'field' and p_status not in ('applied', 'dismissed')) then
    raise exception 'That doesn''t apply to this proposal' using errcode = 'EC001';
  end if;
  select * into u from collaboration_proposal_uses where message_id = m.id and idx = p_index for update;
  if u.message_id is not null then
    if u.status = 'sent' then
      raise exception 'That note was already sent' using errcode = 'EC004';
    end if;
    if u.status = 'sending' and (p_status not in ('sent', 'failed') or u.by_user is distinct from v_actor) then
      raise exception 'Someone is sending that note right now' using errcode = 'EC004';
    end if;
  end if;
  if p_status in ('sent', 'failed') and (u.status is distinct from 'sending' or u.by_user is distinct from v_actor) then
    raise exception 'Start sending the note first' using errcode = 'EC001';
  end if;
  insert into collaboration_proposal_uses(message_id, idx, status, by_user, result, updated_at)
    values (m.id, p_index, p_status, v_actor, coalesce(p_result, '{}'), now())
    on conflict (message_id, idx) do update set status = excluded.status, by_user = excluded.by_user, result = excluded.result, updated_at = now();
  return jsonb_build_object('messageId', m.id, 'index', p_index, 'status', p_status);
end;
$$;

-- One of the pair records that they published a summary as a Project note.
create or replace function collaboration_mark_summary_published(p_summary uuid, p_note uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := collaboration_writer();
  s collaboration_summaries;
  c collaboration_conversations;
begin
  select * into s from collaboration_summaries where id = p_summary for update;
  if found then
    select * into c from collaboration_conversations where id = s.conversation_id;
  end if;
  if not found or collaboration_conversation_role(c, v_actor) is distinct from 'participant' then
    raise exception 'Collaboration access denied' using errcode = '42501';
  end if;
  if not exists (select 1 from project_notes where id = p_note and project_id = c.project_id and author_id = v_actor) then
    raise exception 'That note isn''t yours in this Project' using errcode = 'EC001';
  end if;
  update collaboration_summaries set published_note_id = p_note, published_by = v_actor, published_at = now() where id = s.id;
end;
$$;

revoke all on function collaboration_update_proposal(uuid, integer, text, jsonb) from public, anon;
revoke all on function collaboration_mark_summary_published(uuid, uuid) from public, anon;
grant execute on function collaboration_update_proposal(uuid, integer, text, jsonb) to authenticated;
grant execute on function collaboration_mark_summary_published(uuid, uuid) to authenticated;

-- Running turns (the app server, service role only) -------------------------------------

-- For a claimed turn: the latest summary, and the older messages it
-- doesn't cover yet (outside the latest 30 Ember sees; at most 150, oldest
-- first), so the app server can write a new summary.
create or replace function collaboration_turn_context(p_turn uuid, p_lease uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  t collaboration_turns;
  p collaboration_messages;
  s collaboration_summaries;
begin
  select * into t from collaboration_turns where id = p_turn;
  if not found or t.lease_id is distinct from p_lease or t.status not in ('running', 'done') then
    raise exception 'This answer is no longer wanted' using errcode = 'EC003';
  end if;
  select * into p from collaboration_messages where id = t.prompt_id;
  select * into s from collaboration_summaries where conversation_id = t.conversation_id order by upto_ord desc limit 1;
  return jsonb_build_object(
    'summary', case when s.id is not null then jsonb_build_object('id', s.id, 'uptoOrd', s.upto_ord, 'content', s.content, 'evidence', s.evidence) end,
    'unsummarized', coalesce((
      with eligible as (
        -- Earlier messages Ember may see, in reading order (as
        -- collaboration_claim_turn picks them).
        select m.kind, m.author_id, m.content, m.evidence, coalesce(pm.seq, m.seq) as ord, m.seq
        from collaboration_messages m
        left join collaboration_turns rt on rt.id = m.turn_id
        left join collaboration_messages pm on pm.id = rt.prompt_id
        where m.conversation_id = t.conversation_id and coalesce(pm.seq, m.seq) < p.seq
          and (m.kind <> 'comment' or exists (select 1 from collaboration_turns x where x.prompt_id = m.id))
      ), recent as (
        select ord, seq from eligible order by ord desc, seq desc limit 30
      ), older as (
        select e.* from eligible e
        where not exists (select 1 from recent r where r.ord = e.ord and r.seq = e.seq)
          and e.ord > coalesce(s.upto_ord, 0)
        order by e.ord, e.seq limit 150
      )
      select jsonb_agg(jsonb_build_object('kind', o.kind, 'ord', o.ord,
        'authorName', case when o.author_id is not null then collaboration_display_name(o.author_id) end,
        'content', o.content, 'evidence', o.evidence) order by o.ord, o.seq)
      from older o
    ), '[]'::jsonb)
  );
end;
$$;

-- Records a new summary covering everything up to p_upto_ord. Ignored
-- (returns null) if a summary already covers that far.
create or replace function collaboration_record_summary(p_conversation uuid, p_upto_ord bigint, p_content text, p_evidence jsonb, p_provider text, p_model text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
begin
  perform 1 from collaboration_conversations where id = p_conversation for update;
  if not found then
    raise exception 'Unknown conversation' using errcode = 'EC001';
  end if;
  if jsonb_typeof(p_evidence) is distinct from 'array' or exists (
    select 1 from jsonb_array_elements(p_evidence) e
    where e->>'type' not in ('knowledge_source', 'wiki_article') or coalesce(e->>'id', '') = ''
  ) then
    raise exception 'Malformed evidence' using errcode = 'EC001';
  end if;
  if exists (select 1 from collaboration_summaries where conversation_id = p_conversation and upto_ord >= p_upto_ord) then
    return null;
  end if;
  insert into collaboration_summaries(conversation_id, upto_ord, content, evidence, provider, model)
    values (p_conversation, p_upto_ord, left(btrim(p_content), 8000), p_evidence, p_provider, p_model)
    returning id into v_id;
  return v_id;
end;
$$;

-- Attaches Ember's proposals to its answer, once, right after the answer
-- is recorded with the same lease. At most 3; each a note or field text.
create or replace function collaboration_set_reply_proposals(p_turn uuid, p_lease uuid, p_proposals jsonb)
returns void
language plpgsql security definer set search_path = public as $$
declare
  t collaboration_turns;
begin
  select * into t from collaboration_turns where id = p_turn for update;
  if not found or t.status <> 'done' or t.lease_id is distinct from p_lease or t.reply_id is null then
    raise exception 'This answer is no longer wanted' using errcode = 'EC003';
  end if;
  if jsonb_typeof(p_proposals) is distinct from 'array' or jsonb_array_length(p_proposals) > 3 or exists (
    select 1 from jsonb_array_elements(p_proposals) e where e->>'kind' not in ('note', 'field')
  ) then
    raise exception 'Malformed proposals' using errcode = 'EC001';
  end if;
  update collaboration_messages set proposals = p_proposals
    where id = t.reply_id and proposals = '[]'::jsonb;
end;
$$;

revoke all on function collaboration_turn_context(uuid, uuid) from public, anon, authenticated;
revoke all on function collaboration_record_summary(uuid, bigint, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function collaboration_set_reply_proposals(uuid, uuid, jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function collaboration_turn_context(uuid, uuid) to service_role;
    grant execute on function collaboration_record_summary(uuid, bigint, text, jsonb, text, text) to service_role;
    grant execute on function collaboration_set_reply_proposals(uuid, uuid, jsonb) to service_role;
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
