-- Solution conformance and acceptance evaluation, Stage 2: verification
-- records (docs/dev-request-solution-conformance-and-acceptance-
-- evaluation.md).
--
-- A verification record is one execution of a requirement's verification
-- method against an identified solution state (environment, build or
-- component versions, configuration, date), with a result and the
-- workstream artifacts that evidence it. A narrative assertion alone is not
-- evidence: a pass or conditional pass needs at least one artifact.
--
-- Records are append-only. Nobody edits or deletes one; a correction is a
-- new record that supersedes it, and the history stays readable. Each record
-- copies the method and pass criteria it was judged against, so editing a
-- draft requirement's method later never rewrites what a result meant.
-- Writes go only through record_solution_verification(), which saves the
-- record and its evidence together.
--
-- Safe to re-run (if not exists / drop ... if exists throughout).

create table if not exists solution_verification_records (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  -- No cascade: a requirement with verification records can't be deleted
  -- (withdraw it instead). Deleting the Project still removes both.
  requirement_id uuid not null references solution_requirements(id),
  method_id uuid references solution_verification_methods(id) on delete set null,
  -- What the result was judged against, copied from the method.
  method_kind text not null
    check (method_kind in ('test', 'demonstration', 'inspection', 'analysis', 'vendor_evidence', 'operational_measure')),
  pass_criteria text not null,
  threshold text,
  measure_window text,
  result text not null check (result in ('pass', 'fail', 'conditional_pass', 'not_run', 'not_applicable')),
  conditions text,
  rationale text,
  -- The observed value, for an operational measure.
  measured_value text,
  -- The solution state it was run against.
  environment text not null check (environment in ('lab', 'factory', 'staging', 'site', 'production', 'vendor', 'other')),
  solution_reference text not null check (length(trim(solution_reference)) > 0),
  configuration_reference text,
  performed_on date not null,
  observations text,
  defect_reference text,
  supersedes_id uuid references solution_verification_records(id),
  recorded_by uuid references profiles(id) on delete set null,
  recorded_at timestamptz not null default now(),
  check (result <> 'conditional_pass' or length(trim(coalesce(conditions, ''))) > 0),
  check (result <> 'not_applicable' or length(trim(coalesce(rationale, ''))) > 0)
);

create index if not exists solution_verification_records_requirement_idx on solution_verification_records(requirement_id, performed_on desc);
create index if not exists solution_verification_records_project_idx on solution_verification_records(project_id);
-- A record is superseded at most once: corrections form a chain, not a fork.
create unique index if not exists solution_verification_records_supersedes_uniq on solution_verification_records(supersedes_id) where supersedes_id is not null;

create table if not exists solution_verification_evidence (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references solution_verification_records(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  workstream_artifact_id uuid references workstream_artifacts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (record_id, workstream_artifact_id)
);

create index if not exists solution_verification_evidence_record_idx on solution_verification_evidence(record_id);
create index if not exists solution_verification_evidence_artifact_idx on solution_verification_evidence(workstream_artifact_id);

-- Append-only, even for the definer function and the service role. The one
-- change allowed is the method link clearing when a draft's method is
-- removed (the copied method fields keep what it was judged against).
create or replace function solution_verification_records_before_update()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.method_id is null and old.method_id is not null
    and (to_jsonb(new) - 'method_id') = (to_jsonb(old) - 'method_id') then
    return new;
  end if;
  raise exception 'solution_verification_records: records are append-only -- record a correction that supersedes it';
end;
$$;

drop trigger if exists solution_verification_records_before_update on solution_verification_records;
create trigger solution_verification_records_before_update before update on solution_verification_records
  for each row execute function solution_verification_records_before_update();

-- Recording ------------------------------------------------------------------------
-- The Project's owner, curators and consultants (and platform admins) record
-- results -- the same bar as attaching workstream evidence
-- (can_run_project_evals); viewers read. Only an open requirement (draft or
-- baselined) takes new results; a withdrawn or superseded one keeps its
-- history. Every evidence artifact must be in one of this Project's
-- workstreams and visible to the recorder.
create or replace function record_solution_verification(
  p_requirement_id uuid,
  p_method_id uuid,
  p_result text,
  p_environment text,
  p_solution_reference text,
  p_performed_on date,
  p_artifact_ids uuid[],
  p_configuration_reference text default null,
  p_conditions text default null,
  p_rationale text default null,
  p_measured_value text default null,
  p_observations text default null,
  p_defect_reference text default null,
  p_supersedes_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_requirement solution_requirements%rowtype;
  v_method solution_verification_methods%rowtype;
  v_superseded solution_verification_records%rowtype;
  v_artifact_ids uuid[] := array(select distinct a from unnest(coalesce(p_artifact_ids, '{}'::uuid[])) a where a is not null);
  v_artifact_id uuid;
  v_record_id uuid;
begin
  if v_uid is null then
    raise exception 'record_solution_verification: not signed in';
  end if;

  select * into v_requirement from solution_requirements where id = p_requirement_id;
  if not found or not can_run_project_evals(v_requirement.project_id, v_uid) then
    raise exception 'record_solution_verification: only this Project''s owner, curators and consultants can record verification results';
  end if;
  if v_requirement.status not in ('draft', 'baselined') then
    raise exception 'record_solution_verification: this requirement is closed -- it no longer takes verification results';
  end if;

  select * into v_method from solution_verification_methods where id = p_method_id and requirement_id = p_requirement_id;
  if not found then
    raise exception 'record_solution_verification: choose one of this requirement''s verification methods';
  end if;

  if p_result is null or p_result not in ('pass', 'fail', 'conditional_pass', 'not_run', 'not_applicable') then
    raise exception 'record_solution_verification: unknown result';
  end if;
  if p_result = 'conditional_pass' and length(trim(coalesce(p_conditions, ''))) = 0 then
    raise exception 'record_solution_verification: a conditional pass needs its conditions';
  end if;
  if p_result = 'not_applicable' and length(trim(coalesce(p_rationale, ''))) = 0 then
    raise exception 'record_solution_verification: not applicable needs a rationale';
  end if;
  if p_environment is null or p_environment not in ('lab', 'factory', 'staging', 'site', 'production', 'vendor', 'other') then
    raise exception 'record_solution_verification: choose the environment it was run in';
  end if;
  if length(trim(coalesce(p_solution_reference, ''))) = 0 then
    raise exception 'record_solution_verification: identify the solution state -- build or component versions';
  end if;
  if p_performed_on is null or p_performed_on > current_date + 1 then
    raise exception 'record_solution_verification: the date it was performed can''t be in the future';
  end if;
  if p_result in ('pass', 'conditional_pass') and cardinality(v_artifact_ids) = 0 then
    raise exception 'record_solution_verification: a pass needs at least one evidence artifact -- a narrative assertion alone is not evidence';
  end if;
  if v_method.method = 'operational_measure' and p_result in ('pass', 'fail', 'conditional_pass')
    and length(trim(coalesce(p_measured_value, ''))) = 0 then
    raise exception 'record_solution_verification: an operational measure needs the measured value';
  end if;

  if p_supersedes_id is not null then
    select * into v_superseded from solution_verification_records where id = p_supersedes_id;
    if not found or v_superseded.requirement_id <> p_requirement_id then
      raise exception 'record_solution_verification: a correction must supersede a record of the same requirement';
    end if;
    if exists (select 1 from solution_verification_records r where r.supersedes_id = p_supersedes_id) then
      raise exception 'record_solution_verification: that record has already been corrected';
    end if;
  end if;

  foreach v_artifact_id in array v_artifact_ids loop
    if not exists (
      select 1 from workstream_artifacts a
      join project_workstreams w on w.id = a.workstream_id
      where a.id = v_artifact_id
        and w.project_id = v_requirement.project_id
        and has_evidence_access('workstream_artifact', a.id, v_uid)
    ) then
      raise exception 'record_solution_verification: evidence must be an artifact in one of this Project''s workstreams that you can see';
    end if;
  end loop;

  insert into solution_verification_records (
    project_id, requirement_id, method_id, method_kind, pass_criteria, threshold, measure_window,
    result, conditions, rationale, measured_value, environment, solution_reference, configuration_reference,
    performed_on, observations, defect_reference, supersedes_id, recorded_by
  ) values (
    v_requirement.project_id, p_requirement_id, v_method.id, v_method.method, v_method.pass_criteria, v_method.threshold, v_method.measure_window,
    p_result, nullif(trim(p_conditions), ''), nullif(trim(p_rationale), ''), nullif(trim(p_measured_value), ''),
    p_environment, trim(p_solution_reference), nullif(trim(p_configuration_reference), ''),
    p_performed_on, nullif(trim(p_observations), ''), nullif(trim(p_defect_reference), ''), p_supersedes_id, v_uid
  )
  returning id into v_record_id;

  insert into solution_verification_evidence (record_id, project_id, workstream_artifact_id)
  select v_record_id, v_requirement.project_id, a from unnest(v_artifact_ids) a;

  return v_record_id;
end;
$$;

revoke execute on function record_solution_verification(uuid, uuid, text, text, text, date, uuid[], text, text, text, text, text, text, uuid) from public, anon;
grant execute on function record_solution_verification(uuid, uuid, text, text, text, date, uuid[], text, text, text, text, text, text, uuid) to authenticated;

-- RLS ---------------------------------------------------------------------------------
-- Read-only through RLS: every Project member reads the records; evidence
-- citing a restricted artifact is hidden from anyone without a grant. No
-- insert, update or delete policies -- writes go through the function above.

alter table solution_verification_records enable row level security;
alter table solution_verification_evidence enable row level security;

drop policy if exists "solution_verification_records_select_member" on solution_verification_records;
create policy "solution_verification_records_select_member" on solution_verification_records
  for select using (is_project_member(project_id, auth.uid()));

drop policy if exists "solution_verification_evidence_select_member" on solution_verification_evidence;
create policy "solution_verification_evidence_select_member" on solution_verification_evidence
  for select using (
    is_project_member(project_id, auth.uid())
    and (workstream_artifact_id is null or has_evidence_access('workstream_artifact', workstream_artifact_id, auth.uid()))
  );

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
