-- Ember SLI, S2 stage 3: a private research space per Trigger
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §5).
--
-- Accepting a Trigger into research creates its own private Ember Project
-- (with one "Research" Workstream). The Project is the privacy boundary:
-- in Ember everyone in a Project sees all of its Workstreams, notes and the
-- assistant's context, so one shared Discovery Project could not keep one
-- Trigger's research from people invited to another (decision, 4 November
-- 2026).
--
-- Members are kept in step by sli_sync_trigger_project_members():
--   the sponsor            owner
--   the Discovery team     curator (every Trigger's Project)
--   invited contributors   consultant (that Trigger's Project only)
-- Anyone else, including a removed contributor or someone who left the
-- Discovery team, is set inactive (never deleted). Platform admins see every
-- Project anyway.
--
-- SLI users never see these Projects as Projects: Ember Core routes send
-- them to SLI screens, which show the research on the Trigger itself.
-- Safe to re-run.

-- Projects SLI is about to create. Only the functions below write here, so
-- a client cannot use it to skip Project approval.
create table if not exists sli_project_reservations (
  project_id uuid primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  trigger_id uuid not null references sli_triggers(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table sli_project_reservations enable row level security;
revoke all on sli_project_reservations from anon, authenticated;

create or replace function enforce_project_approval()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- An Ember SLI Trigger's research Project (reserved by
    -- sli_provision_trigger_research(), which only database functions can
    -- write) is created approved: the Trigger's acceptance is its approval.
    if auth.uid() is not null and not is_curator_or_admin(auth.uid())
      and not exists (select 1 from sli_project_reservations r where r.project_id = new.id) then
      new.approval_status := 'pending';
      new.approval_decided_by := null;
      new.approval_decided_at := null;
      new.approval_decision_reason := null;
    end if;
  elsif auth.uid() is not null and (
    new.approval_status is distinct from old.approval_status
    or new.approval_decided_by is distinct from old.approval_decided_by
    or new.approval_decided_at is distinct from old.approval_decided_at
    or new.approval_decision_reason is distinct from old.approval_decision_reason
    or new.pending_members is distinct from old.pending_members
  ) then
    raise exception 'Only a curator or platform admin can approve this project';
  end if;

  if new.approval_status <> 'approved' and (new.visibility <> 'private' or new.discoverability <> 'members_only') then
    raise exception 'This project is awaiting approval -- it stays private until a curator or admin approves it';
  end if;
  return new;
end;
$$;

alter table sli_triggers add column if not exists project_id uuid references projects(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sli_triggers_workstream_id_fkey') then
    alter table sli_triggers add constraint sli_triggers_workstream_id_fkey
      foreign key (workstream_id) references project_workstreams(id) on delete set null;
  end if;
end;
$$;

-- People from outside the Discovery team invited to one Trigger's research
-- (for example Presales checking capability fit). They must belong to the
-- same organisation.
create table if not exists sli_trigger_contributors (
  organization_id uuid not null,
  trigger_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  added_by uuid not null references profiles(id),
  added_at timestamptz not null default now(),
  primary key (trigger_id, user_id),
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references organization_members(organization_id, user_id) on delete cascade
);

create index if not exists sli_trigger_contributors_user_idx on sli_trigger_contributors(user_id);

alter table sli_trigger_contributors enable row level security;
revoke all on sli_trigger_contributors from anon, authenticated;

-- History also records who was invited or removed.
alter table sli_trigger_stage_history drop constraint if exists sli_trigger_stage_history_event_check;
alter table sli_trigger_stage_history add constraint sli_trigger_stage_history_event_check
  check (event in ('raised', 'stage_change', 'archived', 'unarchived', 'contributor_added', 'contributor_removed'));

-- Internal ------------------------------------------------------------------------

-- Brings a Trigger's Project membership in line with who should have it.
create or replace function sli_sync_trigger_project_members(p_trigger uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trigger sli_triggers;
begin
  select * into v_trigger from sli_triggers where id = p_trigger;
  if not found or v_trigger.project_id is null then
    return;
  end if;

  with wanted as (
    select v_trigger.sponsor_id as user_id, 'owner'::text as role, 1 as rank
    where v_trigger.sponsor_id is not null and sli_is_org_member(v_trigger.organization_id, v_trigger.sponsor_id)
    union all
    select dm.user_id, 'curator', 2
    from sli_department_members dm
    join sli_departments d on d.id = dm.department_id
    where dm.organization_id = v_trigger.organization_id and dm.status = 'active' and d.is_active and d.is_discovery_team
      and sli_is_org_member(v_trigger.organization_id, dm.user_id)
    union all
    select c.user_id, 'consultant', 3
    from sli_trigger_contributors c
    where c.trigger_id = v_trigger.id and sli_is_org_member(v_trigger.organization_id, c.user_id)
  ),
  best as (
    select distinct on (user_id) user_id, role from wanted order by user_id, rank
  ),
  upserted as (
    insert into project_members (project_id, user_id, role, status)
    select v_trigger.project_id, user_id, role, 'active' from best
    on conflict (project_id, user_id) do update
      set role = excluded.role, status = 'active'
      where project_members.role is distinct from excluded.role or project_members.status <> 'active'
    returning user_id
  )
  update project_members pm
  set status = 'inactive'
  where pm.project_id = v_trigger.project_id and pm.status = 'active'
    and not exists (select 1 from best b where b.user_id = pm.user_id);

  update projects set owner_id = v_trigger.sponsor_id
  where id = v_trigger.project_id and v_trigger.sponsor_id is not null and owner_id is distinct from v_trigger.sponsor_id;
end;
$$;

-- Creates the Trigger's Project and Research Workstream once, then syncs
-- membership. Safe to call again.
create or replace function sli_provision_trigger_research(p_trigger uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trigger sli_triggers;
  v_project uuid;
  v_workstream uuid;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found then
    return;
  end if;

  if v_trigger.project_id is null then
    v_project := gen_random_uuid();
    insert into sli_project_reservations (project_id, organization_id, trigger_id)
    values (v_project, v_trigger.organization_id, v_trigger.id);

    insert into projects (
      id, name, project_type, objective, status, owner_id, visibility, discoverability,
      information_sensitivity, portfolio_category, details
    ) values (
      v_project,
      left(v_trigger.code || ' · ' || v_trigger.title, 200),
      'experiment',
      nullif(left(v_trigger.summary, 2000), ''),
      'active',
      v_trigger.sponsor_id,
      'private',
      'members_only',
      v_trigger.information_sensitivity,
      'sandz',
      jsonb_build_object('sli_trigger_id', v_trigger.id, 'sli_trigger_code', v_trigger.code, 'sli_organization_id', v_trigger.organization_id)
    );

    update sli_triggers set project_id = v_project where id = v_trigger.id;
  else
    v_project := v_trigger.project_id;
  end if;

  if v_trigger.workstream_id is null then
    insert into project_workstreams (project_id, name, slug, status, goal, created_by)
    values (v_project, 'Research', 'research', 'active',
      'Research ' || v_trigger.code || ': ' || v_trigger.title || '. Is it worth pursuing, and does it suit Sandz?',
      v_trigger.sponsor_id)
    on conflict (project_id, slug) do nothing
    returning id into v_workstream;
    if v_workstream is null then
      select id into v_workstream from project_workstreams where project_id = v_project and slug = 'research';
    end if;
    update sli_triggers set workstream_id = v_workstream where id = v_trigger.id;
  end if;

  perform sli_sync_trigger_project_members(v_trigger.id);
end;
$$;

-- Discovery team changes reach every Trigger Project of the organisation.
create or replace function sli_sync_discovery_projects()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := coalesce(new.organization_id, old.organization_id);
  t record;
begin
  for t in select id from sli_triggers where organization_id = v_org and project_id is not null loop
    perform sli_sync_trigger_project_members(t.id);
  end loop;
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sli_department_members_sync_projects') then
    create trigger sli_department_members_sync_projects
      after insert or update or delete on sli_department_members
      for each row execute function sli_sync_discovery_projects();
  end if;
end;
$$;

revoke all on function sli_sync_trigger_project_members(uuid) from public, anon, authenticated;
revoke all on function sli_provision_trigger_research(uuid) from public, anon, authenticated;
revoke all on function sli_sync_discovery_projects() from public, anon, authenticated;

-- Updated: contributors see the Trigger, its summary, history and research,
-- but get no stage actions. Projects and contributors appear in the DTO.

create or replace function sli_trigger_access(p_trigger sli_triggers, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin(p_user) then 'full'
    when not sli_is_org_member(p_trigger.organization_id, p_user) then null
    when sli_is_discovery_member(p_trigger.organization_id, p_user) or p_trigger.sponsor_id = p_user then 'full'
    when exists (select 1 from sli_trigger_contributors c where c.trigger_id = p_trigger.id and c.user_id = p_user) then 'contributor'
    when p_trigger.raised_by = p_user then 'raiser'
    when sli_is_department_member(p_trigger.organization_id, p_user)
      and coalesce((select trigger_visibility from sli_settings where organization_id = p_trigger.organization_id), 'all_members') = 'all_members'
      then 'summary'
    else null
  end;
$$;

create or replace function sli_trigger_dto(p_trigger sli_triggers, p_access text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_trigger.id,
    'code', p_trigger.code,
    'title', p_trigger.title,
    'triggerType', p_trigger.trigger_type,
    'triggerTypeLabel', (select label from sli_trigger_types where organization_id = p_trigger.organization_id and code = p_trigger.trigger_type),
    'stage', p_trigger.stage,
    'priority', p_trigger.priority,
    'raisedByName', sli_display_name(p_trigger.raised_by),
    'raisedByMe', p_trigger.raised_by = p_user,
    'sponsorName', case when p_trigger.sponsor_id is null then null else sli_display_name(p_trigger.sponsor_id) end,
    'sponsoredByMe', p_trigger.sponsor_id is not distinct from p_user,
    'sourceDepartment', (select name from sli_departments where id = p_trigger.source_department_id),
    'archived', p_trigger.archived_at is not null,
    'createdAt', p_trigger.created_at,
    'updatedAt', p_trigger.updated_at,
    'access', p_access
  ) || case when p_access in ('full', 'raiser', 'contributor') then jsonb_build_object(
    'summary', p_trigger.summary,
    'eventDate', p_trigger.event_date,
    'eventReference', p_trigger.event_reference,
    'strategicObjective', p_trigger.strategic_objective,
    'informationSensitivity', p_trigger.information_sensitivity,
    'archivedAt', p_trigger.archived_at,
    'archiveReason', p_trigger.archive_reason
  ) else '{}'::jsonb end
  || case when p_access in ('full', 'contributor') then jsonb_build_object(
    'projectId', p_trigger.project_id,
    'workstreamId', p_trigger.workstream_id,
    'contributors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'userId', c.user_id, 'name', sli_display_name(c.user_id), 'isMe', c.user_id = p_user,
        'departments', coalesce((
          select string_agg(d.name, ', ' order by d.sort_order)
          from sli_department_members dm join sli_departments d on d.id = dm.department_id
          where dm.organization_id = p_trigger.organization_id and dm.user_id = c.user_id and dm.status = 'active'
        ), '')
      ) order by c.added_at)
      from sli_trigger_contributors c where c.trigger_id = p_trigger.id
    ), '[]'::jsonb)
  ) else '{}'::jsonb end;
$$;

create or replace function sli_transition_trigger(p_trigger uuid, p_to_stage text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_rule record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_allowed boolean;
  v_from text;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or sli_trigger_access(v_trigger, v_actor) is null then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  if v_trigger.archived_at is not null then
    raise exception 'This Trigger is archived. Unarchive it first.' using errcode = 'EC101';
  end if;

  select * into v_rule from sli_trigger_transition(v_trigger.stage, p_to_stage);
  if not found then
    if v_trigger.stage = 'under_review' then
      raise exception 'A Trigger under review moves on only with a management decision' using errcode = 'EC101';
    end if;
    raise exception 'A Trigger can''t move from % to %', v_trigger.stage, p_to_stage using errcode = 'EC101';
  end if;

  v_allowed := is_admin(v_actor) or case v_rule.actor
    when 'sponsor_pool' then sli_can_sponsor(v_trigger.organization_id, v_actor)
    when 'sponsor' then v_trigger.sponsor_id = v_actor and sli_is_org_member(v_trigger.organization_id, v_actor)
    when 'discovery' then sli_is_discovery_member(v_trigger.organization_id, v_actor)
    else false
  end;
  if not v_allowed then
    raise exception '%', case v_rule.actor
      when 'sponsor_pool' then 'Only a Discovery team sponsor can accept or decline a Trigger'
      when 'sponsor' then 'Only the Trigger''s sponsor can do that'
      else 'Only the Discovery team can do that'
    end using errcode = '42501';
  end if;
  if v_rule.reason_required and v_reason is null then
    raise exception 'Give a reason' using errcode = 'EC101';
  end if;

  v_from := v_trigger.stage;
  update sli_triggers
  set stage = p_to_stage,
      sponsor_id = case when v_rule.action = 'accept' then coalesce(sponsor_id, v_actor) else sponsor_id end
  where id = v_trigger.id
  returning * into v_trigger;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by)
  values (v_trigger.organization_id, v_trigger.id, 'stage_change', v_from, p_to_stage, v_reason, v_actor);

  -- Accepted into research: the Trigger gets its private research space.
  if p_to_stage in ('researching', 'concept', 'feasibility') then
    perform sli_provision_trigger_research(v_trigger.id);
  end if;

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'stage', v_trigger.stage);
end;
$$;

create or replace function sli_list_triggers(p_include_archived boolean default false, p_search text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := coalesce(sli_active_organization(v_actor),
    case when is_admin(v_actor) then (select id from organizations where status = 'active' order by created_at, id limit 1) end);
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if v_org is null then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(sli_trigger_dto(x.t, x.access, v_actor) order by (x.t).created_at desc, (x.t).code desc)
    from (
      select t, sli_trigger_access(t, v_actor) as access
      from sli_triggers t
      where t.organization_id = v_org
        and (p_include_archived or t.archived_at is null)
    ) x
    where x.access is not null
      and (
        v_search is null
        or (x.t).code ilike '%' || v_search || '%'
        or (x.t).title ilike '%' || v_search || '%'
        or (x.access in ('full', 'raiser', 'contributor') and (x.t).summary ilike '%' || v_search || '%')
      )
  ), '[]'::jsonb);
end;
$$;

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

-- Contributors -------------------------------------------------------------------

-- Who the caller may invite to a Trigger: active members of the
-- organisation's departments who are not on the Discovery team and not
-- already contributors.
create or replace function sli_list_contributor_candidates(p_trigger uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_trigger sli_triggers;
begin
  select * into v_trigger from sli_triggers where id = p_trigger;
  if not found or not (is_admin(v_actor) or v_trigger.sponsor_id = v_actor or sli_is_discovery_member(v_trigger.organization_id, v_actor)) then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('userId', x.user_id, 'name', sli_display_name(x.user_id), 'departments', x.departments) order by sli_display_name(x.user_id))
    from (
      select dm.user_id, string_agg(d.name, ', ' order by d.sort_order) as departments
      from sli_department_members dm
      join sli_departments d on d.id = dm.department_id
      where dm.organization_id = v_trigger.organization_id and dm.status = 'active' and d.is_active
        and sli_is_org_member(v_trigger.organization_id, dm.user_id)
        and not sli_is_discovery_member(v_trigger.organization_id, dm.user_id)
        and not exists (select 1 from sli_trigger_contributors c where c.trigger_id = v_trigger.id and c.user_id = dm.user_id)
      group by dm.user_id
    ) x
  ), '[]'::jsonb);
end;
$$;

-- Invite or remove a contributor. The sponsor, the Discovery team or a
-- platform admin may; the Trigger must have its research space and not be
-- archived.
create or replace function sli_set_trigger_contributor(p_trigger uuid, p_user uuid, p_add boolean)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_changed boolean := false;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or not (is_admin(v_actor) or v_trigger.sponsor_id = v_actor or sli_is_discovery_member(v_trigger.organization_id, v_actor)) then
    raise exception 'Only the sponsor or the Discovery team can invite people to a Trigger' using errcode = '42501';
  end if;
  if v_trigger.archived_at is not null then
    raise exception 'This Trigger is archived. Unarchive it first.' using errcode = 'EC101';
  end if;
  if v_trigger.project_id is null then
    raise exception 'Accept the Trigger into research before inviting people to it' using errcode = 'EC101';
  end if;

  if p_add then
    if not sli_is_department_member(v_trigger.organization_id, p_user) then
      raise exception 'Only members of this organisation''s departments can be invited' using errcode = 'EC101';
    end if;
    if sli_is_discovery_member(v_trigger.organization_id, p_user) then
      raise exception 'The Discovery team already sees every Trigger' using errcode = 'EC101';
    end if;
    insert into sli_trigger_contributors (organization_id, trigger_id, user_id, added_by)
    values (v_trigger.organization_id, v_trigger.id, p_user, v_actor)
    on conflict (trigger_id, user_id) do nothing;
    v_changed := found;
  else
    delete from sli_trigger_contributors where trigger_id = v_trigger.id and user_id = p_user;
    v_changed := found;
  end if;

  if v_changed then
    insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by)
    values (v_trigger.organization_id, v_trigger.id, case when p_add then 'contributor_added' else 'contributor_removed' end,
      v_trigger.stage, v_trigger.stage, sli_display_name(p_user), v_actor);
    perform sli_sync_trigger_project_members(v_trigger.id);
  end if;

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'changed', v_changed);
end;
$$;

revoke all on function sli_list_contributor_candidates(uuid) from public, anon;
revoke all on function sli_set_trigger_contributor(uuid, uuid, boolean) from public, anon;
grant execute on function sli_list_contributor_candidates(uuid) to authenticated;
grant execute on function sli_set_trigger_contributor(uuid, uuid, boolean) to authenticated;

-- Triggers already in research when this migration runs get their space now.
do $$
declare
  t record;
begin
  for t in select id from sli_triggers
    where project_id is null and stage in ('researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting', 'promoted')
  loop
    perform sli_provision_trigger_research(t.id);
  end loop;
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
