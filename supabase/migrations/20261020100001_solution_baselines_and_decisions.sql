-- Solution conformance and acceptance evaluation, Stage 3: evaluation
-- baselines, waivers and conformance decisions (docs/dev-request-solution-
-- conformance-and-acceptance-evaluation.md).
--
-- A baseline is a named, versioned set of requirements for a purpose and
-- stage (e.g. "Cebu NG911 Phase 1 Site Acceptance"). While it is a draft,
-- curators add and remove requirements; activating it freezes it and moves
-- its requirements to 'baselined', which fixes their content, sources, scope
-- and verification methods (20261017100001). Changing scope means a new
-- version; activating the new version supersedes the old one.
--
-- A conformance decision is a human decision over an active baseline (site
-- acceptance, customer acceptance, go-live, ...). Who may approve it comes
-- from the Project's approval policies and authority assignments
-- (20260824140001_project_governance.sql): only an active holder of the
-- decision's approval type, never platform admin status by itself, and not
-- the requester or anyone who recorded the evidence unless both the policy
-- and the assignment allow self-approval. When it is decided, the decision
-- keeps a snapshot of exactly which (immutable) verification records and
-- waivers it rested on.
--
-- A waiver (or deviation) accepts a requirement as not met, or met
-- differently, for one baseline. It needs a rationale and is approved the
-- same way; approved waivers appear in every later roll-up of that baseline.
--
-- Waivers and decisions are written only through the functions below.
-- Safe to re-run (if not exists / drop ... if exists / create or replace).

-- Authority ---------------------------------------------------------------------------
-- Whether a user currently holds an approval authority in a Project: an
-- active, in-date assignment, while an active member. No admin bypass --
-- authority is assigned, never inferred.
create or replace function holds_project_authority(p_project_id uuid, p_uid uuid, p_approval_type text)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from project_authority_assignments a
    join project_members pm on pm.project_id = a.project_id and pm.user_id = a.user_id and pm.status = 'active'
    where a.project_id = p_project_id and a.user_id = p_uid and a.approval_type = p_approval_type
      and a.status = 'active' and a.effective_from <= now() and (a.expires_at is null or a.expires_at > now())
  );
$$;

-- Self-approval is allowed only when both the Project's policy for the
-- approval type and the approver's own assignment allow it.
create or replace function project_self_approval_allowed(p_project_id uuid, p_uid uuid, p_approval_type text)
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select p.allow_self_approval from project_approval_policies p where p.project_id = p_project_id and p.approval_type = p_approval_type), false)
    and exists (
      select 1 from project_authority_assignments a
      where a.project_id = p_project_id and a.user_id = p_uid and a.approval_type = p_approval_type
        and a.status = 'active' and a.allow_self_approval
        and a.effective_from <= now() and (a.expires_at is null or a.expires_at > now())
    );
$$;

-- Baselines ---------------------------------------------------------------------------
create table if not exists solution_evaluation_baselines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  purpose text not null
    check (purpose in ('presales_claim_validation', 'factory_acceptance', 'site_acceptance', 'customer_acceptance', 'go_live', 'post_change_reverification')),
  lifecycle_stage text not null default 'deployment' check (lifecycle_stage in ('presales', 'deployment', 'management_maintenance')),
  description text,
  version integer not null default 1 check (version >= 1),
  previous_baseline_id uuid references solution_evaluation_baselines(id),
  status text not null default 'draft' check (status in ('draft', 'active', 'superseded')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  activated_by uuid references profiles(id) on delete set null,
  activated_at timestamptz,
  unique (project_id, name, version)
);

create index if not exists solution_evaluation_baselines_project_idx on solution_evaluation_baselines(project_id, status);

drop trigger if exists solution_evaluation_baselines_set_updated_at on solution_evaluation_baselines;
create trigger solution_evaluation_baselines_set_updated_at before update on solution_evaluation_baselines
  for each row execute function set_updated_at();

-- A draft's name, purpose, stage and description can change; nothing else
-- ever does, and once active only the move to superseded is allowed (made by
-- activating the next version).
create or replace function solution_evaluation_baselines_before_update()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id or new.version is distinct from old.version
    or new.previous_baseline_id is distinct from old.previous_baseline_id
    or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'solution_evaluation_baselines: project, version and author cannot change';
  end if;
  if old.status <> 'draft' and (
    new.name is distinct from old.name or new.purpose is distinct from old.purpose
    or new.lifecycle_stage is distinct from old.lifecycle_stage or new.description is distinct from old.description
  ) then
    raise exception 'solution_evaluation_baselines: an active baseline is frozen -- create a new version to change it';
  end if;
  if new.status is distinct from old.status
    and not (old.status = 'draft' and new.status = 'active') and not (old.status = 'active' and new.status = 'superseded') then
    raise exception 'solution_evaluation_baselines: a baseline only moves from draft to active to superseded';
  end if;
  return new;
end;
$$;

drop trigger if exists solution_evaluation_baselines_before_update on solution_evaluation_baselines;
create trigger solution_evaluation_baselines_before_update before update on solution_evaluation_baselines
  for each row execute function solution_evaluation_baselines_before_update();

create or replace function solution_baseline_is_draft(p_baseline_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from solution_evaluation_baselines b where b.id = p_baseline_id and b.status = 'draft');
$$;

create table if not exists solution_evaluation_baseline_items (
  id uuid primary key default gen_random_uuid(),
  baseline_id uuid not null references solution_evaluation_baselines(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  -- Only a draft requirement can be deleted, and a requirement in an active
  -- baseline is baselined, so this only ever removes draft-baseline items.
  requirement_id uuid not null references solution_requirements(id) on delete cascade,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (baseline_id, requirement_id)
);

create index if not exists solution_evaluation_baseline_items_requirement_idx on solution_evaluation_baseline_items(requirement_id);

-- An item belongs to its baseline's Project, cites an open requirement of
-- that Project, and only changes while the baseline is a draft (the RLS
-- policies say the same; this also holds for definer and service paths).
create or replace function solution_evaluation_baseline_items_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_baseline solution_evaluation_baselines%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Deleting the baseline or the Project removes items with it.
    if pg_trigger_depth() = 1 and exists (select 1 from solution_evaluation_baselines b where b.id = old.baseline_id and b.status <> 'draft') then
      raise exception 'solution_evaluation_baseline_items: an active baseline is frozen -- create a new version to change it';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'solution_evaluation_baseline_items: items are added or removed, never changed';
  end if;
  select * into v_baseline from solution_evaluation_baselines where id = new.baseline_id;
  if not found or v_baseline.project_id is distinct from new.project_id then
    raise exception 'solution_evaluation_baseline_items: must belong to its baseline''s Project';
  end if;
  if v_baseline.status <> 'draft' then
    raise exception 'solution_evaluation_baseline_items: an active baseline is frozen -- create a new version to change it';
  end if;
  if not exists (
    select 1 from solution_requirements r
    where r.id = new.requirement_id and r.project_id = v_baseline.project_id and r.status in ('draft', 'baselined')
  ) then
    raise exception 'solution_evaluation_baseline_items: only an open requirement of this Project can be baselined';
  end if;
  return new;
end;
$$;

drop trigger if exists solution_evaluation_baseline_items_before_write on solution_evaluation_baseline_items;
create trigger solution_evaluation_baseline_items_before_write before insert or update or delete on solution_evaluation_baseline_items
  for each row execute function solution_evaluation_baseline_items_before_write();

-- Activating a baseline: a curator; at least one requirement, each still
-- open and with a verification method. Its requirements become baselined
-- (content fixed), and the version it replaces is superseded.
create or replace function activate_solution_baseline(p_baseline_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_baseline solution_evaluation_baselines%rowtype;
begin
  select * into v_baseline from solution_evaluation_baselines where id = p_baseline_id for update;
  if not found or v_uid is null or not can_curate_project(v_baseline.project_id, v_uid) then
    raise exception 'activate_solution_baseline: only this Project''s owner and curators can activate a baseline';
  end if;
  if v_baseline.status <> 'draft' then
    raise exception 'activate_solution_baseline: only a draft baseline can be activated';
  end if;
  if not exists (select 1 from solution_evaluation_baseline_items i where i.baseline_id = p_baseline_id) then
    raise exception 'activate_solution_baseline: add at least one requirement first';
  end if;
  if exists (
    select 1 from solution_evaluation_baseline_items i join solution_requirements r on r.id = i.requirement_id
    where i.baseline_id = p_baseline_id and r.status not in ('draft', 'baselined')
  ) then
    raise exception 'activate_solution_baseline: remove withdrawn or superseded requirements first';
  end if;
  if exists (
    select 1 from solution_evaluation_baseline_items i
    where i.baseline_id = p_baseline_id
      and not exists (select 1 from solution_verification_methods m where m.requirement_id = i.requirement_id)
  ) then
    raise exception 'activate_solution_baseline: every requirement needs a verification method first';
  end if;

  update solution_requirements r set status = 'baselined'
  from solution_evaluation_baseline_items i
  where i.baseline_id = p_baseline_id and r.id = i.requirement_id and r.status = 'draft';

  if v_baseline.previous_baseline_id is not null then
    update solution_evaluation_baselines set status = 'superseded'
    where id = v_baseline.previous_baseline_id and status = 'active';
  end if;

  update solution_evaluation_baselines set status = 'active', activated_by = v_uid, activated_at = now() where id = p_baseline_id;
end;
$$;

-- A new version of an active or superseded baseline: a draft copy with the
-- next version number. A requirement that has since been superseded is
-- carried over as its replacement; withdrawn ones are left out.
create or replace function new_solution_baseline_version(p_baseline_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_baseline solution_evaluation_baselines%rowtype;
  v_new_id uuid;
begin
  select * into v_baseline from solution_evaluation_baselines where id = p_baseline_id;
  if not found or v_uid is null or not can_curate_project(v_baseline.project_id, v_uid) then
    raise exception 'new_solution_baseline_version: only this Project''s owner and curators can version a baseline';
  end if;
  if v_baseline.status = 'draft' then
    raise exception 'new_solution_baseline_version: a draft can still be edited -- activate it first';
  end if;
  if exists (
    select 1 from solution_evaluation_baselines b
    where b.project_id = v_baseline.project_id and b.name = v_baseline.name and b.status = 'draft'
  ) then
    raise exception 'new_solution_baseline_version: a draft version of this baseline already exists';
  end if;

  insert into solution_evaluation_baselines (project_id, name, purpose, lifecycle_stage, description, version, previous_baseline_id, created_by)
  select v_baseline.project_id, v_baseline.name, v_baseline.purpose, v_baseline.lifecycle_stage, v_baseline.description,
    (select max(b.version) + 1 from solution_evaluation_baselines b where b.project_id = v_baseline.project_id and b.name = v_baseline.name),
    v_baseline.id, v_uid
  returning id into v_new_id;

  insert into solution_evaluation_baseline_items (baseline_id, project_id, requirement_id, added_by)
  select distinct v_new_id, v_baseline.project_id, coalesce(replacement.id, r.id), v_uid
  from solution_evaluation_baseline_items i
  join solution_requirements r on r.id = i.requirement_id
  left join solution_requirements replacement on replacement.id = r.superseded_by and replacement.status in ('draft', 'baselined')
  where i.baseline_id = p_baseline_id
    and (r.status in ('draft', 'baselined') or replacement.id is not null);

  return v_new_id;
end;
$$;

-- Waivers -----------------------------------------------------------------------------
create table if not exists solution_waivers (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_id uuid not null references solution_evaluation_baselines(id) on delete cascade,
  requirement_id uuid not null references solution_requirements(id),
  kind text not null check (kind in ('waiver', 'deviation')),
  rationale text not null check (length(trim(rationale)) > 0),
  conditions text,
  approval_type text not null check (approval_type in ('technical', 'security_compliance', 'customer_acceptance', 'production_change')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  requested_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text
);

create index if not exists solution_waivers_baseline_idx on solution_waivers(baseline_id);
-- One live waiver per requirement per baseline.
create unique index if not exists solution_waivers_live_uniq on solution_waivers(baseline_id, requirement_id) where status in ('pending', 'approved');

create or replace function request_solution_waiver(
  p_baseline_id uuid,
  p_requirement_id uuid,
  p_kind text,
  p_rationale text,
  p_approval_type text,
  p_conditions text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_baseline solution_evaluation_baselines%rowtype;
  v_id uuid;
begin
  select * into v_baseline from solution_evaluation_baselines where id = p_baseline_id;
  if not found or v_uid is null or not can_run_project_evals(v_baseline.project_id, v_uid) then
    raise exception 'request_solution_waiver: only this Project''s owner, curators and consultants can request a waiver';
  end if;
  if v_baseline.status <> 'active' then
    raise exception 'request_solution_waiver: waivers apply to an active baseline';
  end if;
  if not exists (select 1 from solution_evaluation_baseline_items i where i.baseline_id = p_baseline_id and i.requirement_id = p_requirement_id) then
    raise exception 'request_solution_waiver: the requirement is not in this baseline';
  end if;
  if p_kind is null or p_kind not in ('waiver', 'deviation') then
    raise exception 'request_solution_waiver: choose waiver or deviation';
  end if;
  if length(trim(coalesce(p_rationale, ''))) = 0 then
    raise exception 'request_solution_waiver: a waiver needs a rationale';
  end if;
  if p_approval_type is null or p_approval_type not in ('technical', 'security_compliance', 'customer_acceptance', 'production_change') then
    raise exception 'request_solution_waiver: choose who must approve it';
  end if;
  if exists (select 1 from solution_waivers w where w.baseline_id = p_baseline_id and w.requirement_id = p_requirement_id and w.status in ('pending', 'approved')) then
    raise exception 'request_solution_waiver: this requirement already has a pending or approved waiver in this baseline';
  end if;

  insert into solution_waivers (project_id, baseline_id, requirement_id, kind, rationale, conditions, approval_type, requested_by)
  values (v_baseline.project_id, p_baseline_id, p_requirement_id, p_kind, trim(p_rationale), nullif(trim(p_conditions), ''), p_approval_type, v_uid)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function decide_solution_waiver(p_waiver_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_waiver solution_waivers%rowtype;
begin
  select * into v_waiver from solution_waivers where id = p_waiver_id for update;
  if not found or v_uid is null or not holds_project_authority(v_waiver.project_id, v_uid, v_waiver.approval_type) then
    raise exception 'decide_solution_waiver: only a holder of the required approval authority can decide this waiver';
  end if;
  if v_waiver.status <> 'pending' then
    raise exception 'decide_solution_waiver: this waiver has already been decided';
  end if;
  if v_waiver.requested_by = v_uid and not project_self_approval_allowed(v_waiver.project_id, v_uid, v_waiver.approval_type) then
    raise exception 'decide_solution_waiver: you requested this waiver, and this Project does not allow self-approval';
  end if;
  update solution_waivers
  set status = case when p_approve then 'approved' else 'rejected' end,
      decided_by = v_uid, decided_at = now(), decision_note = nullif(trim(p_note), '')
  where id = p_waiver_id;
end;
$$;

create or replace function withdraw_solution_waiver(p_waiver_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_waiver solution_waivers%rowtype;
begin
  select * into v_waiver from solution_waivers where id = p_waiver_id for update;
  if not found or v_uid is null or not (v_waiver.requested_by = v_uid or can_curate_project(v_waiver.project_id, v_uid)) then
    raise exception 'withdraw_solution_waiver: only the requester or a curator can withdraw a waiver';
  end if;
  if v_waiver.status <> 'pending' then
    raise exception 'withdraw_solution_waiver: only a pending waiver can be withdrawn';
  end if;
  update solution_waivers set status = 'withdrawn', decided_by = v_uid, decided_at = now() where id = p_waiver_id;
end;
$$;

-- Conformance decisions ---------------------------------------------------------------
create table if not exists solution_conformance_decisions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  baseline_id uuid not null references solution_evaluation_baselines(id) on delete cascade,
  decision_type text not null
    check (decision_type in ('presales_claim_validation', 'factory_acceptance', 'site_acceptance', 'customer_acceptance', 'go_live', 'post_change_reverification')),
  approval_type text not null check (approval_type in ('technical', 'security_compliance', 'customer_acceptance', 'production_change')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  request_note text,
  -- Approvals needed, fixed from the policy when requested.
  required_approvals integer not null default 1 check (required_approvals >= 1),
  approval_mode text not null default 'any_authorized' check (approval_mode in ('any_authorized', 'all_assigned')),
  requested_by uuid references profiles(id) on delete set null,
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  -- What the decision rested on, taken when it was decided: per requirement,
  -- its methods, the verification records in effect and any approved waiver.
  snapshot jsonb
);

create index if not exists solution_conformance_decisions_baseline_idx on solution_conformance_decisions(baseline_id);
-- One pending decision of each kind per baseline.
create unique index if not exists solution_conformance_decisions_pending_uniq
  on solution_conformance_decisions(baseline_id, decision_type) where status = 'pending';

create table if not exists solution_conformance_decision_approvals (
  id uuid primary key default gen_random_uuid(),
  decision_id uuid not null references solution_conformance_decisions(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  approver_id uuid references profiles(id) on delete set null,
  verdict text not null check (verdict in ('approve', 'reject')),
  note text,
  conditions text,
  created_at timestamptz not null default now(),
  unique (decision_id, approver_id)
);

create index if not exists solution_conformance_decision_approvals_decision_idx on solution_conformance_decision_approvals(decision_id);

create or replace function solution_baseline_snapshot(p_baseline_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'taken_at', now(),
    'baseline_version', (select b.version from solution_evaluation_baselines b where b.id = p_baseline_id),
    'requirements', coalesce((
      select jsonb_agg(jsonb_build_object(
        'requirement_id', i.requirement_id,
        'method_ids', coalesce((
          select jsonb_agg(m.id order by m.created_at) from solution_verification_methods m where m.requirement_id = i.requirement_id
        ), '[]'::jsonb),
        'record_ids', coalesce((
          select jsonb_agg(x.id) from (
            select distinct on (r.method_id) r.id
            from solution_verification_records r
            where r.requirement_id = i.requirement_id and r.method_id is not null
              and not exists (select 1 from solution_verification_records s where s.supersedes_id = r.id)
            order by r.method_id, r.performed_on desc, r.recorded_at desc
          ) x
        ), '[]'::jsonb),
        'waiver_id', (
          select w.id from solution_waivers w
          where w.baseline_id = p_baseline_id and w.requirement_id = i.requirement_id and w.status = 'approved'
          limit 1
        )
      ) order by i.created_at)
      from solution_evaluation_baseline_items i where i.baseline_id = p_baseline_id
    ), '[]'::jsonb)
  );
$$;

create or replace function request_solution_conformance_decision(
  p_baseline_id uuid,
  p_decision_type text,
  p_approval_type text,
  p_note text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_baseline solution_evaluation_baselines%rowtype;
  v_policy project_approval_policies%rowtype;
  v_id uuid;
begin
  select * into v_baseline from solution_evaluation_baselines where id = p_baseline_id;
  if not found or v_uid is null or not can_curate_project(v_baseline.project_id, v_uid) then
    raise exception 'request_solution_conformance_decision: only this Project''s owner and curators can request a decision';
  end if;
  if v_baseline.status <> 'active' then
    raise exception 'request_solution_conformance_decision: decisions are made over an active baseline';
  end if;
  if p_decision_type is null or p_decision_type not in ('presales_claim_validation', 'factory_acceptance', 'site_acceptance', 'customer_acceptance', 'go_live', 'post_change_reverification') then
    raise exception 'request_solution_conformance_decision: choose the kind of decision';
  end if;
  if p_approval_type is null or p_approval_type not in ('technical', 'security_compliance', 'customer_acceptance', 'production_change') then
    raise exception 'request_solution_conformance_decision: choose who must approve it';
  end if;
  select * into v_policy from project_approval_policies where project_id = v_baseline.project_id and approval_type = p_approval_type;
  if found and v_policy.requirement_status = 'not_applicable' then
    raise exception 'request_solution_conformance_decision: this Project''s approval policy marks that approval type as not applicable';
  end if;
  if exists (select 1 from solution_conformance_decisions d where d.baseline_id = p_baseline_id and d.decision_type = p_decision_type and d.status = 'pending') then
    raise exception 'request_solution_conformance_decision: a decision of this kind is already pending for this baseline';
  end if;

  insert into solution_conformance_decisions (project_id, baseline_id, decision_type, approval_type, request_note, required_approvals, approval_mode, requested_by)
  values (
    v_baseline.project_id, p_baseline_id, p_decision_type, p_approval_type, nullif(trim(p_note), ''),
    greatest(coalesce(v_policy.minimum_approvals, 1), 1), coalesce(v_policy.approval_mode, 'any_authorized'), v_uid
  )
  returning id into v_id;
  return v_id;
end;
$$;

-- One approver's verdict. A reject decides it at once; otherwise it is
-- approved when enough authorized approvers agree (the policy's minimum, or
-- every current holder for 'all_assigned').
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

create or replace function withdraw_solution_conformance_decision(p_decision_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_decision solution_conformance_decisions%rowtype;
begin
  select * into v_decision from solution_conformance_decisions where id = p_decision_id for update;
  if not found or v_uid is null or not (v_decision.requested_by = v_uid or can_curate_project(v_decision.project_id, v_uid)) then
    raise exception 'withdraw_solution_conformance_decision: only the requester or a curator can withdraw a decision request';
  end if;
  if v_decision.status <> 'pending' then
    raise exception 'withdraw_solution_conformance_decision: only a pending decision can be withdrawn';
  end if;
  update solution_conformance_decisions set status = 'withdrawn', decided_at = now() where id = p_decision_id;
end;
$$;

-- Decided waivers and decisions are fixed (the functions above are the only
-- writers; this also holds for the service role).
create or replace function solution_decided_row_before_update()
returns trigger
language plpgsql set search_path = public as $$
begin
  if old.status <> 'pending' then
    raise exception '%: a decided record cannot change', tg_table_name;
  end if;
  return new;
end;
$$;

drop trigger if exists solution_waivers_before_update on solution_waivers;
create trigger solution_waivers_before_update before update on solution_waivers
  for each row execute function solution_decided_row_before_update();
drop trigger if exists solution_conformance_decisions_before_update on solution_conformance_decisions;
create trigger solution_conformance_decisions_before_update before update on solution_conformance_decisions
  for each row execute function solution_decided_row_before_update();

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'holds_project_authority(uuid, uuid, text)',
    'project_self_approval_allowed(uuid, uuid, text)',
    'solution_baseline_is_draft(uuid)',
    'activate_solution_baseline(uuid)',
    'new_solution_baseline_version(uuid)',
    'request_solution_waiver(uuid, uuid, text, text, text, text)',
    'decide_solution_waiver(uuid, boolean, text)',
    'withdraw_solution_waiver(uuid)',
    'solution_baseline_snapshot(uuid)',
    'request_solution_conformance_decision(uuid, text, text, text)',
    'decide_solution_conformance_decision(uuid, boolean, text, text)',
    'withdraw_solution_conformance_decision(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon', fn);
    execute format('grant execute on function %s to authenticated', fn);
  end loop;
end;
$$;

-- RLS ---------------------------------------------------------------------------------
-- Members read everything here. Curators write draft baselines and their
-- items directly (split per command); waivers, decisions and approvals have
-- no write policies -- the functions above are the only writers.

alter table solution_evaluation_baselines enable row level security;
alter table solution_evaluation_baseline_items enable row level security;
alter table solution_waivers enable row level security;
alter table solution_conformance_decisions enable row level security;
alter table solution_conformance_decision_approvals enable row level security;

drop policy if exists "solution_evaluation_baselines_select_member" on solution_evaluation_baselines;
create policy "solution_evaluation_baselines_select_member" on solution_evaluation_baselines
  for select using (is_project_member(project_id, auth.uid()));
drop policy if exists "solution_evaluation_baselines_insert_curator" on solution_evaluation_baselines;
create policy "solution_evaluation_baselines_insert_curator" on solution_evaluation_baselines
  for insert with check (
    can_curate_project(project_id, auth.uid()) and created_by = auth.uid() and status = 'draft' and version = 1 and previous_baseline_id is null
  );
drop policy if exists "solution_evaluation_baselines_update_curator_draft" on solution_evaluation_baselines;
create policy "solution_evaluation_baselines_update_curator_draft" on solution_evaluation_baselines
  for update using (can_curate_project(project_id, auth.uid()) and status = 'draft')
  with check (can_curate_project(project_id, auth.uid()) and status = 'draft');
drop policy if exists "solution_evaluation_baselines_delete_curator_draft" on solution_evaluation_baselines;
create policy "solution_evaluation_baselines_delete_curator_draft" on solution_evaluation_baselines
  for delete using (can_curate_project(project_id, auth.uid()) and status = 'draft');

drop policy if exists "solution_evaluation_baseline_items_select_member" on solution_evaluation_baseline_items;
create policy "solution_evaluation_baseline_items_select_member" on solution_evaluation_baseline_items
  for select using (is_project_member(project_id, auth.uid()));
drop policy if exists "solution_evaluation_baseline_items_insert_curator_draft" on solution_evaluation_baseline_items;
create policy "solution_evaluation_baseline_items_insert_curator_draft" on solution_evaluation_baseline_items
  for insert with check (can_curate_project(project_id, auth.uid()) and solution_baseline_is_draft(baseline_id) and added_by = auth.uid());
drop policy if exists "solution_evaluation_baseline_items_delete_curator_draft" on solution_evaluation_baseline_items;
create policy "solution_evaluation_baseline_items_delete_curator_draft" on solution_evaluation_baseline_items
  for delete using (can_curate_project(project_id, auth.uid()) and solution_baseline_is_draft(baseline_id));

drop policy if exists "solution_waivers_select_member" on solution_waivers;
create policy "solution_waivers_select_member" on solution_waivers
  for select using (is_project_member(project_id, auth.uid()));
drop policy if exists "solution_conformance_decisions_select_member" on solution_conformance_decisions;
create policy "solution_conformance_decisions_select_member" on solution_conformance_decisions
  for select using (is_project_member(project_id, auth.uid()));
drop policy if exists "solution_conformance_decision_approvals_select_member" on solution_conformance_decision_approvals;
create policy "solution_conformance_decision_approvals_select_member" on solution_conformance_decision_approvals
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
