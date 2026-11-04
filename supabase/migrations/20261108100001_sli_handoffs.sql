-- Ember SLI, S3 part 2: handoffs -- promote, return, send back
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §7, DISC-05).
--
-- One mechanism for moving work between stages:
--   promote    after an approval, the sponsor proposes a handoff to the
--              decision's destination department with a package (selected
--              saved research, the decision's conditions, target industries,
--              approved claims, a note). The destination lead accepts it,
--              which creates a Workstream for the Trigger in the
--              department's workspace with COPIES of the package (the
--              Discovery research itself stays private) and moves the
--              Trigger to Promoted; or returns it with a reason, and the
--              Trigger stays Approved for the sponsor to revise.
--   send back  later, the receiving department finds the solution
--              inadequate and asks to reopen an earlier stage, with a reason
--              category, evidence and whether its own work pauses or closes.
--              The sponsor or a decision authority accepts (the Trigger
--              reopens, the decision is superseded) or declines it.
-- Nothing is deleted; every step is in the Trigger's history.
--
-- Department workspaces: each department that receives handoffs gets a
-- private Ember Project (the "department workspace" of the knowledge
-- foundation design), created on first use; its lead owns it and its
-- members follow the department's membership.
--
-- Targeting and candidate customers (required before a Marketing handoff)
-- come in S3 part 3. Safe to re-run.

alter table sli_departments add column if not exists workspace_project_id uuid references projects(id) on delete set null;

-- Reservations now also cover department workspaces.
alter table sli_project_reservations alter column trigger_id drop not null;
alter table sli_project_reservations add column if not exists department_id uuid references sli_departments(id) on delete cascade;

create table if not exists sli_handoffs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trigger_id uuid not null,
  kind text not null check (kind in ('promote', 'send_back')),
  status text not null default 'proposed' check (status in ('proposed', 'accepted', 'returned', 'withdrawn', 'declined')),
  decision_id uuid references sli_decisions(id),
  destination_department_id uuid not null,
  -- send back: the stage to reopen, why, and what happens downstream
  to_stage text check (to_stage in ('researching', 'concept', 'feasibility')),
  reason_category text check (reason_category in ('solution_inadequate', 'insufficient_evidence', 'market_changed', 'customer_feedback', 'cost_or_risk_higher')),
  downstream_action text check (downstream_action in ('pause', 'close')),
  -- the promote package's text parts
  message text check (length(message) <= 4000),
  conditions text check (length(conditions) <= 4000),
  target_industries text check (length(target_industries) <= 2000),
  approved_claims text check (length(approved_claims) <= 8000),
  -- send back's reason and evidence; a return's, withdrawal's or decline's reason
  reason text check (length(reason) <= 4000),
  decision_reason text check (length(decision_reason) <= 4000),
  proposed_by uuid not null references profiles(id),
  proposed_at timestamptz not null default now(),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  destination_workstream_id uuid references project_workstreams(id) on delete set null,
  promote_handoff_id uuid references sli_handoffs(id),
  previous_handoff_id uuid references sli_handoffs(id),
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id) on delete cascade,
  foreign key (organization_id, destination_department_id) references sli_departments(organization_id, id),
  check (kind = 'promote' or (to_stage is not null and reason_category is not null and downstream_action is not null and promote_handoff_id is not null))
);

create unique index if not exists sli_handoffs_one_open_idx on sli_handoffs(trigger_id, kind) where status = 'proposed';
create index if not exists sli_handoffs_trigger_idx on sli_handoffs(trigger_id, proposed_at);
create index if not exists sli_handoffs_destination_idx on sli_handoffs(destination_department_id, status);

create table if not exists sli_handoff_package_items (
  handoff_id uuid not null references sli_handoffs(id) on delete cascade,
  source_artifact_id uuid not null references workstream_artifacts(id),
  copied_artifact_id uuid references workstream_artifacts(id) on delete set null,
  title text not null,
  primary key (handoff_id, source_artifact_id)
);

alter table sli_trigger_stage_history drop constraint if exists sli_trigger_stage_history_event_check;
alter table sli_trigger_stage_history add constraint sli_trigger_stage_history_event_check
  check (event in ('raised', 'stage_change', 'archived', 'unarchived', 'contributor_added', 'contributor_removed',
    'handoff_proposed', 'handoff_withdrawn', 'handoff_returned', 'send_back_raised', 'send_back_declined'));
alter table sli_trigger_stage_history add column if not exists handoff_id uuid references sli_handoffs(id);

alter table sli_handoffs enable row level security;
alter table sli_handoff_package_items enable row level security;
revoke all on sli_handoffs, sli_handoff_package_items from anon, authenticated;

-- Internal ------------------------------------------------------------------------

create or replace function sli_is_department_lead(p_department uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.department_id = p_department and dm.user_id = p_user and dm.status = 'active' and dm.role = 'lead'
      and d.is_active and sli_is_org_member(d.organization_id, p_user)
  );
$$;

create or replace function sli_is_member_of_department(p_department uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.department_id = p_department and dm.user_id = p_user and dm.status = 'active'
      and d.is_active and sli_is_org_member(d.organization_id, p_user)
  );
$$;

-- Workspace membership follows the department: leads curate, members
-- contribute; anyone who left is set inactive.
create or replace function sli_sync_department_workspace(p_department uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_project uuid;
begin
  select workspace_project_id into v_project from sli_departments where id = p_department;
  if v_project is null then
    return;
  end if;
  insert into project_members (project_id, user_id, role, status)
  select v_project, dm.user_id, case when dm.role = 'lead' then 'curator' else 'consultant' end, 'active'
  from sli_department_members dm join sli_departments d on d.id = dm.department_id
  where dm.department_id = p_department and dm.status = 'active' and sli_is_org_member(d.organization_id, dm.user_id)
    and not exists (select 1 from projects p where p.id = v_project and p.owner_id = dm.user_id)
  on conflict (project_id, user_id) do update set role = excluded.role, status = 'active'
    where project_members.role <> 'owner' and (project_members.role is distinct from excluded.role or project_members.status <> 'active');

  update project_members pm set status = 'inactive'
  where pm.project_id = v_project and pm.status = 'active' and pm.role <> 'owner'
    and not exists (
      select 1 from sli_department_members dm
      where dm.department_id = p_department and dm.user_id = pm.user_id and dm.status = 'active'
    );
end;
$$;

-- The department's workspace Project, created once.
create or replace function sli_ensure_department_workspace(p_department uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_dept sli_departments;
  v_project uuid;
  v_owner uuid;
begin
  select * into v_dept from sli_departments where id = p_department for update;
  if v_dept.workspace_project_id is not null then
    perform sli_sync_department_workspace(p_department);
    return v_dept.workspace_project_id;
  end if;

  select dm.user_id into v_owner from sli_department_members dm
  where dm.department_id = p_department and dm.status = 'active' and dm.role = 'lead'
  order by dm.created_at limit 1;

  v_project := gen_random_uuid();
  insert into sli_project_reservations (project_id, organization_id, department_id) values (v_project, v_dept.organization_id, v_dept.id);
  insert into projects (id, name, project_type, objective, status, owner_id, visibility, discoverability, information_sensitivity, portfolio_category, details)
  values (
    v_project,
    left(coalesce((select name from organizations where id = v_dept.organization_id), 'SLI') || ' · ' || v_dept.name || ' workspace', 200),
    'knowledge',
    'Work the ' || v_dept.name || ' department receives from other stages, and its own knowledge.',
    'active', v_owner, 'private', 'members_only', 'confidential', 'sandz',
    jsonb_build_object('sli_department_id', v_dept.id, 'sli_organization_id', v_dept.organization_id)
  );
  update sli_departments set workspace_project_id = v_project where id = v_dept.id;
  perform sli_sync_department_workspace(p_department);
  return v_project;
end;
$$;

create or replace function sli_sync_department_workspace_trigger()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform sli_sync_department_workspace(coalesce(new.department_id, old.department_id));
  return null;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sli_department_members_sync_workspace') then
    create trigger sli_department_members_sync_workspace
      after insert or update or delete on sli_department_members
      for each row execute function sli_sync_department_workspace_trigger();
  end if;
end;
$$;

-- The approval a handoff carries: the latest decision that isn't superseded.
create or replace function sli_current_decision(p_trigger uuid)
returns sli_decisions
language sql stable security definer set search_path = public as $$
  select * from sli_decisions where trigger_id = p_trigger and superseded_at is null order by decided_at desc limit 1;
$$;

-- Handoffs on the Trigger page, with what the caller may do.
create or replace function sli_trigger_handoff_dto(p_trigger sli_triggers, p_access text, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when p_access in ('full', 'destination') or (p_access = 'raiser') then jsonb_build_object(
    'handoffs', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', h.id, 'kind', h.kind, 'status', h.status,
        'destination', d.name, 'destinationDepartmentId', h.destination_department_id,
        'toStage', h.to_stage, 'reasonCategory', h.reason_category, 'downstreamAction', h.downstream_action,
        'message', h.message, 'conditions', h.conditions, 'targetIndustries', h.target_industries, 'approvedClaims', h.approved_claims,
        'reason', h.reason, 'decisionReason', h.decision_reason,
        'proposedBy', sli_display_name(h.proposed_by), 'proposedAt', h.proposed_at,
        'decidedBy', case when h.decided_by is not null then sli_display_name(h.decided_by) end, 'decidedAt', h.decided_at,
        'destinationWorkstreamId', h.destination_workstream_id,
        'workspaceProjectId', d.workspace_project_id,
        'items', coalesce((
          select jsonb_agg(jsonb_build_object('title', i.title, 'copiedArtifactId', i.copied_artifact_id) order by i.title)
          from sli_handoff_package_items i where i.handoff_id = h.id
        ), '[]'::jsonb),
        'canDecide', h.status = 'proposed' and p_trigger.archived_at is null and (
          (h.kind = 'promote' and (is_admin(p_user) or sli_is_department_lead(h.destination_department_id, p_user)))
          or (h.kind = 'send_back' and (is_admin(p_user) or p_trigger.sponsor_id = p_user
            or coalesce(sli_decision_role(p_trigger.organization_id, p_user) in ('authority', 'delegate'), false)))
        ),
        'canWithdraw', h.status = 'proposed' and h.kind = 'promote' and (h.proposed_by = p_user or p_trigger.sponsor_id = p_user or is_admin(p_user))
      ) order by h.proposed_at)
      from sli_handoffs h join sli_departments d on d.id = h.destination_department_id
      where h.trigger_id = p_trigger.id
        and (p_access = 'full' or (p_access = 'raiser' and h.status = 'accepted' and h.kind = 'promote')
          or (p_access = 'destination' and sli_is_member_of_department(h.destination_department_id, p_user)))
    ), '[]'::jsonb),
    'canPropose', p_access = 'full' and p_trigger.stage = 'approved' and p_trigger.archived_at is null
      and (is_admin(p_user) or p_trigger.sponsor_id = p_user)
      and not exists (select 1 from sli_handoffs h where h.trigger_id = p_trigger.id and h.kind = 'promote' and h.status = 'proposed'),
    'proposeTo', case when p_trigger.stage = 'approved' then (
      select jsonb_build_object('departmentId', d.id, 'name', d.name, 'conditions', (sli_current_decision(p_trigger.id)).conditions)
      from sli_departments d where d.id = (sli_current_decision(p_trigger.id)).destination_department_id
    ) end,
    'canSendBack', p_trigger.stage = 'promoted' and p_trigger.archived_at is null
      and not exists (select 1 from sli_handoffs h where h.trigger_id = p_trigger.id and h.kind = 'send_back' and h.status = 'proposed')
      and exists (
        select 1 from sli_handoffs h where h.trigger_id = p_trigger.id and h.kind = 'promote' and h.status = 'accepted'
          and (is_admin(p_user) or sli_is_member_of_department(h.destination_department_id, p_user))
      )
  ) else '{}'::jsonb end;
$$;

revoke all on function sli_is_department_lead(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_is_member_of_department(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_sync_department_workspace(uuid) from public, anon, authenticated;
revoke all on function sli_ensure_department_workspace(uuid) from public, anon, authenticated;
revoke all on function sli_sync_department_workspace_trigger() from public, anon, authenticated;
revoke all on function sli_current_decision(uuid) from public, anon, authenticated;
revoke all on function sli_trigger_handoff_dto(sli_triggers, text, uuid) from public, anon, authenticated;

-- API ----------------------------------------------------------------------------

-- The sponsor proposes the handoff the current approval calls for.
create or replace function sli_propose_handoff(
  p_trigger uuid,
  p_message text default null,
  p_artifacts uuid[] default '{}',
  p_target_industries text default null,
  p_approved_claims text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_decision sli_decisions;
  v_handoff uuid;
  v_previous uuid;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or sli_trigger_access(v_trigger, v_actor) is distinct from 'full' or not (is_admin(v_actor) or v_trigger.sponsor_id = v_actor) then
    raise exception 'Only the Trigger''s sponsor can propose a handoff' using errcode = '42501';
  end if;
  if v_trigger.stage <> 'approved' or v_trigger.archived_at is not null then
    raise exception 'Only an approved Trigger can be handed off' using errcode = 'EC101';
  end if;
  v_decision := sli_current_decision(v_trigger.id);
  if v_decision.id is null or v_decision.outcome <> 'approve' then
    raise exception 'Only an approved Trigger can be handed off' using errcode = 'EC101';
  end if;
  if exists (select 1 from sli_handoffs where trigger_id = v_trigger.id and kind = 'promote' and status = 'proposed') then
    raise exception 'A handoff is already waiting for an answer' using errcode = 'EC101';
  end if;
  if exists (
    select 1 from unnest(coalesce(p_artifacts, '{}')) e(id)
    where not exists (
      select 1 from workstream_artifacts a join project_workstreams w on w.id = a.workstream_id
      where a.id = e.id and w.project_id = v_trigger.project_id
    )
  ) then
    raise exception 'The package can only include this Trigger''s saved research' using errcode = 'EC101';
  end if;

  select id into v_previous from sli_handoffs
  where trigger_id = v_trigger.id and kind = 'promote' and status = 'returned' order by decided_at desc limit 1;

  insert into sli_handoffs (
    organization_id, trigger_id, kind, decision_id, destination_department_id,
    message, conditions, target_industries, approved_claims, proposed_by, previous_handoff_id
  ) values (
    v_trigger.organization_id, v_trigger.id, 'promote', v_decision.id, v_decision.destination_department_id,
    nullif(trim(coalesce(p_message, '')), ''), v_decision.conditions,
    nullif(trim(coalesce(p_target_industries, '')), ''), nullif(trim(coalesce(p_approved_claims, '')), ''),
    v_actor, v_previous
  ) returning id into v_handoff;

  insert into sli_handoff_package_items (handoff_id, source_artifact_id, title)
  select v_handoff, a.id, a.title
  from workstream_artifacts a where a.id in (select distinct unnest(coalesce(p_artifacts, '{}')));

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'handoff_proposed', v_trigger.stage, v_trigger.stage,
    (select name from sli_departments where id = v_decision.destination_department_id), v_actor, v_handoff);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'handoffId', v_handoff);
end;
$$;

-- The proposer or sponsor withdraws a proposal that hasn't been answered.
create or replace function sli_withdraw_handoff(p_handoff uuid, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_handoff sli_handoffs;
  v_trigger sli_triggers;
begin
  select * into v_handoff from sli_handoffs where id = p_handoff for update;
  if not found then
    raise exception 'Handoff not found' using errcode = '42501';
  end if;
  select * into v_trigger from sli_triggers where id = v_handoff.trigger_id;
  if v_handoff.kind <> 'promote' or not (is_admin(v_actor) or v_handoff.proposed_by = v_actor or v_trigger.sponsor_id = v_actor) then
    raise exception 'Only the sponsor can withdraw this handoff' using errcode = '42501';
  end if;
  if v_handoff.status <> 'proposed' then
    raise exception 'This handoff has already been answered' using errcode = 'EC101';
  end if;
  update sli_handoffs set status = 'withdrawn', decided_by = v_actor, decided_at = now(),
    decision_reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = v_handoff.id;
  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'handoff_withdrawn', v_trigger.stage, v_trigger.stage,
    nullif(trim(coalesce(p_reason, '')), ''), v_actor, v_handoff.id);
  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code);
end;
$$;

-- The destination lead accepts (copies the package into a new Workstream
-- in the department workspace; the Trigger is Promoted) or returns it.
create or replace function sli_decide_handoff(p_handoff uuid, p_accept boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_handoff sli_handoffs;
  v_trigger sli_triggers;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_workspace uuid;
  v_workstream uuid;
  v_slug text;
  v_dept text;
  item record;
  v_copy uuid;
begin
  select * into v_handoff from sli_handoffs where id = p_handoff for update;
  if not found then
    raise exception 'Handoff not found' using errcode = '42501';
  end if;
  select * into v_trigger from sli_triggers where id = v_handoff.trigger_id for update;
  if v_handoff.kind <> 'promote' or not (is_admin(v_actor) or sli_is_department_lead(v_handoff.destination_department_id, v_actor)) then
    raise exception 'Only the receiving department''s lead can accept or return this handoff' using errcode = '42501';
  end if;
  if v_handoff.status <> 'proposed' then
    raise exception 'This handoff has already been answered' using errcode = 'EC101';
  end if;
  if v_trigger.archived_at is not null then
    raise exception 'This Trigger is archived. Unarchive it first.' using errcode = 'EC101';
  end if;
  select name into v_dept from sli_departments where id = v_handoff.destination_department_id;

  if not p_accept then
    if v_reason is null then
      raise exception 'Say why you are returning it' using errcode = 'EC101';
    end if;
    update sli_handoffs set status = 'returned', decided_by = v_actor, decided_at = now(), decision_reason = v_reason where id = v_handoff.id;
    insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
    values (v_trigger.organization_id, v_trigger.id, 'handoff_returned', v_trigger.stage, v_trigger.stage, v_dept || ': ' || v_reason, v_actor, v_handoff.id);
    return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'status', 'returned');
  end if;

  v_workspace := sli_ensure_department_workspace(v_handoff.destination_department_id);
  v_slug := lower(v_trigger.code);
  insert into project_workstreams (project_id, name, slug, status, goal, created_by)
  values (v_workspace, left(v_trigger.code || ' · ' || v_trigger.title, 200), v_slug, 'active',
    coalesce(v_handoff.message, 'Take ' || v_trigger.code || ' forward from Discovery.'), v_actor)
  on conflict (project_id, slug) do update set status = 'active'
  returning id into v_workstream;

  for item in
    select i.source_artifact_id, a.artifact_type, a.title, a.content, a.external_url
    from sli_handoff_package_items i join workstream_artifacts a on a.id = i.source_artifact_id
    where i.handoff_id = v_handoff.id
  loop
    insert into workstream_artifacts (workstream_id, artifact_type, title, content, external_url, notes, created_by)
    values (v_workstream, item.artifact_type, item.title, item.content, item.external_url,
      'Copied from ' || v_trigger.code || ' (Discovery) when the handoff was accepted.', v_actor)
    returning id into v_copy;
    update sli_handoff_package_items set copied_artifact_id = v_copy where handoff_id = v_handoff.id and source_artifact_id = item.source_artifact_id;
  end loop;

  update sli_handoffs set status = 'accepted', decided_by = v_actor, decided_at = now(),
    decision_reason = v_reason, destination_workstream_id = v_workstream
  where id = v_handoff.id;
  update sli_triggers set stage = 'promoted' where id = v_trigger.id;
  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'stage_change', v_trigger.stage, 'promoted', 'Accepted by ' || v_dept, v_actor, v_handoff.id);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'status', 'accepted', 'workstreamId', v_workstream);
end;
$$;

-- The receiving department asks to reopen an earlier stage.
create or replace function sli_raise_send_back(
  p_trigger uuid,
  p_to_stage text,
  p_reason_category text,
  p_reason text,
  p_downstream_action text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_promote sli_handoffs;
  v_handoff uuid;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  select * into v_promote from sli_handoffs
  where trigger_id = v_trigger.id and kind = 'promote' and status = 'accepted' order by decided_at desc limit 1;
  if v_promote.id is null or not (is_admin(v_actor) or sli_is_member_of_department(v_promote.destination_department_id, v_actor)) then
    raise exception 'Only the department working on it can send a Trigger back' using errcode = '42501';
  end if;
  if v_trigger.stage <> 'promoted' or v_trigger.archived_at is not null then
    raise exception 'Only a promoted Trigger can be sent back' using errcode = 'EC101';
  end if;
  if coalesce(p_to_stage, '') not in ('researching', 'concept', 'feasibility') then
    raise exception 'Choose the stage to reopen' using errcode = 'EC101';
  end if;
  if coalesce(p_reason_category, '') not in ('solution_inadequate', 'insufficient_evidence', 'market_changed', 'customer_feedback', 'cost_or_risk_higher') then
    raise exception 'Choose why it is being sent back' using errcode = 'EC101';
  end if;
  if coalesce(p_downstream_action, '') not in ('pause', 'close') then
    raise exception 'Say whether your work pauses or closes' using errcode = 'EC101';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Describe what you found' using errcode = 'EC101';
  end if;
  if exists (select 1 from sli_handoffs where trigger_id = v_trigger.id and kind = 'send_back' and status = 'proposed') then
    raise exception 'A send-back is already waiting for an answer' using errcode = 'EC101';
  end if;

  insert into sli_handoffs (organization_id, trigger_id, kind, destination_department_id, to_stage, reason_category, downstream_action,
    reason, proposed_by, promote_handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'send_back', v_promote.destination_department_id, p_to_stage, p_reason_category,
    p_downstream_action, trim(p_reason), v_actor, v_promote.id)
  returning id into v_handoff;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'send_back_raised', v_trigger.stage, v_trigger.stage, trim(p_reason), v_actor, v_handoff);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'handoffId', v_handoff);
end;
$$;

-- The sponsor or a decision authority accepts a send-back (the Trigger
-- reopens; the approval is superseded; downstream work pauses or closes)
-- or declines it with a reason.
create or replace function sli_decide_send_back(p_handoff uuid, p_accept boolean, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_handoff sli_handoffs;
  v_trigger sli_triggers;
  v_promote sli_handoffs;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_decision sli_decisions;
begin
  select * into v_handoff from sli_handoffs where id = p_handoff for update;
  if not found or v_handoff.kind <> 'send_back' then
    raise exception 'Send-back not found' using errcode = '42501';
  end if;
  select * into v_trigger from sli_triggers where id = v_handoff.trigger_id for update;
  if not (is_admin(v_actor) or v_trigger.sponsor_id = v_actor
    or coalesce(sli_decision_role(v_trigger.organization_id, v_actor) in ('authority', 'delegate'), false)) then
    raise exception 'Only the sponsor or a decision authority can answer a send-back' using errcode = '42501';
  end if;
  if v_handoff.status <> 'proposed' then
    raise exception 'This send-back has already been answered' using errcode = 'EC101';
  end if;

  if not p_accept then
    if v_reason is null then
      raise exception 'Say why you are declining it' using errcode = 'EC101';
    end if;
    update sli_handoffs set status = 'declined', decided_by = v_actor, decided_at = now(), decision_reason = v_reason where id = v_handoff.id;
    insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
    values (v_trigger.organization_id, v_trigger.id, 'send_back_declined', v_trigger.stage, v_trigger.stage, v_reason, v_actor, v_handoff.id);
    return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'status', 'declined');
  end if;

  update sli_handoffs set status = 'accepted', decided_by = v_actor, decided_at = now(), decision_reason = v_reason where id = v_handoff.id;

  v_decision := sli_current_decision(v_trigger.id);
  if v_decision.id is not null then
    update sli_decisions set superseded_at = now(), superseded_reason = 'Sent back: ' || v_handoff.reason
    where id = v_decision.id;
  end if;

  select * into v_promote from sli_handoffs where id = v_handoff.promote_handoff_id;
  if v_handoff.downstream_action = 'close' and v_promote.destination_workstream_id is not null then
    update project_workstreams set status = 'archived' where id = v_promote.destination_workstream_id;
  end if;

  update sli_triggers set stage = v_handoff.to_stage where id = v_trigger.id;
  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by, handoff_id)
  values (v_trigger.organization_id, v_trigger.id, 'stage_change', v_trigger.stage, v_handoff.to_stage,
    'Sent back: ' || v_handoff.reason, v_actor, v_handoff.id);
  perform sli_apply_research_stage(v_trigger.id, v_handoff.to_stage);

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'status', 'accepted', 'stage', v_handoff.to_stage);
end;
$$;

-- What waits for the caller: handoffs to accept or return (department
-- leads), send-backs to answer (sponsors and decision authorities), and
-- work received by the caller's departments.
create or replace function sli_handoff_inbox()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := coalesce(sli_active_organization(v_actor),
    case when is_admin(v_actor) then (select id from organizations where status = 'active' order by created_at, id limit 1) end);
begin
  if v_org is null then
    return null;
  end if;
  return jsonb_build_object(
    'toAnswer', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title, 'kind', h.kind, 'department', d.name) order by h.proposed_at)
      from sli_handoffs h join sli_triggers t on t.id = h.trigger_id join sli_departments d on d.id = h.destination_department_id
      where h.organization_id = v_org and h.status = 'proposed' and t.archived_at is null and (
        (h.kind = 'promote' and sli_is_department_lead(h.destination_department_id, v_actor))
        or (h.kind = 'send_back' and (t.sponsor_id = v_actor or coalesce(sli_decision_role(v_org, v_actor) in ('authority', 'delegate'), false)))
      )
    ), '[]'::jsonb),
    'received', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title, 'department', d.name, 'acceptedAt', h.decided_at,
        'stage', t.stage) order by h.decided_at desc)
      from sli_handoffs h join sli_triggers t on t.id = h.trigger_id join sli_departments d on d.id = h.destination_department_id
      where h.organization_id = v_org and h.kind = 'promote' and h.status = 'accepted'
        and sli_is_member_of_department(h.destination_department_id, v_actor)
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function sli_propose_handoff(uuid, text, uuid[], text, text) from public, anon;
revoke all on function sli_withdraw_handoff(uuid, text) from public, anon;
revoke all on function sli_decide_handoff(uuid, boolean, text) from public, anon;
revoke all on function sli_raise_send_back(uuid, text, text, text, text) from public, anon;
revoke all on function sli_decide_send_back(uuid, boolean, text) from public, anon;
revoke all on function sli_handoff_inbox() from public, anon;
grant execute on function sli_propose_handoff(uuid, text, uuid[], text, text) to authenticated;
grant execute on function sli_withdraw_handoff(uuid, text) to authenticated;
grant execute on function sli_decide_handoff(uuid, boolean, text) to authenticated;
grant execute on function sli_raise_send_back(uuid, text, text, text, text) to authenticated;
grant execute on function sli_decide_send_back(uuid, boolean, text) to authenticated;
grant execute on function sli_handoff_inbox() to authenticated;

-- Updated: the receiving department sees the Trigger (summary, the
-- handoff package), never its research or deliberations.
create or replace function sli_trigger_access(p_trigger sli_triggers, p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select case
    when is_admin(p_user) then 'full'
    when not sli_is_org_member(p_trigger.organization_id, p_user) then null
    when sli_is_discovery_member(p_trigger.organization_id, p_user) or p_trigger.sponsor_id = p_user then 'full'
    when exists (select 1 from sli_trigger_contributors c where c.trigger_id = p_trigger.id and c.user_id = p_user) then 'contributor'
    when exists (
      select 1 from sli_handoffs h
      join sli_department_members dm on dm.department_id = h.destination_department_id and dm.user_id = p_user and dm.status = 'active'
      where h.trigger_id = p_trigger.id and h.kind = 'promote' and h.status in ('proposed', 'accepted')
    ) then 'destination'
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
  ) || case when p_access in ('full', 'raiser', 'contributor', 'destination') then jsonb_build_object(
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
        or (x.access in ('full', 'raiser', 'contributor', 'destination') and (x.t).summary ilike '%' || v_search || '%')
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
    'decisionInfo', sli_trigger_decision_dto(v_trigger, v_access, v_actor),
    'handoffInfo', sli_trigger_handoff_dto(v_trigger, v_access, v_actor),
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

-- A decision is superseded once it has a superseded date: by a newer
-- decision (superseded_by_id set) or by an accepted send-back (no newer
-- decision yet).
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
          'superseded', d.superseded_at is not null, 'supersededReason', d.superseded_reason,
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
          'decidedAt', d.decided_at, 'superseded', d.superseded_at is not null
        ) order by d.decided_at)
        from sli_decisions d where d.trigger_id = p_trigger.id
      ), '[]'::jsonb)
    )
    else '{}'::jsonb
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
  where trigger_id = v_trigger.id and superseded_at is null order by decided_at desc limit 1;

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

revoke all on function sli_trigger_decision_dto(sli_triggers, text, uuid) from public, anon, authenticated;
revoke all on function sli_record_decision(uuid, text, text, uuid, text, text, uuid[], boolean) from public, anon;
grant execute on function sli_record_decision(uuid, text, text, uuid, text, text, uuid[], boolean) to authenticated;

-- External MCP read-only guarantee, guarded so this migration also applies
-- before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
