-- Ember Readiness follow-up: AI-based (embedding) grouping of knowledge gaps
-- (docs/dev-request-ember-readiness-and-knowledge-gaps.md).
--
-- Stage 4 grouped repeated questions by word overlap. Gaps now carry an
-- embedding of their missing topic and question, made with the platform's
-- default embedding model, and a new detection joins the open gap whose
-- embedding is most similar (cosine similarity at or above the threshold the
-- app passes in). Word overlap remains the fallback: for a detection the app
-- could not embed (no embedding model, AI policy gate, provider error), and
-- for gaps without a comparable embedding (made before this migration, or by
-- a different embedding model).

create extension if not exists vector;

-- embedding_model is "<model>/<dimensions>": vectors are only ever compared
-- with vectors from the same model and size.
alter table project_knowledge_gaps
  add column embedding vector,
  add column embedding_model text;

alter table project_knowledge_gap_occurrences
  add column embedding vector,
  add column embedding_model text;

-- The asker may still only change note and suggested_source on their
-- detection; the embedding columns join the frozen list.
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
    or new.embedding is distinct from old.embedding
    or new.embedding_model is distinct from old.embedding_model
  then
    raise exception 'project_knowledge_gap_occurrences: only the note and suggested source can be changed';
  end if;
  return new;
end;
$$;

-- record_automatic_knowledge_gap gains the embedding; its argument list
-- changes, so the old one is dropped first.
drop function if exists record_automatic_knowledge_gap(uuid, text, text, text);

create function record_automatic_knowledge_gap(
  p_message_id uuid,
  p_question text,
  p_missing_topic text,
  p_signal text,
  p_embedding vector default null,
  p_embedding_model text default null,
  p_min_similarity double precision default 0.82
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
  v_embedding vector := case when p_embedding is not null and p_embedding_model is not null then p_embedding end;
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
  if p_min_similarity is null or p_min_similarity < 0.5 or p_min_similarity > 1 then
    raise exception 'record_automatic_knowledge_gap: similarity threshold must be between 0.5 and 1';
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

  -- 1. Semantic match: the most similar open gap embedded by the same model.
  if v_embedding is not null then
    select g.id into v_gap_id
    from project_knowledge_gaps g
    where g.project_id = v_project_id
      and g.status in ('new', 'needs_source', 'wiki_needed')
      and g.embedding is not null
      and g.embedding_model = p_embedding_model
      and 1 - (g.embedding <=> v_embedding) >= p_min_similarity
    order by g.embedding <=> v_embedding, g.created_at
    limit 1;
  end if;

  -- 2. Word-overlap fallback, only against gaps the semantic match could not
  --    compare (or all open gaps when this detection has no embedding).
  if v_gap_id is null then
    v_text := coalesce(v_topic, '') || ' ' || v_question;
    select g.id into v_gap_id
    from project_knowledge_gaps g
    where g.project_id = v_project_id
      and g.status in ('new', 'needs_source', 'wiki_needed')
      and (v_embedding is null or g.embedding is null or g.embedding_model is distinct from p_embedding_model)
      and knowledge_gap_similarity(coalesce(g.missing_topic, '') || ' ' || g.question, v_text) >= 0.65
    order by knowledge_gap_similarity(coalesce(g.missing_topic, '') || ' ' || g.question, v_text) desc, g.created_at
    limit 1;
  end if;

  if v_gap_id is not null then
    update project_knowledge_gaps g
    set occurrence_count = g.occurrence_count + 1, last_occurred_at = now()
    where g.id = v_gap_id
    returning g.occurrence_count into v_count;
  else
    insert into project_knowledge_gaps (
      project_id, origin, question, ember_answer, failure_kind, missing_topic,
      conversation_id, message_id, answer_provider, answer_model, reported_by, embedding, embedding_model
    ) values (
      v_project_id, 'automatic', v_question, left(v_message.content, 8000), 'could_not_answer', v_topic,
      v_message.conversation_id, v_message.id, v_message.provider, v_message.model, v_uid,
      v_embedding, case when v_embedding is not null then p_embedding_model end
    )
    returning id, project_knowledge_gaps.occurrence_count into v_gap_id, v_count;
    v_new := true;
  end if;

  insert into project_knowledge_gap_occurrences (gap_id, project_id, user_id, conversation_id, message_id, question, missing_topic, signal, embedding, embedding_model)
  values (
    v_gap_id, v_project_id, v_uid, v_message.conversation_id, v_message.id, v_question, v_topic, p_signal,
    v_embedding, case when v_embedding is not null then p_embedding_model end
  )
  returning id into v_occurrence_id;

  return query select v_gap_id, v_occurrence_id, v_new, v_count;
end;
$$;

revoke execute on function record_automatic_knowledge_gap(uuid, text, text, text, vector, text, double precision) from public, anon;
grant execute on function record_automatic_knowledge_gap(uuid, text, text, text, vector, text, double precision) to authenticated;

-- "Don't send": unchanged rules (20261015100001), except that a gap
-- re-created from the next person's question takes that detection's
-- embedding, so it keeps grouping semantically.
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
      conversation_id, message_id, answer_provider, answer_model, reported_by, embedding, embedding_model
    ) values (
      v_gap.project_id, 'automatic', v_next.question, left(v_next_message.content, 8000), 'could_not_answer', v_next.missing_topic,
      v_next.conversation_id, v_next.message_id, v_next_message.provider, v_next_message.model, v_next.user_id,
      v_next.embedding, v_next.embedding_model
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
