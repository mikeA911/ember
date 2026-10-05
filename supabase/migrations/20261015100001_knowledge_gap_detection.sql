-- Ember Readiness, Stage 4 (docs/dev-request-ember-readiness-and-knowledge-
-- gaps.md): Ember detects its own knowledge gaps in Project-bound chat and
-- files them for the Project's curators.
--
-- When a Project conversation's answer is not grounded in the Project's
-- knowledge (Ember says so in its response envelope, or the Project search
-- found nothing relevant and Ember gave no coverage declaration), the app
-- calls record_automatic_knowledge_gap(). Similar questions are grouped into
-- one open gap with an occurrence count, so ten people asking the same thing
-- produce one gap, not ten. The person who asked sees that a gap was sent
-- and can add details or withdraw it.

-- Grouping counts -----------------------------------------------------------------
-- occurrence_count is how many times the question has come up: 1 for a new
-- gap (failure report or detection), +1 for each grouped detection.
alter table project_knowledge_gaps
  add column occurrence_count integer not null default 1 check (occurrence_count >= 0),
  add column last_occurred_at timestamptz not null default now();

-- One row per detection, including the one that created an automatic gap.
create table project_knowledge_gap_occurrences (
  id uuid primary key default gen_random_uuid(),
  gap_id uuid not null references project_knowledge_gaps(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references chat_messages(id) on delete set null,
  question text not null,
  missing_topic text,
  -- declared: Ember said the answer was partial or not in Project knowledge.
  -- no_project_evidence: the Project search found nothing relevant and
  -- Ember made no coverage declaration.
  signal text not null check (signal in ('declared', 'no_project_evidence')),
  -- Added by the person who asked, after the fact ("Add details").
  note text,
  suggested_source text,
  created_at timestamptz not null default now(),
  unique (message_id)
);

create index project_knowledge_gap_occurrences_gap_idx on project_knowledge_gap_occurrences(gap_id);
create index project_knowledge_gap_occurrences_project_idx on project_knowledge_gap_occurrences(project_id);

-- The person who asked may only add a note or a suggested source. Runs with
-- the caller's role (not SECURITY DEFINER), so it binds API callers while
-- withdraw_knowledge_gap_occurrence(), running as the owner, can still move
-- detections onto a re-created gap.
create or replace function project_knowledge_gap_occurrences_before_update()
returns trigger
language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.gap_id is distinct from old.gap_id
    or new.project_id is distinct from old.project_id
    or new.user_id is distinct from old.user_id
    or new.conversation_id is distinct from old.conversation_id
    or new.message_id is distinct from old.message_id
    or new.question is distinct from old.question
    or new.missing_topic is distinct from old.missing_topic
    or new.signal is distinct from old.signal
    or new.created_at is distinct from old.created_at
  then
    raise exception 'project_knowledge_gap_occurrences: only the note and suggested source can be changed';
  end if;
  return new;
end;
$$;

create trigger project_knowledge_gap_occurrences_before_update before update on project_knowledge_gap_occurrences
  for each row execute function project_knowledge_gap_occurrences_before_update();

alter table project_knowledge_gap_occurrences enable row level security;

-- Same visibility as the gaps themselves: the person who asked, and the
-- Project's owner/curators and platform admins. Inserts and deletes only
-- happen through the functions below.
create policy "project_knowledge_gap_occurrences_select_own_or_curator" on project_knowledge_gap_occurrences
  for select using (user_id = auth.uid() or can_curate_project(project_id, auth.uid()));

create policy "project_knowledge_gap_occurrences_update_own" on project_knowledge_gap_occurrences
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Similarity for grouping -----------------------------------------------------------
-- Word overlap (Jaccard) over lower-cased words, ignoring common question
-- words, with a light suffix trim (configure/configured/configuring and
-- trunk/trunks/trunking match) and words of three or more letters kept.
-- Deterministic and needs no AI call or extension; good enough to group
-- rephrasings of the same question.
create or replace function knowledge_gap_similarity(a text, b text)
returns numeric
language sql immutable set search_path = public as $$
  with stop(w) as (
    select unnest(array[
      'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'any', 'can', 'how', 'what', 'when', 'where',
      'which', 'who', 'why', 'does', 'did', 'with', 'this', 'that', 'from', 'our', 'your', 'have', 'has',
      'was', 'were', 'will', 'would', 'should', 'could', 'into', 'about', 'there', 'their', 'they', 'them',
      'its', 'tell', 'please', 'know', 'need', 'use', 'used', 'using', 'get'
    ])
  ),
  ta as (
    select distinct regexp_replace(w, '(ing|ed|es|e|s)$', '') as w
    from regexp_split_to_table(lower(coalesce(a, '')), '[^a-z0-9]+') as w
    where length(w) >= 3 and w not in (select w from stop)
  ),
  tb as (
    select distinct regexp_replace(w, '(ing|ed|es|e|s)$', '') as w
    from regexp_split_to_table(lower(coalesce(b, '')), '[^a-z0-9]+') as w
    where length(w) >= 3 and w not in (select w from stop)
  ),
  u as (select w from ta union select w from tb)
  select case
    when (select count(*) from u) = 0 then 0
    else (select count(*) from ta join tb using (w))::numeric / (select count(*) from u)
  end;
$$;

-- Record a detected gap ----------------------------------------------------------
-- Called by the app, in the asking user's session, right after an Ember
-- answer in a Project conversation. SECURITY DEFINER so it can group with
-- open gaps the caller cannot read (other members' reports) without ever
-- returning their content. Idempotent per answer.
create or replace function record_automatic_knowledge_gap(
  p_message_id uuid,
  p_question text,
  p_missing_topic text,
  p_signal text
)
returns table (gap_id uuid, occurrence_id uuid, is_new boolean, occurrence_count integer)
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_message chat_messages%rowtype;
  v_project_id uuid;
  v_question text := left(trim(coalesce(p_question, '')), 2000);
  v_topic text := nullif(left(trim(coalesce(p_missing_topic, '')), 300), '');
  v_text text;
  v_existing project_knowledge_gap_occurrences%rowtype;
  v_gap_id uuid;
  v_count integer;
  v_new boolean := false;
  v_occurrence_id uuid;
begin
  if v_uid is null then
    raise exception 'record_automatic_knowledge_gap: not signed in';
  end if;
  if p_signal not in ('declared', 'no_project_evidence') then
    raise exception 'record_automatic_knowledge_gap: unknown signal';
  end if;
  if v_question = '' then
    raise exception 'record_automatic_knowledge_gap: question is required';
  end if;

  select * into v_message from chat_messages where id = p_message_id and role = 'assistant';
  if not found then
    raise exception 'record_automatic_knowledge_gap: not an Ember answer';
  end if;

  -- Only the caller's own Project chat conversation (never feedback, never
  -- unbound), and only while they are a member.
  select c.project_id into v_project_id
  from conversations c
  where c.id = v_message.conversation_id and c.user_id = v_uid and c.project_id is not null and c.kind = 'chat';
  if v_project_id is null or not is_project_member(v_project_id, v_uid) then
    raise exception 'record_automatic_knowledge_gap: not a Project conversation of yours';
  end if;

  select * into v_existing from project_knowledge_gap_occurrences o where o.message_id = p_message_id;
  if found then
    select g.occurrence_count into v_count from project_knowledge_gaps g where g.id = v_existing.gap_id;
    return query select v_existing.gap_id, v_existing.id, false, coalesce(v_count, 0);
    return;
  end if;

  v_text := coalesce(v_topic, '') || ' ' || v_question;

  select g.id into v_gap_id
  from project_knowledge_gaps g
  where g.project_id = v_project_id
    and g.status in ('new', 'needs_source', 'wiki_needed')
    -- 0.65: rephrasings of one question scored 0.67-0.80 in testing; two
    -- different questions about the same system ("who owns the CCDRRMO radio
    -- network" vs "what protocol does it use") scored 0.60.
    and knowledge_gap_similarity(coalesce(g.missing_topic, '') || ' ' || g.question, v_text) >= 0.65
  order by knowledge_gap_similarity(coalesce(g.missing_topic, '') || ' ' || g.question, v_text) desc, g.created_at
  limit 1;

  if v_gap_id is not null then
    update project_knowledge_gaps g
    set occurrence_count = g.occurrence_count + 1, last_occurred_at = now()
    where g.id = v_gap_id
    returning g.occurrence_count into v_count;
  else
    insert into project_knowledge_gaps (
      project_id, origin, question, ember_answer, failure_kind, missing_topic,
      conversation_id, message_id, answer_provider, answer_model, reported_by
    ) values (
      v_project_id, 'automatic', v_question, left(v_message.content, 8000), 'could_not_answer', v_topic,
      v_message.conversation_id, v_message.id, v_message.provider, v_message.model, v_uid
    )
    returning id, project_knowledge_gaps.occurrence_count into v_gap_id, v_count;
    v_new := true;
  end if;

  insert into project_knowledge_gap_occurrences (gap_id, project_id, user_id, conversation_id, message_id, question, missing_topic, signal)
  values (v_gap_id, v_project_id, v_uid, v_message.conversation_id, v_message.id, v_question, v_topic, p_signal)
  returning id into v_occurrence_id;

  return query select v_gap_id, v_occurrence_id, v_new, v_count;
end;
$$;

revoke execute on function record_automatic_knowledge_gap(uuid, text, text, text) from public, anon;
grant execute on function record_automatic_knowledge_gap(uuid, text, text, text) to authenticated;

-- "Don't send" ------------------------------------------------------------------
-- The person who asked withdraws their detection within a day.
--   * A grouped detection (someone else's question started the gap): the
--     count drops by one.
--   * The detection that started an untriaged automatic gap: the asker's
--     question must not stay on it, so the gap is removed, or, if others
--     have since asked the same thing, re-created from the next person's
--     question with their detections moved onto it.
--   * The detection that started a gap a curator is already working on:
--     refused -- the curator's work is not discarded.
create or replace function withdraw_knowledge_gap_occurrence(p_occurrence_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_occurrence project_knowledge_gap_occurrences%rowtype;
  v_gap project_knowledge_gaps%rowtype;
  v_next project_knowledge_gap_occurrences%rowtype;
  v_next_message chat_messages%rowtype;
  v_new_gap_id uuid;
begin
  select * into v_occurrence from project_knowledge_gap_occurrences
  where id = p_occurrence_id and user_id = auth.uid() and created_at > now() - interval '1 day';
  if not found then
    raise exception 'withdraw_knowledge_gap_occurrence: nothing to withdraw';
  end if;

  select * into v_gap from project_knowledge_gaps where id = v_occurrence.gap_id;

  if v_gap.origin <> 'automatic' or v_gap.message_id is distinct from v_occurrence.message_id then
    delete from project_knowledge_gap_occurrences where id = v_occurrence.id;
    update project_knowledge_gaps set occurrence_count = greatest(occurrence_count - 1, 0) where id = v_gap.id;
    return;
  end if;

  if v_gap.status <> 'new' then
    raise exception 'withdraw_knowledge_gap_occurrence: a curator is already working on this gap';
  end if;

  delete from project_knowledge_gap_occurrences where id = v_occurrence.id;

  select * into v_next from project_knowledge_gap_occurrences where gap_id = v_gap.id order by created_at limit 1;
  if found then
    select * into v_next_message from chat_messages where id = v_next.message_id;
    insert into project_knowledge_gaps (
      project_id, origin, question, ember_answer, failure_kind, missing_topic,
      conversation_id, message_id, answer_provider, answer_model, reported_by
    ) values (
      v_gap.project_id, 'automatic', v_next.question, left(v_next_message.content, 8000), 'could_not_answer', v_next.missing_topic,
      v_next.conversation_id, v_next.message_id, v_next_message.provider, v_next_message.model, v_next.user_id
    )
    returning id into v_new_gap_id;
    update project_knowledge_gap_occurrences set gap_id = v_new_gap_id where gap_id = v_gap.id;
    update project_knowledge_gaps
    set occurrence_count = (select count(*) from project_knowledge_gap_occurrences where gap_id = v_new_gap_id)
    where id = v_new_gap_id;
  end if;

  delete from project_knowledge_gaps where id = v_gap.id;
end;
$$;

revoke execute on function withdraw_knowledge_gap_occurrence(uuid) from public, anon;
grant execute on function withdraw_knowledge_gap_occurrence(uuid) to authenticated;

-- External MCP read-only guarantee: an OAuth client token can never write
-- the new table (20261005100001_external_mcp_access.sql). Guarded so this
-- migration also applies to a database where that migration has not run
-- yet. When it does run, its own call covers every RLS table that exists by
-- then, this one included.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
