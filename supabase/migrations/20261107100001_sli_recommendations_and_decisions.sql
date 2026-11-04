-- Ember SLI, S3 part 1: recommendations and management decisions
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §6, DISC-04).
--
-- When a Trigger is Under review, Discovery team members record a
-- recommendation (approve, revise, defer or reject; the latest per person
-- counts, earlier ones stay). The decider records the decision: approve
-- (with a destination department), revise (back to Researching, Concept or
-- Feasibility), defer (shelved) or reject, with a rationale, optional
-- conditions and the evidence relied on. A new decision supersedes the
-- previous one; nothing is overwritten.
--
-- Who decides is organisation configuration (sli_decision_authorities),
-- not Project approval policy, because each Trigger has its own Project:
--   decider   decides any Trigger, including ones they sponsor (Sandz: the MD)
--   delegate  decides between valid_from and valid_until, but never a
--             Trigger they sponsor (Sandz: the Country Manager)
-- A platform admin may also decide (recorded as such).
--
-- Safe to re-run.

create table if not exists sli_decision_authorities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('decider', 'delegate')),
  valid_from date,
  valid_until date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, user_id) references organization_members(organization_id, user_id) on delete cascade,
  check (kind = 'decider' or (valid_from is not null and valid_until is not null and valid_until >= valid_from))
);

create unique index if not exists sli_decision_authorities_one_decider_idx on sli_decision_authorities(organization_id) where kind = 'decider';
create index if not exists sli_decision_authorities_org_idx on sli_decision_authorities(organization_id, kind);

create table if not exists sli_recommendations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trigger_id uuid not null,
  recommended_by uuid not null references profiles(id),
  recommendation text not null check (recommendation in ('approve', 'revise', 'defer', 'reject')),
  destination_department_id uuid,
  comments text check (length(comments) <= 4000),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id) on delete cascade,
  foreign key (organization_id, destination_department_id) references sli_departments(organization_id, id)
);

create index if not exists sli_recommendations_trigger_idx on sli_recommendations(trigger_id, recorded_at);

create table if not exists sli_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trigger_id uuid not null,
  outcome text not null check (outcome in ('approve', 'revise', 'defer', 'reject')),
  destination_department_id uuid,
  return_to_stage text check (return_to_stage in ('researching', 'concept', 'feasibility')),
  rationale text not null check (length(trim(rationale)) between 3 and 8000),
  conditions text check (length(conditions) <= 4000),
  share_rationale_with_raiser boolean not null default false,
  decided_by uuid not null references profiles(id),
  decided_as text not null check (decided_as in ('authority', 'delegate', 'platform_admin')),
  decided_at timestamptz not null default now(),
  superseded_by_id uuid references sli_decisions(id),
  superseded_at timestamptz,
  superseded_reason text,
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id) on delete cascade,
  foreign key (organization_id, destination_department_id) references sli_departments(organization_id, id),
  check ((outcome = 'approve') = (destination_department_id is not null)),
  check ((outcome = 'revise') = (return_to_stage is not null))
);

create index if not exists sli_decisions_trigger_idx on sli_decisions(trigger_id, decided_at);

-- The saved research a decision relied on (artifacts in the Trigger's
-- research Project).
create table if not exists sli_decision_evidence (
  decision_id uuid not null references sli_decisions(id) on delete cascade,
  artifact_id uuid not null references workstream_artifacts(id) on delete cascade,
  primary key (decision_id, artifact_id)
);

alter table sli_trigger_stage_history add column if not exists decision_id uuid references sli_decisions(id);

alter table sli_decision_authorities enable row level security;
alter table sli_recommendations enable row level security;
alter table sli_decisions enable row level security;
alter table sli_decision_evidence enable row level security;
revoke all on sli_decision_authorities, sli_recommendations, sli_decisions, sli_decision_evidence from anon, authenticated;

-- Internal ------------------------------------------------------------------------

-- How the user may decide in the organisation today: 'authority',
-- 'delegate' (inside their dates), 'platform_admin', or null.
create or replace function sli_decision_role(p_org uuid, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when sli_is_org_member(p_org, p_user) and exists (
      select 1 from sli_decision_authorities a where a.organization_id = p_org and a.user_id = p_user and a.kind = 'decider'
    ) then 'authority'
    when sli_is_org_member(p_org, p_user) and exists (
      select 1 from sli_decision_authorities a
      where a.organization_id = p_org and a.user_id = p_user and a.kind = 'delegate'
        and current_date between a.valid_from and a.valid_until
    ) then 'delegate'
    when is_admin(p_user) then 'platform_admin'
    else null
  end;
$$;

-- May the user decide this Trigger now? Null when they may, else why not.
create or replace function sli_decision_refusal(p_trigger sli_triggers, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when p_trigger.stage <> 'under_review' then 'Only a Trigger under review can be decided'
    when p_trigger.archived_at is not null then 'This Trigger is archived. Unarchive it first.'
    when sli_decision_role(p_trigger.organization_id, p_user) is null then 'Only the decision authority can decide a Trigger'
    when sli_decision_role(p_trigger.organization_id, p_user) = 'delegate' and p_trigger.sponsor_id = p_user
      then 'As delegate you can''t decide a Trigger you sponsor; it waits for the decision authority'
    else null
  end;
$$;

-- Recommendations, decisions and what the caller may do, for the Trigger
-- page. The Discovery team (and platform admins) see everything; the
-- person who raised the Trigger sees each decision's outcome, and its
-- rationale only when the decider shared it; contributors see neither.
create or replace function sli_trigger_decision_dto(p_trigger sli_triggers, p_access text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case
    when p_access = 'full' then jsonb_build_object(
      'recommendations', coalesce((
        select jsonb_agg(jsonb_build_object(
          'by', sli_display_name(r.recommended_by), 'byMe', r.recommended_by = p_user,
          'recommendation', r.recommendation,
          'destination', (select name from sli_departments where id = r.destination_department_id),
          'comments', r.comments, 'recordedAt', r.recorded_at,
          'current', not exists (
            select 1 from sli_recommendations r2
            where r2.trigger_id = r.trigger_id and r2.recommended_by = r.recommended_by and r2.recorded_at > r.recorded_at
          )
        ) order by r.recorded_at)
        from sli_recommendations r where r.trigger_id = p_trigger.id
      ), '[]'::jsonb),
      'decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'outcome', d.outcome,
          'destination', (select name from sli_departments where id = d.destination_department_id),
          'returnToStage', d.return_to_stage, 'rationale', d.rationale, 'conditions', d.conditions,
          'decidedBy', sli_display_name(d.decided_by), 'decidedAs', d.decided_as, 'decidedAt', d.decided_at,
          'sharedWithRaiser', d.share_rationale_with_raiser,
          'superseded', d.superseded_by_id is not null, 'supersededReason', d.superseded_reason,
          'evidence', coalesce((
            select jsonb_agg(jsonb_build_object('id', a.id, 'title', a.title))
            from sli_decision_evidence e join workstream_artifacts a on a.id = e.artifact_id where e.decision_id = d.id
          ), '[]'::jsonb)
        ) order by d.decided_at)
        from sli_decisions d where d.trigger_id = p_trigger.id
      ), '[]'::jsonb),
      'canRecommend', p_trigger.stage = 'under_review' and p_trigger.archived_at is null
        and sli_is_discovery_member(p_trigger.organization_id, p_user)
        and coalesce(sli_decision_role(p_trigger.organization_id, p_user), '') <> 'authority',
      'canDecide', sli_decision_refusal(p_trigger, p_user) is null,
      'decideAs', sli_decision_role(p_trigger.organization_id, p_user),
      'decisionBlockedReason', case when p_trigger.stage = 'under_review' then sli_decision_refusal(p_trigger, p_user) end,
      'destinations', coalesce((
        select jsonb_agg(jsonb_build_object('id', d.id, 'name', d.name) order by d.sort_order, d.name)
        from sli_departments d where d.organization_id = p_trigger.organization_id and d.is_active and d.accepts_handoffs
      ), '[]'::jsonb)
    )
    when p_access = 'raiser' then jsonb_build_object(
      'decisions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', d.id, 'outcome', d.outcome,
          'destination', (select name from sli_departments where id = d.destination_department_id),
          'returnToStage', d.return_to_stage,
          'rationale', case when d.share_rationale_with_raiser then d.rationale end,
          'decidedAt', d.decided_at, 'superseded', d.superseded_by_id is not null
        ) order by d.decided_at)
        from sli_decisions d where d.trigger_id = p_trigger.id
      ), '[]'::jsonb)
    )
    else '{}'::jsonb
  end;
$$;

revoke all on function sli_decision_role(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_decision_refusal(sli_triggers, uuid) from public, anon, authenticated;
revoke all on function sli_trigger_decision_dto(sli_triggers, text, uuid) from public, anon, authenticated;

-- API ----------------------------------------------------------------------------

create or replace function sli_record_recommendation(p_trigger uuid, p_recommendation text, p_destination uuid default null, p_comments text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
begin
  select * into v_trigger from sli_triggers where id = p_trigger;
  if not found or not sli_is_discovery_member(v_trigger.organization_id, v_actor) then
    raise exception 'Only the Discovery team can record recommendations' using errcode = '42501';
  end if;
  if v_trigger.stage <> 'under_review' or v_trigger.archived_at is not null then
    raise exception 'Recommendations are recorded while a Trigger is under review' using errcode = 'EC101';
  end if;
  if sli_decision_role(v_trigger.organization_id, v_actor) = 'authority' then
    raise exception 'The decision authority records a decision, not a recommendation' using errcode = 'EC101';
  end if;
  if p_recommendation not in ('approve', 'revise', 'defer', 'reject') then
    raise exception 'Choose approve, revise, defer or reject' using errcode = 'EC101';
  end if;
  if p_destination is not null and not exists (
    select 1 from sli_departments where id = p_destination and organization_id = v_trigger.organization_id and is_active and accepts_handoffs
  ) then
    raise exception 'Choose a department that takes handoffs' using errcode = 'EC101';
  end if;

  insert into sli_recommendations (organization_id, trigger_id, recommended_by, recommendation, destination_department_id, comments)
  values (v_trigger.organization_id, v_trigger.id, v_actor, p_recommendation,
    case when p_recommendation = 'approve' then p_destination end, nullif(trim(coalesce(p_comments, '')), ''));

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code);
end;
$$;

create or replace function sli_record_decision(
  p_trigger uuid,
  p_outcome text,
  p_rationale text,
  p_destination uuid default null,
  p_return_to_stage text default null,
  p_conditions text default null,
  p_evidence uuid[] default '{}',
  p_share_with_raiser boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_refusal text;
  v_as text;
  v_to text;
  v_decision uuid;
  v_previous uuid;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or sli_trigger_access(v_trigger, v_actor) is distinct from 'full' then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  v_refusal := sli_decision_refusal(v_trigger, v_actor);
  if v_refusal is not null then
    raise exception '%', v_refusal using errcode = case when v_refusal like 'Only the decision%' or v_refusal like 'As delegate%' then '42501' else 'EC101' end;
  end if;
  v_as := sli_decision_role(v_trigger.organization_id, v_actor);

  if p_outcome not in ('approve', 'revise', 'defer', 'reject') then
    raise exception 'Choose approve, revise, defer or reject' using errcode = 'EC101';
  end if;
  if length(trim(coalesce(p_rationale, ''))) < 3 then
    raise exception 'Give the rationale for the decision' using errcode = 'EC101';
  end if;
  if p_outcome = 'approve' and not exists (
    select 1 from sli_departments where id = p_destination and organization_id = v_trigger.organization_id and is_active and accepts_handoffs
  ) then
    raise exception 'Choose where the approved Trigger goes next' using errcode = 'EC101';
  end if;
  if p_outcome = 'revise' and coalesce(p_return_to_stage, '') not in ('researching', 'concept', 'feasibility') then
    raise exception 'Choose the stage to revise in' using errcode = 'EC101';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_evidence, '{}')) e(id)
    where not exists (
      select 1 from workstream_artifacts a join project_workstreams w on w.id = a.workstream_id
      where a.id = e.id and w.project_id = v_trigger.project_id
    )
  ) then
    raise exception 'Evidence must come from this Trigger''s research' using errcode = 'EC101';
  end if;

  v_to := case p_outcome when 'approve' then 'approved' when 'revise' then p_return_to_stage when 'defer' then 'deferred' else 'rejected' end;

  select id into v_previous from sli_decisions
  where trigger_id = v_trigger.id and superseded_by_id is null order by decided_at desc limit 1;

  insert into sli_decisions (
    organization_id, trigger_id, outcome, destination_department_id, return_to_stage, rationale, conditions,
    share_rationale_with_raiser, decided_by, decided_as
  ) values (
    v_trigger.organization_id, v_trigger.id, p_outcome,
    case when p_outcome = 'approve' then p_destination end,
    case when p_outcome = 'revise' then p_return_to_stage end,
    trim(p_rationale), nullif(trim(coalesce(p_conditions, '')), ''),
    coalesce(p_share_with_raiser, false), v_actor, v_as
  ) returning id into v_decision;

  insert into sli_decision_evidence (decision_id, artifact_id)
  select v_decision, e.id from (select distinct unnest(coalesce(p_evidence, '{}')) as id) e;

  if v_previous is not null then
    update sli_decisions set superseded_by_id = v_decision, superseded_at = now(),
      superseded_reason = 'Superseded by a new decision'
    where id = v_previous;
  end if;

  update sli_triggers set stage = v_to where id = v_trigger.id;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, decision_id)
  values (v_trigger.organization_id, v_trigger.id, 'stage_change', v_trigger.stage, v_to,
    'Management decision: ' || p_outcome, v_actor, v_decision);

  if p_outcome = 'revise' then
    perform sli_apply_research_stage(v_trigger.id, p_return_to_stage);
  end if;

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'stage', v_to, 'decisionId', v_decision);
end;
$$;

-- The decider names a dated delegate (or clears it). The decider, an
-- organisation owner or admin, or a platform admin may.
create or replace function sli_set_decision_delegate(p_user uuid, p_from date, p_until date)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_active_organization(v_actor);
begin
  if v_org is null and is_admin(v_actor) then
    select id into v_org from organizations where status = 'active' order by created_at, id limit 1;
  end if;
  if v_org is null or not (
    is_admin(v_actor)
    or coalesce(sli_decision_role(v_org, v_actor) = 'authority', false)
    or exists (select 1 from organization_members where organization_id = v_org and user_id = v_actor and status = 'active' and role in ('owner', 'admin'))
  ) then
    raise exception 'Only the decision authority can name a delegate' using errcode = '42501';
  end if;

  delete from sli_decision_authorities where organization_id = v_org and kind = 'delegate';
  if p_user is null then
    return jsonb_build_object('delegate', null);
  end if;
  if not sli_is_discovery_member(v_org, p_user) then
    raise exception 'The delegate must be on the Discovery team' using errcode = 'EC101';
  end if;
  if p_from is null or p_until is null or p_until < p_from then
    raise exception 'Give the dates the delegation runs from and until' using errcode = 'EC101';
  end if;
  insert into sli_decision_authorities (organization_id, user_id, kind, valid_from, valid_until, created_by)
  values (v_org, p_user, 'delegate', p_from, p_until, v_actor);
  return jsonb_build_object('delegate', p_user, 'from', p_from, 'until', p_until);
end;
$$;

-- Who decides in the caller's organisation, for SLI Home and the delegate
-- form: the decider, the current or planned delegate, and whether the
-- caller may change the delegation.
create or replace function sli_decision_settings()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := coalesce(sli_active_organization(v_actor),
    case when is_admin(v_actor) then (select id from organizations where status = 'active' order by created_at, id limit 1) end);
begin
  if v_org is null or not (is_admin(v_actor) or sli_is_discovery_member(v_org, v_actor)) then
    return null;
  end if;
  return jsonb_build_object(
    'decider', (select jsonb_build_object('userId', user_id, 'name', sli_display_name(user_id), 'isMe', user_id = v_actor)
      from sli_decision_authorities where organization_id = v_org and kind = 'decider'),
    'delegate', (select jsonb_build_object('userId', user_id, 'name', sli_display_name(user_id), 'isMe', user_id = v_actor,
        'from', valid_from, 'until', valid_until, 'activeToday', current_date between valid_from and valid_until)
      from sli_decision_authorities where organization_id = v_org and kind = 'delegate'),
    'myRole', sli_decision_role(v_org, v_actor),
    'canSetDelegate', is_admin(v_actor) or coalesce(sli_decision_role(v_org, v_actor) = 'authority', false)
      or exists (select 1 from organization_members where organization_id = v_org and user_id = v_actor and status = 'active' and role in ('owner', 'admin')),
    'candidates', coalesce((
      select jsonb_agg(jsonb_build_object('userId', dm.user_id, 'name', sli_display_name(dm.user_id)) order by sli_display_name(dm.user_id))
      from sli_department_members dm join sli_departments d on d.id = dm.department_id
      where dm.organization_id = v_org and dm.status = 'active' and d.is_discovery_team and d.is_active
        and not exists (select 1 from sli_decision_authorities a where a.organization_id = v_org and a.kind = 'decider' and a.user_id = dm.user_id)
    ), '[]'::jsonb),
    'waitingForMe', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title) order by t.updated_at)
      from sli_triggers t
      where t.organization_id = v_org and t.stage = 'under_review' and t.archived_at is null
        and sli_decision_refusal(t, v_actor) is null
        and sli_decision_role(v_org, v_actor) in ('authority', 'delegate')
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function sli_record_recommendation(uuid, text, uuid, text) from public, anon;
revoke all on function sli_record_decision(uuid, text, text, uuid, text, text, uuid[], boolean) from public, anon;
revoke all on function sli_set_decision_delegate(uuid, date, date) from public, anon;
revoke all on function sli_decision_settings() from public, anon;
grant execute on function sli_record_recommendation(uuid, text, uuid, text) to authenticated;
grant execute on function sli_record_decision(uuid, text, text, uuid, text, text, uuid[], boolean) to authenticated;
grant execute on function sli_set_decision_delegate(uuid, date, date) to authenticated;
grant execute on function sli_decision_settings() to authenticated;

-- Updated: the Trigger page carries recommendations and decisions.
create or replace function sli_get_trigger(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := coalesce(sli_active_organization(v_actor),
    case when is_admin(v_actor) then (select id from organizations where status = 'active' order by created_at, id limit 1) end);
  v_trigger sli_triggers;
  v_access text;
begin
  select * into v_trigger from sli_triggers where organization_id = v_org and code = upper(trim(p_code));
  if not found then
    return null;
  end if;
  v_access := sli_trigger_access(v_trigger, v_actor);
  if v_access is null then
    return null;
  end if;

  if is_admin(v_actor) and not sli_is_discovery_member(v_trigger.organization_id, v_actor)
    and v_trigger.sponsor_id is distinct from v_actor and v_trigger.raised_by <> v_actor
    and (auth.jwt() ->> 'client_id') is null then
    insert into sli_admin_access_log (organization_id, trigger_id, user_id) values (v_trigger.organization_id, v_trigger.id, v_actor);
  end if;

  return sli_trigger_dto(v_trigger, v_access, v_actor) || jsonb_build_object(
    'allowedActions', case when v_access = 'full' then sli_trigger_allowed_actions(v_trigger, v_actor) else '[]'::jsonb end,
    'decisionInfo', sli_trigger_decision_dto(v_trigger, v_access, v_actor),
    'canManageContributors', v_access = 'full' and (is_admin(v_actor) or v_trigger.sponsor_id = v_actor or sli_is_discovery_member(v_trigger.organization_id, v_actor))
      and v_trigger.project_id is not null and v_trigger.archived_at is null,
    'history', case when v_access in ('full', 'raiser', 'contributor') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', h.event, 'fromStage', h.from_stage, 'toStage', h.to_stage, 'reason', h.reason,
        'changedByName', sli_display_name(h.changed_by), 'changedAt', h.changed_at
      ) order by h.id)
      from sli_trigger_stage_history h where h.trigger_id = v_trigger.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

-- External MCP read-only guarantee, guarded so this migration also applies
-- before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
