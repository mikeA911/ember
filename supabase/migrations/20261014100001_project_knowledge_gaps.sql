-- Ember Readiness, Stage 3 (docs/dev-request-ember-readiness-and-knowledge-
-- gaps.md): failure reports and the curator's knowledge-gap queue.
--
-- A Project member reports that Ember got something wrong (from an Ember
-- answer, or typed into the Project's readiness section). The report lands
-- in the Project's knowledge-gap queue for its curators, who triage it,
-- resolve it by linking the source or Wiki article that now covers it,
-- record whether Ember now answers it, and can turn it into a draft test
-- question. Stage 4 adds automatically detected gaps (origin =
-- 'automatic') to the same table.
--
-- Failure reports are Project-scoped and never reach the platform-owner
-- feedback board unless a curator converts one (feedback_report_id).

create table project_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  origin text not null default 'failure_report' check (origin in ('failure_report', 'automatic')),

  -- What the reporter saw. Fixed once reported (see the update trigger).
  question text not null check (length(trim(question)) > 0),
  ember_answer text,
  failure_kind text check (failure_kind in ('wrong', 'incomplete', 'outdated', 'wrong_source', 'could_not_answer')),
  details text,
  correct_answer text,
  suggested_source text,
  -- Stage 4: Ember's own description of what is missing.
  missing_topic text,
  conversation_id uuid references conversations(id) on delete set null,
  message_id uuid references chat_messages(id) on delete set null,
  answer_provider text,
  answer_model text,
  -- The answer's verified citations at report time: [{label, sourceType, sourceId}].
  cited_sources jsonb,
  reported_by uuid references profiles(id) on delete set null,

  -- Curator workflow.
  status text not null default 'new'
    check (status in ('new', 'needs_source', 'wiki_needed', 'resolved', 'out_of_scope', 'product_issue', 'duplicate')),
  triage_note text,
  duplicate_of uuid references project_knowledge_gaps(id) on delete set null,
  resolving_source_id uuid references knowledge_sources(id) on delete set null,
  resolving_article_id uuid references wiki_articles(id) on delete set null,
  resolution_note text,
  -- Whether Ember answered the question correctly when re-asked after the
  -- fix, as recorded by the curator.
  verified_answers boolean,
  verified_by uuid references profiles(id) on delete set null,
  verified_at timestamptz,
  eval_case_id uuid references eval_cases(id) on delete set null,
  feedback_report_id uuid references feedback_reports(id) on delete set null,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index project_knowledge_gaps_project_status_idx on project_knowledge_gaps(project_id, status);
create index project_knowledge_gaps_reported_by_idx on project_knowledge_gaps(reported_by);

create trigger project_knowledge_gaps_set_updated_at before update on project_knowledge_gaps
  for each row execute function set_updated_at();

-- Insert guard: a new report always starts untriaged, and a report tied to
-- a conversation must come from the reporter's own conversation bound to
-- this Project.
create or replace function project_knowledge_gaps_before_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.status := 'new';
  new.triage_note := null;
  new.duplicate_of := null;
  new.resolving_source_id := null;
  new.resolving_article_id := null;
  new.resolution_note := null;
  new.verified_answers := null;
  new.verified_by := null;
  new.verified_at := null;
  new.eval_case_id := null;
  new.feedback_report_id := null;
  new.resolved_by := null;
  new.resolved_at := null;
  new.created_at := now();

  if new.conversation_id is not null and not exists (
    select 1 from conversations c
    where c.id = new.conversation_id and c.project_id = new.project_id and c.user_id = new.reported_by
  ) then
    raise exception 'project_knowledge_gaps: the conversation must be the reporter''s own, bound to this Project';
  end if;
  if new.message_id is not null and not exists (
    select 1 from chat_messages m where m.id = new.message_id and m.conversation_id = new.conversation_id and m.role = 'assistant'
  ) then
    raise exception 'project_knowledge_gaps: the message must be an Ember answer in that conversation';
  end if;
  return new;
end;
$$;

create trigger project_knowledge_gaps_before_insert before insert on project_knowledge_gaps
  for each row execute function project_knowledge_gaps_before_insert();

-- Update guard: curators work the queue but never rewrite what was reported.
create or replace function project_knowledge_gaps_before_update()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id
    or new.origin is distinct from old.origin
    or new.question is distinct from old.question
    or new.ember_answer is distinct from old.ember_answer
    or new.failure_kind is distinct from old.failure_kind
    or new.details is distinct from old.details
    or new.correct_answer is distinct from old.correct_answer
    or new.suggested_source is distinct from old.suggested_source
    or new.missing_topic is distinct from old.missing_topic
    or new.conversation_id is distinct from old.conversation_id
    or new.message_id is distinct from old.message_id
    or new.answer_provider is distinct from old.answer_provider
    or new.answer_model is distinct from old.answer_model
    or new.cited_sources is distinct from old.cited_sources
    or new.reported_by is distinct from old.reported_by
    or new.created_at is distinct from old.created_at
  then
    raise exception 'project_knowledge_gaps: what was reported cannot be changed';
  end if;
  return new;
end;
$$;

create trigger project_knowledge_gaps_before_update before update on project_knowledge_gaps
  for each row execute function project_knowledge_gaps_before_update();

alter table project_knowledge_gaps enable row level security;

-- The reporter sees their own reports (and how they were resolved); the
-- Project's owner/curators and platform admins see the whole queue. Other
-- members see only the open count, through project_ember_readiness_signals.
create policy "project_knowledge_gaps_select_reporter_or_curator" on project_knowledge_gaps
  for select using (reported_by = auth.uid() or can_curate_project(project_id, auth.uid()));

create policy "project_knowledge_gaps_insert_member" on project_knowledge_gaps
  for insert with check (reported_by = auth.uid() and is_project_member(project_id, auth.uid()));

create policy "project_knowledge_gaps_update_curator" on project_knowledge_gaps
  for update using (can_curate_project(project_id, auth.uid())) with check (can_curate_project(project_id, auth.uid()));

-- No delete policy: a gap is closed (resolved, out of scope, duplicate,
-- product issue), never removed.

-- Readiness signals gain the open-gap count ---------------------------------------
-- Open = new, needs_source or wiki_needed. The return type changes, so the
-- function is dropped and recreated (create or replace cannot change it).
drop function if exists project_ember_readiness_signals(uuid[]);

create function project_ember_readiness_signals(pids uuid[])
returns table (
  project_id uuid,
  measured_run_id uuid,
  measured_dataset_name text,
  measured_at timestamptz,
  measured_questions integer,
  measured_passed integer,
  source_count integer,
  searchable_source_count integer,
  wiki_article_count integer,
  last_source_added_at timestamptz,
  open_gap_count integer
)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select distinct p.id from unnest(pids) as p(id) where is_project_member(p.id, auth.uid())
  ),
  project_kbs as (
    select kb.project_id, kb.id as kb_id from knowledge_bases kb join allowed a on a.id = kb.project_id
    union
    select pkb.project_id, pkb.knowledge_base_id from project_knowledge_bases pkb join allowed a on a.id = pkb.project_id
  ),
  sources as (
    select pk.project_id, ks.id, ks.created_at, ks.current_version_id
    from project_kbs pk
    join knowledge_sources ks on ks.knowledge_base_id = pk.kb_id
    where ks.lifecycle_status = 'active'
  ),
  articles as (
    select pwa.project_id, w.id
    from project_wiki_articles pwa
    join allowed a on a.id = pwa.project_id
    join wiki_articles w on w.id = pwa.wiki_article_id
    where w.status = 'approved'
    union
    select pk.project_id, w.id
    from project_kbs pk
    join wiki_articles w on w.knowledge_base_id = pk.kb_id
    where w.status = 'approved'
  )
  select
    a.id,
    m.run_id,
    m.dataset_name,
    m.completed_at,
    m.question_count,
    m.passed_count,
    (select count(distinct s.id) from sources s where s.project_id = a.id)::integer,
    (select count(distinct s.id) from sources s
      where s.project_id = a.id
        and exists (select 1 from document_chunks dc where dc.document_id = s.current_version_id and dc.review_status = 'approved'))::integer,
    (select count(distinct ar.id) from articles ar where ar.project_id = a.id)::integer,
    (select max(s.created_at) from sources s where s.project_id = a.id),
    (select count(*) from project_knowledge_gaps g
      where g.project_id = a.id and g.status in ('new', 'needs_source', 'wiki_needed'))::integer
  from allowed a
  left join lateral project_measured_score(a.id) m on true;
$$;

revoke execute on function project_ember_readiness_signals(uuid[]) from public, anon;
grant execute on function project_ember_readiness_signals(uuid[]) to authenticated;

-- External MCP read-only guarantee: an OAuth client token can never write
-- the new table (20261005100001_external_mcp_access.sql).
select apply_oauth_read_only_policies();
