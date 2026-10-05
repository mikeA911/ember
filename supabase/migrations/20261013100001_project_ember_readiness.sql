-- Ember Readiness, Stage 2 (docs/dev-request-ember-readiness-and-knowledge-
-- gaps.md): a per-Project readiness section showing how ready Ember is for
-- this Project. Two signals stay visibly separate:
--
--   * curator confidence -- a percentage, verdict and rationale a Project
--     curator or platform admin sets (project_ember_readiness, append-only
--     history; the newest row is current);
--   * measured score -- the latest completed admin eval run on the
--     Project's dataset, as "questions passed of questions asked".
--
-- Project members (viewers included) can read both, but most of them cannot
-- read eval_runs / eval_results (Stage 1 left those to staff), so the
-- measured score and knowledge coverage come from a SECURITY DEFINER
-- function that returns counts only, and only for Projects the caller is a
-- member of.

-- Measured score ---------------------------------------------------------------
-- A question passes when a human reviewer accepted it; with no review, when
-- nothing contradicts it and at least one signal supports it: the expected
-- evidence was retrieved (retrieval_hit is not false) and either the LLM
-- judge's outcome score is at least 0.7 or, with no judge, the expected
-- evidence was retrieved. Human review always wins over the automated
-- signals. Internal helper: no auth check, so not executable by clients.
create or replace function project_measured_score(pid uuid)
returns table (run_id uuid, dataset_name text, completed_at timestamptz, question_count integer, passed_count integer)
language sql stable security definer set search_path = public as $$
  with latest as (
    select r.id, d.name, r.completed_at
    from eval_runs r
    join eval_datasets d on d.id = r.dataset_id
    where d.project_id = pid and d.status <> 'archived' and r.status = 'completed'
    order by r.completed_at desc nulls last, r.created_at desc
    limit 1
  )
  select
    l.id,
    l.name,
    l.completed_at,
    count(res.id)::integer,
    (count(res.id) filter (
      where res.status = 'completed'
        and coalesce(
          res.human_accepted,
          (res.retrieval_hit is distinct from false)
            and (res.outcome_score >= 0.7 or (res.outcome_score is null and res.retrieval_hit is true))
        )
    ))::integer
  from latest l
  left join eval_results res on res.eval_run_id = l.id
  group by l.id, l.name, l.completed_at;
$$;

revoke execute on function project_measured_score(uuid) from public, anon, authenticated;

-- Readiness signals for the caller's own Projects ----------------------------------
-- One row per requested Project the caller is a member of (is_project_member
-- carries the platform-admin bypass). Counts only -- never source titles or
-- content -- so a restricted source still counts toward coverage without
-- being revealed.
create or replace function project_ember_readiness_signals(pids uuid[])
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
  last_source_added_at timestamptz
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
    (select max(s.created_at) from sources s where s.project_id = a.id)
  from allowed a
  left join lateral project_measured_score(a.id) m on true;
$$;

revoke execute on function project_ember_readiness_signals(uuid[]) from public, anon;
grant execute on function project_ember_readiness_signals(uuid[]) to authenticated;

-- Curator confidence and verdict (append-only history) ------------------------------
create table project_ember_readiness (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  confidence_percent integer not null check (confidence_percent between 0 and 100),
  verdict text not null check (verdict in ('ready', 'needs_more_sources')),
  rationale text not null check (length(trim(rationale)) > 0),
  -- When this judgement should be looked at again. After it, the section
  -- shows "review due".
  review_due_at timestamptz not null,
  -- The measured score (0..1) when this was set, so a later drop can mark
  -- the judgement for review. Filled by the trigger below, never by the
  -- client; null when no eval run existed yet.
  measured_score_at_set numeric,
  set_by uuid references profiles(id) on delete set null,
  set_at timestamptz not null default now()
);

create index project_ember_readiness_project_set_at_idx on project_ember_readiness(project_id, set_at desc);

create or replace function project_ember_readiness_before_insert()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_questions integer;
  v_passed integer;
begin
  new.set_at := now();
  if new.review_due_at <= now() then
    raise exception 'project_ember_readiness: review_due_at must be in the future';
  end if;
  if new.review_due_at > now() + interval '366 days' then
    raise exception 'project_ember_readiness: review_due_at must be within a year';
  end if;
  select question_count, passed_count into v_questions, v_passed from project_measured_score(new.project_id);
  new.measured_score_at_set := case when v_questions > 0 then v_passed::numeric / v_questions else null end;
  return new;
end;
$$;

create trigger project_ember_readiness_before_insert before insert on project_ember_readiness
  for each row execute function project_ember_readiness_before_insert();

alter table project_ember_readiness enable row level security;

create policy "project_ember_readiness_select_member" on project_ember_readiness
  for select using (is_project_member(project_id, auth.uid()));

-- Project owner/curator or platform admin (can_curate_project), recorded
-- as themselves. No update or delete policy: history is append-only; a
-- change is a new row.
create policy "project_ember_readiness_insert_curator" on project_ember_readiness
  for insert with check (can_curate_project(project_id, auth.uid()) and set_by = auth.uid());

-- External MCP read-only guarantee: an OAuth client token can never write
-- the new table (20261005100001_external_mcp_access.sql).
select apply_oauth_read_only_policies();
