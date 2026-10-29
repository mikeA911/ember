-- Ember SLI, S2: Trigger registry, stages and history
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §4, §8 and §9).
--
-- A Trigger is something that may justify a new or changed solution. Any
-- active member of an SLI department raises one; the Discovery team
-- accepts it into research (the person accepting becomes its sponsor) or
-- declines it; the sponsor moves it through Researching, Concept and
-- Feasibility and submits it for review. Management decisions, Targeting
-- and handoffs (Approved, Targeting, Promoted, Rejected, and Deferred as a
-- decision outcome) come in S3 with sli_record_decision().
--
-- Every stage change goes through sli_transition_trigger(), which checks
-- the allowed transitions and who may make them, and writes an
-- append-only history row in the same transaction. Archiving is separate
-- from the stage: an archived Trigger keeps its stage and history, leaves
-- active lists, and can be unarchived.
--
-- Visibility (§9): the raiser always sees their Trigger; the Discovery
-- team sees everything; with trigger_visibility = 'all_members' (Sandz)
-- other department members see title, type, stage and dates only. A
-- platform admin who is not on the Discovery team can open a Trigger, and
-- each such opening is logged in sli_admin_access_log.
--
-- Tables are read and written only through the functions below (RLS on,
-- no policies, grants revoked). Safe to re-run.

-- Trigger types are data (§8 lists Sandz's). Seeded by scripts/sli-setup.mjs.
create table if not exists sli_trigger_types (
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null check (length(trim(label)) between 1 and 80),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  primary key (organization_id, code)
);

create table if not exists sli_triggers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null check (code ~ '^TRG-[0-9]{3,}$'),
  title text not null check (length(trim(title)) between 3 and 200),
  trigger_type text not null,
  source_department_id uuid,
  raised_by uuid not null references profiles(id),
  sponsor_id uuid references profiles(id),
  summary text not null default '' check (length(summary) <= 8000),
  event_date date,
  event_reference text check (length(event_reference) <= 1000),
  strategic_objective text check (length(strategic_objective) <= 2000),
  stage text not null default 'new' check (stage in (
    'new', 'researching', 'concept', 'feasibility', 'under_review',
    'approved', 'targeting', 'promoted', 'deferred', 'declined', 'rejected'
  )),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  information_sensitivity text not null default 'confidential'
    check (information_sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  -- The Trigger's research space (an Ember Workstream in the Discovery
  -- Project), linked in S2 stage 3.
  workstream_id uuid,
  source_trigger_id uuid,
  archived_at timestamptz,
  archived_by uuid references profiles(id),
  archive_reason text check (length(archive_reason) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id),
  foreign key (organization_id, trigger_type) references sli_trigger_types(organization_id, code),
  foreign key (organization_id, source_department_id) references sli_departments(organization_id, id),
  foreign key (organization_id, source_trigger_id) references sli_triggers(organization_id, id),
  check ((archived_at is null) = (archived_by is null))
);

create index if not exists sli_triggers_org_stage_idx on sli_triggers(organization_id, stage) where archived_at is null;
create index if not exists sli_triggers_org_raised_by_idx on sli_triggers(organization_id, raised_by);
create index if not exists sli_triggers_org_sponsor_idx on sli_triggers(organization_id, sponsor_id);

-- Append-only: raised, every stage change, archive and unarchive.
create table if not exists sli_trigger_stage_history (
  id bigint generated always as identity primary key,
  organization_id uuid not null,
  trigger_id uuid not null,
  event text not null check (event in ('raised', 'stage_change', 'archived', 'unarchived')),
  from_stage text,
  to_stage text not null,
  reason text check (length(reason) <= 2000),
  changed_by uuid not null references profiles(id),
  changed_at timestamptz not null default now(),
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id)
);

create index if not exists sli_trigger_stage_history_trigger_idx on sli_trigger_stage_history(trigger_id, id);

-- A platform admin opening a confidential Trigger outside the Discovery
-- team (§9: "access to confidential Triggers logged").
create table if not exists sli_admin_access_log (
  id bigint generated always as identity primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  trigger_id uuid not null references sli_triggers(id) on delete cascade,
  user_id uuid not null references profiles(id),
  accessed_at timestamptz not null default now()
);

create or replace function sli_refuse_history_change()
returns trigger
language plpgsql as $$
begin
  raise exception 'Trigger history is append-only' using errcode = '42501';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sli_trigger_stage_history_append_only') then
    create trigger sli_trigger_stage_history_append_only before update or delete on sli_trigger_stage_history
      for each row execute function sli_refuse_history_change();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sli_triggers_updated_at') then
    create trigger sli_triggers_updated_at before update on sli_triggers
      for each row execute function set_updated_at();
  end if;
end;
$$;

alter table sli_trigger_types enable row level security;
alter table sli_triggers enable row level security;
alter table sli_trigger_stage_history enable row level security;
alter table sli_admin_access_log enable row level security;
revoke all on sli_trigger_types, sli_triggers, sli_trigger_stage_history, sli_admin_access_log from anon, authenticated;

-- Allowed transitions -------------------------------------------------------------
-- actor: who may make it
--   sponsor_pool  a Discovery team member who can sponsor
--   sponsor       the Trigger's sponsor
--   discovery     any Discovery team member
-- A platform admin may make any of them. Decision outcomes (from
-- under_review) and Targeting/Promoted are recorded through S3's decision
-- and handoff functions, not here.
create or replace function sli_trigger_transition(p_from text, p_to text)
returns table (action text, actor text, reason_required boolean)
language sql immutable as $$
  select t.action, t.actor, t.reason_required
  from (values
    ('new', 'researching', 'accept', 'sponsor_pool', false),
    ('new', 'declined', 'decline', 'sponsor_pool', true),
    ('researching', 'concept', 'advance', 'sponsor', false),
    ('concept', 'feasibility', 'advance', 'sponsor', false),
    ('feasibility', 'under_review', 'submit', 'sponsor', false),
    ('concept', 'researching', 'step_back', 'sponsor', true),
    ('feasibility', 'concept', 'step_back', 'sponsor', true),
    ('feasibility', 'researching', 'step_back', 'sponsor', true),
    ('under_review', 'feasibility', 'withdraw', 'sponsor', true),
    ('deferred', 'researching', 'revisit', 'discovery', true),
    ('deferred', 'concept', 'revisit', 'discovery', true),
    ('deferred', 'feasibility', 'revisit', 'discovery', true)
  ) as t(from_stage, to_stage, action, actor, reason_required)
  where t.from_stage = p_from and t.to_stage = p_to;
$$;

-- What the caller may see of a Trigger: 'full' (Discovery team, sponsor,
-- platform admin), 'raiser' (their own Trigger), 'summary' (title, type,
-- stage, dates, when the organisation shares Triggers with all members),
-- or null.
create or replace function sli_trigger_access(p_trigger sli_triggers, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin(p_user) then 'full'
    when not sli_is_org_member(p_trigger.organization_id, p_user) then null
    when sli_is_discovery_member(p_trigger.organization_id, p_user) or p_trigger.sponsor_id = p_user then 'full'
    when p_trigger.raised_by = p_user then 'raiser'
    when sli_is_department_member(p_trigger.organization_id, p_user)
      and coalesce((select trigger_visibility from sli_settings where organization_id = p_trigger.organization_id), 'all_members') = 'all_members'
      then 'summary'
    else null
  end;
$$;

-- The actions the caller can take on a Trigger now, for the page's buttons.
create or replace function sli_trigger_allowed_actions(p_trigger sli_triggers, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'toStage', x.to_stage, 'reasonRequired', x.reason_required)
    order by x.ord), '[]'::jsonb)
  from (
    select t.action, s.to_stage, t.reason_required, s.ord
    from (values ('researching', 1), ('concept', 2), ('feasibility', 3), ('under_review', 4), ('declined', 5)) as s(to_stage, ord)
    cross join lateral sli_trigger_transition(p_trigger.stage, s.to_stage) t
    where p_trigger.archived_at is null
      and (
        is_admin(p_user)
        or (t.actor = 'sponsor_pool' and sli_can_sponsor(p_trigger.organization_id, p_user))
        or (t.actor = 'sponsor' and p_trigger.sponsor_id = p_user and sli_is_org_member(p_trigger.organization_id, p_user))
        or (t.actor = 'discovery' and sli_is_discovery_member(p_trigger.organization_id, p_user))
      )
    union all
    select case when p_trigger.archived_at is null then 'archive' else 'unarchive' end, null, p_trigger.archived_at is null, 6
    where is_admin(p_user) or sli_is_discovery_member(p_trigger.organization_id, p_user)
  ) x;
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
  ) || case when p_access in ('full', 'raiser') then jsonb_build_object(
    'summary', p_trigger.summary,
    'eventDate', p_trigger.event_date,
    'eventReference', p_trigger.event_reference,
    'strategicObjective', p_trigger.strategic_objective,
    'informationSensitivity', p_trigger.information_sensitivity,
    'archivedAt', p_trigger.archived_at,
    'archiveReason', p_trigger.archive_reason
  ) else '{}'::jsonb end;
$$;

revoke all on function sli_trigger_transition(text, text) from public, anon, authenticated;
revoke all on function sli_trigger_access(sli_triggers, uuid) from public, anon, authenticated;
revoke all on function sli_trigger_allowed_actions(sli_triggers, uuid) from public, anon, authenticated;
revoke all on function sli_trigger_dto(sli_triggers, text, uuid) from public, anon, authenticated;

-- API ----------------------------------------------------------------------------

-- The active Trigger types, for the raise form.
create or replace function sli_list_trigger_types()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_active_organization(v_actor);
begin
  if v_org is null then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('code', code, 'label', label) order by sort_order, label)
    from sli_trigger_types where organization_id = v_org and is_active
  ), '[]'::jsonb);
end;
$$;

-- Raise a Trigger in the caller's organisation. The source department is
-- one of the caller's own (their first, when not given).
create or replace function sli_raise_trigger(
  p_title text,
  p_trigger_type text,
  p_summary text,
  p_event_date date default null,
  p_event_reference text default null,
  p_strategic_objective text default null,
  p_source_department uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_active_organization(v_actor);
  v_department uuid;
  v_number integer;
  v_trigger sli_triggers;
begin
  if v_org is null or not sli_is_department_member(v_org, v_actor) then
    raise exception 'Only members of an SLI department can raise a Trigger' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_title, ''))) < 3 then
    raise exception 'Give the Trigger a title of at least three characters' using errcode = 'EC101';
  end if;
  if not exists (select 1 from sli_trigger_types where organization_id = v_org and code = p_trigger_type and is_active) then
    raise exception 'Choose a Trigger type' using errcode = 'EC101';
  end if;

  select dm.department_id into v_department
  from sli_department_members dm
  join sli_departments d on d.id = dm.department_id
  where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and d.is_active
    and (p_source_department is null or dm.department_id = p_source_department)
  order by d.sort_order, d.name
  limit 1;
  if v_department is null then
    raise exception 'You can raise a Trigger only from one of your own departments' using errcode = 'EC101';
  end if;

  insert into sli_settings (organization_id) values (v_org) on conflict (organization_id) do nothing;
  update sli_settings set next_trigger_number = next_trigger_number + 1
  where organization_id = v_org
  returning next_trigger_number - 1 into v_number;

  insert into sli_triggers (
    organization_id, code, title, trigger_type, source_department_id, raised_by,
    summary, event_date, event_reference, strategic_objective
  ) values (
    v_org, 'TRG-' || lpad(v_number::text, 3, '0'), trim(p_title), p_trigger_type, v_department, v_actor,
    coalesce(trim(p_summary), ''), p_event_date, nullif(trim(p_event_reference), ''), nullif(trim(p_strategic_objective), '')
  )
  returning * into v_trigger;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, changed_by)
  values (v_org, v_trigger.id, 'raised', null, 'new', v_actor);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code);
end;
$$;

-- Move a Trigger to another stage. Locks the row, checks the transition
-- and who may make it, and records history.
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

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'stage', v_trigger.stage);
end;
$$;

-- Archive or unarchive. The stage is untouched. (From S3, a Trigger with
-- an open handoff or send-back can't be archived until it is settled.)
create or replace function sli_set_trigger_archived(p_trigger uuid, p_archived boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or sli_trigger_access(v_trigger, v_actor) is null then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  if not (is_admin(v_actor) or sli_is_discovery_member(v_trigger.organization_id, v_actor)) then
    raise exception 'Only the Discovery team can archive or unarchive a Trigger' using errcode = '42501';
  end if;
  if p_archived = (v_trigger.archived_at is not null) then
    raise exception '%', case when p_archived then 'This Trigger is already archived' else 'This Trigger isn''t archived' end using errcode = 'EC101';
  end if;
  if p_archived and v_reason is null then
    raise exception 'Give a reason for archiving' using errcode = 'EC101';
  end if;

  update sli_triggers
  set archived_at = case when p_archived then now() end,
      archived_by = case when p_archived then v_actor end,
      archive_reason = case when p_archived then v_reason end
  where id = v_trigger.id
  returning * into v_trigger;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by)
  values (v_trigger.organization_id, v_trigger.id, case when p_archived then 'archived' else 'unarchived' end,
    v_trigger.stage, v_trigger.stage, v_reason, v_actor);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'archived', p_archived);
end;
$$;

-- The Triggers the caller can see in their organisation, newest first.
-- Archived ones only when asked; search matches code and title (and the
-- summary, where the caller may read it).
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
        or (x.access in ('full', 'raiser') and (x.t).summary ilike '%' || v_search || '%')
      )
  ), '[]'::jsonb);
end;
$$;

-- One Trigger by code, in the caller's organisation, with its history
-- (for the raiser and those with full access) and the caller's actions.
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
    'history', case when v_access in ('full', 'raiser') then coalesce((
      select jsonb_agg(jsonb_build_object(
        'event', h.event, 'fromStage', h.from_stage, 'toStage', h.to_stage, 'reason', h.reason,
        'changedByName', sli_display_name(h.changed_by), 'changedAt', h.changed_at
      ) order by h.id)
      from sli_trigger_stage_history h where h.trigger_id = v_trigger.id
    ), '[]'::jsonb) else '[]'::jsonb end
  );
end;
$$;

revoke all on function sli_list_trigger_types() from public, anon;
revoke all on function sli_raise_trigger(text, text, text, date, text, text, uuid) from public, anon;
revoke all on function sli_transition_trigger(uuid, text, text) from public, anon;
revoke all on function sli_set_trigger_archived(uuid, boolean, text) from public, anon;
revoke all on function sli_list_triggers(boolean, text) from public, anon;
revoke all on function sli_get_trigger(text) from public, anon;
grant execute on function sli_list_trigger_types() to authenticated;
grant execute on function sli_raise_trigger(text, text, text, date, text, text, uuid) to authenticated;
grant execute on function sli_transition_trigger(uuid, text, text) to authenticated;
grant execute on function sli_set_trigger_archived(uuid, boolean, text) to authenticated;
grant execute on function sli_list_triggers(boolean, text) to authenticated;
grant execute on function sli_get_trigger(text) to authenticated;

-- External MCP read-only guarantee, guarded so this migration also applies
-- before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
