-- Pass criteria as a checklist. A verification method's pass criteria often
-- holds several acceptance criteria (AC1, AC2, ...); the record form lists
-- them and the recorder ticks each one met or not. The ticks are saved with
-- the record, each with the criterion text it was judged against, so the
-- history shows which criteria a result covered. A pass needs every listed
-- criterion met; a fail or conditional pass may leave some unmet. The app
-- splits the criteria from the text (src/lib/projects/criteria.ts); a record
-- without ticks (older records, or a method with one criterion) keeps
-- criteria_checks null.
--
-- Safe to re-run.

alter table solution_verification_records add column if not exists criteria_checks jsonb
  check (criteria_checks is null or jsonb_typeof(criteria_checks) = 'array');

-- The recording function gains p_criteria_checks: drop the old signature so
-- the two don't overload each other.
drop function if exists record_solution_verification(uuid, uuid, text, text, text, date, uuid[], text, text, text, text, text, text, uuid);

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
  p_supersedes_id uuid default null,
  p_criteria_checks jsonb default null
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
  v_check jsonb;
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

  if p_criteria_checks is not null then
    if jsonb_typeof(p_criteria_checks) <> 'array' then
      raise exception 'record_solution_verification: criteria checks must be a list';
    end if;
    for v_check in select value from jsonb_array_elements(p_criteria_checks) loop
      if jsonb_typeof(v_check) <> 'object'
        or coalesce(jsonb_typeof(v_check -> 'criterion'), '') <> 'string'
        or length(trim(v_check ->> 'criterion')) = 0
        or coalesce(jsonb_typeof(v_check -> 'met'), '') <> 'boolean' then
        raise exception 'record_solution_verification: each criteria check needs the criterion and whether it was met';
      end if;
    end loop;
    if p_result = 'pass' and exists (
      select 1 from jsonb_array_elements(p_criteria_checks) c where not (c ->> 'met')::boolean
    ) then
      raise exception 'record_solution_verification: a pass needs every pass criterion met';
    end if;
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
    performed_on, observations, defect_reference, supersedes_id, recorded_by, criteria_checks
  ) values (
    v_requirement.project_id, p_requirement_id, v_method.id, v_method.method, v_method.pass_criteria, v_method.threshold, v_method.measure_window,
    p_result, nullif(trim(p_conditions), ''), nullif(trim(p_rationale), ''), nullif(trim(p_measured_value), ''),
    p_environment, trim(p_solution_reference), nullif(trim(p_configuration_reference), ''),
    p_performed_on, nullif(trim(p_observations), ''), nullif(trim(p_defect_reference), ''), p_supersedes_id, v_uid,
    case when jsonb_array_length(coalesce(p_criteria_checks, '[]'::jsonb)) > 0 then p_criteria_checks end
  )
  returning id into v_record_id;

  insert into solution_verification_evidence (record_id, project_id, workstream_artifact_id)
  select v_record_id, v_requirement.project_id, a from unnest(v_artifact_ids) a;

  return v_record_id;
end;
$$;

revoke execute on function record_solution_verification(uuid, uuid, text, text, text, date, uuid[], text, text, text, text, text, text, uuid, jsonb) from public, anon;
grant execute on function record_solution_verification(uuid, uuid, text, text, text, date, uuid[], text, text, text, text, text, text, uuid, jsonb) to authenticated;

