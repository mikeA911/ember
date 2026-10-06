-- Solution conformance and acceptance evaluation, Stage 4: re-verification
-- triggers (docs/dev-request-solution-conformance-and-acceptance-
-- evaluation.md).
--
-- In management and maintenance a decision is a point-in-time statement.
-- These events mark the affected requirements "re-verification due" while
-- keeping every past record, baseline and decision readable:
--   * a component, firmware or configuration change recorded on the Project
--     (or any other change the team records), naming the requirements it
--     affects;
--   * a new version of a knowledge source a requirement cites (automatic);
--   * an operational measure recorded as a fail -- outside its threshold
--     (automatic);
--   * a review interval passing since the requirement was last verified.
-- An event stays open for a requirement until every one of its verification
-- methods has a new result (other than "not run") recorded after the event,
-- or a curator resolves it with a note (e.g. "reviewed, no impact"). While
-- any requirement in a baseline is due, a production-change decision over it
-- can't be approved.
--
-- Safe to re-run.

-- How often a requirement must be re-verified, if at all. Operational, so
-- it stays editable after baselining (not in the frozen-field list).
alter table solution_requirements
  add column if not exists review_interval_months integer check (review_interval_months between 1 and 120);

create table if not exists solution_reverification_events (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('component_change', 'source_revision', 'threshold_breach', 'other')),
  summary text not null check (length(trim(summary)) > 0),
  detail text,
  -- e.g. "K-Dispatch 4.2.1 -> 4.3.0"
  change_reference text,
  project_object_id uuid references project_objects(id) on delete set null,
  workstream_id uuid references project_workstreams(id) on delete set null,
  knowledge_source_id uuid references knowledge_sources(id) on delete set null,
  document_version_id uuid references documents(id) on delete set null,
  record_id uuid references solution_verification_records(id) on delete set null,
  -- Null for the automatic kinds.
  recorded_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists solution_reverification_events_project_idx on solution_reverification_events(project_id, created_at desc);

create table if not exists solution_reverification_event_requirements (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references solution_reverification_events(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  requirement_id uuid not null references solution_requirements(id) on delete cascade,
  resolved_by uuid references profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  unique (event_id, requirement_id),
  check (resolved_at is null or length(trim(coalesce(resolution_note, ''))) > 0)
);

create index if not exists solution_reverification_event_requirements_requirement_idx on solution_reverification_event_requirements(requirement_id);

-- The one definition of "re-verification due" -------------------------------------
-- Open events: unresolved, and some current method (or the requirement has
-- none) has no result other than "not run" recorded after the event.
create or replace function solution_requirement_open_events(p_requirement_id uuid)
returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct e.id), '{}'::uuid[])
  from solution_reverification_event_requirements l
  join solution_reverification_events e on e.id = l.event_id
  where l.requirement_id = p_requirement_id and l.resolved_at is null
    and (
      not exists (select 1 from solution_verification_methods m where m.requirement_id = p_requirement_id)
      or exists (
        select 1 from solution_verification_methods m
        where m.requirement_id = p_requirement_id
          and not exists (
            select 1 from solution_verification_records r
            where r.method_id = m.id and r.result <> 'not_run' and r.recorded_at > e.created_at
          )
      )
    );
$$;

-- Review due: a baselined requirement with a review interval whose least
-- recently verified method was last performed longer ago than that.
create or replace function solution_requirement_review_due(p_requirement_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select r.review_interval_months is not null and r.status = 'baselined'
      and (
        select min(x.latest) from (
          select max(rec.performed_on) as latest
          from solution_verification_methods m
          join solution_verification_records rec on rec.method_id = m.id and rec.result <> 'not_run'
          where m.requirement_id = r.id
          group by m.id
        ) x
      ) + make_interval(months => r.review_interval_months) < current_date
    from solution_requirements r where r.id = p_requirement_id
  ), false);
$$;

-- For the app: every open requirement in a Project that is due, and why.
create or replace function project_reverification_due(p_project_id uuid)
returns table (requirement_id uuid, open_event_ids uuid[], review_due boolean)
language sql stable security definer set search_path = public as $$
  select x.id, x.open_events, x.review_due
  from (
    select r.id, solution_requirement_open_events(r.id) as open_events, solution_requirement_review_due(r.id) as review_due
    from solution_requirements r
    where r.project_id = p_project_id and r.status in ('draft', 'baselined')
      and is_project_member(p_project_id, auth.uid())
  ) x
  where cardinality(x.open_events) > 0 or x.review_due;
$$;

-- Recording a change ------------------------------------------------------------------
-- The Project's owner, curators and consultants (and platform admins) record
-- a change and the open requirements of this Project it affects.
create or replace function record_solution_reverification_event(
  p_project_id uuid,
  p_kind text,
  p_summary text,
  p_requirement_ids uuid[],
  p_change_reference text default null,
  p_detail text default null,
  p_project_object_id uuid default null,
  p_workstream_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_ids uuid[] := array(select distinct a from unnest(coalesce(p_requirement_ids, '{}'::uuid[])) a where a is not null);
  v_id uuid;
begin
  if v_uid is null or not can_run_project_evals(p_project_id, v_uid) then
    raise exception 'record_solution_reverification_event: only this Project''s owner, curators and consultants can record a change';
  end if;
  if p_kind is null or p_kind not in ('component_change', 'other') then
    raise exception 'record_solution_reverification_event: choose the kind of change';
  end if;
  if length(trim(coalesce(p_summary, ''))) = 0 then
    raise exception 'record_solution_reverification_event: describe the change';
  end if;
  if cardinality(v_ids) = 0 then
    raise exception 'record_solution_reverification_event: choose at least one affected requirement';
  end if;
  if exists (
    select 1 from unnest(v_ids) a
    where not exists (select 1 from solution_requirements r where r.id = a and r.project_id = p_project_id and r.status in ('draft', 'baselined'))
  ) then
    raise exception 'record_solution_reverification_event: affected requirements must be open requirements of this Project';
  end if;
  if p_project_object_id is not null and not exists (select 1 from project_objects o where o.id = p_project_object_id and o.project_id = p_project_id) then
    raise exception 'record_solution_reverification_event: the component must be in this Project';
  end if;
  if p_workstream_id is not null and not exists (select 1 from project_workstreams w where w.id = p_workstream_id and w.project_id = p_project_id) then
    raise exception 'record_solution_reverification_event: the workstream must be in this Project';
  end if;

  insert into solution_reverification_events (project_id, kind, summary, detail, change_reference, project_object_id, workstream_id, recorded_by)
  values (p_project_id, p_kind, trim(p_summary), nullif(trim(p_detail), ''), nullif(trim(p_change_reference), ''), p_project_object_id, p_workstream_id, v_uid)
  returning id into v_id;

  insert into solution_reverification_event_requirements (event_id, project_id, requirement_id)
  select v_id, p_project_id, a from unnest(v_ids) a;
  return v_id;
end;
$$;

-- A curator closes an event for one requirement without re-verifying it,
-- with a note (e.g. "reviewed the revised clause -- no impact").
create or replace function resolve_solution_reverification(p_link_id uuid, p_note text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_link solution_reverification_event_requirements%rowtype;
begin
  select * into v_link from solution_reverification_event_requirements where id = p_link_id for update;
  if not found or v_uid is null or not can_curate_project(v_link.project_id, v_uid) then
    raise exception 'resolve_solution_reverification: only this Project''s owner and curators can resolve it';
  end if;
  if v_link.resolved_at is not null then
    raise exception 'resolve_solution_reverification: this has already been resolved';
  end if;
  if length(trim(coalesce(p_note, ''))) = 0 then
    raise exception 'resolve_solution_reverification: say why no re-verification is needed';
  end if;
  update solution_reverification_event_requirements
  set resolved_by = v_uid, resolved_at = now(), resolution_note = trim(p_note)
  where id = p_link_id;
end;
$$;

-- Automatic: a new version of a cited knowledge source --------------------------------
-- Flags each open requirement citing an earlier version, one event per
-- Project. Never blocks the upload: a failure here is only a warning.
create or replace function solution_flag_source_revision()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project record;
  v_event_id uuid;
begin
  begin
    for v_project in
      select distinct s.project_id
      from solution_requirement_sources s
      join solution_requirements r on r.id = s.requirement_id and r.status in ('draft', 'baselined')
      where s.knowledge_source_id = new.id and s.document_version_id is distinct from new.current_version_id
    loop
      insert into solution_reverification_events (project_id, kind, summary, knowledge_source_id, document_version_id)
      values (v_project.project_id, 'source_revision', 'New version of a cited source: ' || coalesce(new.title, 'untitled'), new.id, new.current_version_id)
      returning id into v_event_id;

      insert into solution_reverification_event_requirements (event_id, project_id, requirement_id)
      select distinct v_event_id, v_project.project_id, s.requirement_id
      from solution_requirement_sources s
      join solution_requirements r on r.id = s.requirement_id and r.status in ('draft', 'baselined')
      where s.knowledge_source_id = new.id and s.project_id = v_project.project_id
        and s.document_version_id is distinct from new.current_version_id;
    end loop;
  exception when others then
    raise warning 'solution_flag_source_revision: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists knowledge_sources_flag_solution_revision on knowledge_sources;
create trigger knowledge_sources_flag_solution_revision
  after update of current_version_id on knowledge_sources
  for each row
  when (old.current_version_id is not null and new.current_version_id is distinct from old.current_version_id)
  execute function solution_flag_source_revision();

-- Automatic: an operational measure recorded as a fail ---------------------------------
create or replace function solution_flag_threshold_breach()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid;
begin
  if new.method_kind = 'operational_measure' and new.result = 'fail' then
    insert into solution_reverification_events (project_id, kind, summary, detail, record_id, recorded_by)
    values (
      new.project_id, 'threshold_breach', 'Operational measure outside its threshold',
      concat_ws(' · ', 'Measured: ' || new.measured_value, 'Threshold: ' || new.threshold, 'Window: ' || new.measure_window),
      new.id, new.recorded_by
    )
    returning id into v_event_id;
    insert into solution_reverification_event_requirements (event_id, project_id, requirement_id)
    values (v_event_id, new.project_id, new.requirement_id);
  end if;
  return null;
end;
$$;

drop trigger if exists solution_verification_records_flag_threshold on solution_verification_records;
create trigger solution_verification_records_flag_threshold
  after insert on solution_verification_records
  for each row execute function solution_flag_threshold_breach();

-- Production changes wait for re-verification ----------------------------------------
-- decide_solution_conformance_decision() from 20261020100001, unchanged except
-- for the production-change check before the verdict is recorded.
create or replace function decide_solution_conformance_decision(
  p_decision_id uuid,
  p_approve boolean,
  p_note text default null,
  p_conditions text default null
)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_decision solution_conformance_decisions%rowtype;
  v_is_self boolean;
  v_approvals integer;
  v_needed integer;
begin
  select * into v_decision from solution_conformance_decisions where id = p_decision_id for update;
  if not found or v_uid is null or not holds_project_authority(v_decision.project_id, v_uid, v_decision.approval_type) then
    raise exception 'decide_solution_conformance_decision: only a holder of the required approval authority can decide this';
  end if;
  if v_decision.status <> 'pending' then
    raise exception 'decide_solution_conformance_decision: this decision has already been made';
  end if;
  if exists (select 1 from solution_conformance_decision_approvals a where a.decision_id = p_decision_id and a.approver_id = v_uid) then
    raise exception 'decide_solution_conformance_decision: you have already given your verdict';
  end if;

  -- Self-approval: the requester, or anyone who recorded evidence in effect
  -- for this baseline's requirements.
  v_is_self := v_decision.requested_by = v_uid or exists (
    select 1
    from solution_evaluation_baseline_items i
    join solution_verification_records r on r.requirement_id = i.requirement_id
    where i.baseline_id = v_decision.baseline_id and r.recorded_by = v_uid
      and not exists (select 1 from solution_verification_records s where s.supersedes_id = r.id)
  );
  if v_is_self and not project_self_approval_allowed(v_decision.project_id, v_uid, v_decision.approval_type) then
    raise exception 'decide_solution_conformance_decision: you requested this decision or recorded its evidence, and this Project does not allow self-approval';
  end if;

  -- Stage 4: a production change can't be approved while any requirement
  -- in the baseline needs re-verification.
  if p_approve and v_decision.approval_type = 'production_change' and exists (
    select 1 from solution_evaluation_baseline_items i
    where i.baseline_id = v_decision.baseline_id
      and (cardinality(solution_requirement_open_events(i.requirement_id)) > 0 or solution_requirement_review_due(i.requirement_id))
  ) then
    raise exception 'decide_solution_conformance_decision: requirements in this baseline need re-verification before a production change can be approved';
  end if;

  insert into solution_conformance_decision_approvals (decision_id, project_id, approver_id, verdict, note, conditions)
  values (p_decision_id, v_decision.project_id, v_uid, case when p_approve then 'approve' else 'reject' end, nullif(trim(p_note), ''), nullif(trim(p_conditions), ''));

  if not p_approve then
    update solution_conformance_decisions set status = 'rejected', decided_at = now(), snapshot = solution_baseline_snapshot(v_decision.baseline_id)
    where id = p_decision_id;
    return 'rejected';
  end if;

  select count(*) into v_approvals from solution_conformance_decision_approvals a where a.decision_id = p_decision_id and a.verdict = 'approve';
  if v_decision.approval_mode = 'all_assigned' then
    select count(distinct a.user_id) into v_needed
    from project_authority_assignments a
    where a.project_id = v_decision.project_id and holds_project_authority(v_decision.project_id, a.user_id, v_decision.approval_type);
    v_needed := greatest(v_needed, v_decision.required_approvals);
  else
    v_needed := v_decision.required_approvals;
  end if;

  if v_approvals >= v_needed then
    update solution_conformance_decisions set status = 'approved', decided_at = now(), snapshot = solution_baseline_snapshot(v_decision.baseline_id)
    where id = p_decision_id;
    return 'approved';
  end if;
  return 'pending';
end;
$$;


-- Grants ------------------------------------------------------------------------------
-- The per-requirement helpers are internal (used by the functions above);
-- the app reads project_reverification_due(), which checks membership.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'solution_requirement_open_events(uuid)',
    'solution_requirement_review_due(uuid)',
    'solution_flag_source_revision()',
    'solution_flag_threshold_breach()'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
  foreach fn in array array[
    'project_reverification_due(uuid)',
    'record_solution_reverification_event(uuid, text, text, uuid[], text, text, uuid, uuid)',
    'resolve_solution_reverification(uuid, text)',
    'decide_solution_conformance_decision(uuid, boolean, text, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- RLS ---------------------------------------------------------------------------------
-- Members read the history; the functions above are the only writers.
alter table solution_reverification_events enable row level security;
alter table solution_reverification_event_requirements enable row level security;

drop policy if exists "solution_reverification_events_select_member" on solution_reverification_events;
create policy "solution_reverification_events_select_member" on solution_reverification_events
  for select using (is_project_member(project_id, auth.uid()));
drop policy if exists "solution_reverification_event_requirements_select_member" on solution_reverification_event_requirements;
create policy "solution_reverification_event_requirements_select_member" on solution_reverification_event_requirements
  for select using (is_project_member(project_id, auth.uid()));

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
