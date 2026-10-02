-- Project creation approval (2026-10-02, Mike). A Project created by a
-- consultant/builder (anyone below platform curator) starts as
-- approval_status 'pending': the creator can work on it fully, but nobody
-- else is let in until a platform admin or a curator approves it -- any
-- curator in Enterprise mode, only the creator's own agency curator
-- (agency_builders) in Builder mode (src/lib/workbench/project-approval.ts).
-- Projects created by a curator/admin, or by the service role
-- (provisionBuilderProject, workstream promotions, seeds), are 'approved'
-- straight away, and every existing Project is backfilled 'approved' by the
-- column default.
--
-- Separate axis from projects.status (draft/active/review/completed) --
-- that's the team's own working lifecycle, which the creator keeps driving
-- while this is pending.
alter table projects add column if not exists approval_status text not null default 'approved'
  check (approval_status in ('pending', 'approved', 'rejected'));
alter table projects add column if not exists approval_decided_by uuid references profiles(id) on delete set null;
alter table projects add column if not exists approval_decided_at timestamptz;
alter table projects add column if not exists approval_decision_reason text;
-- Team members picked in the new-project wizard ({user_id, role}[]) --
-- held here, not in project_members, until approval adds them.
alter table projects add column if not exists pending_members jsonb not null default '[]'::jsonb;

create index if not exists projects_approval_status_pending_idx on projects(owner_id) where approval_status = 'pending';

-- One trigger is the real gate for every write path (RLS-scoped client,
-- service role, and any future one):
--   * a signed-in caller below curator always inserts 'pending', whatever
--     the client sent;
--   * a signed-in caller can never change approval_* themselves -- only the
--     service layer (auth.uid() is null under the service role), after its
--     own agency-curator/admin check, decides;
--   * while not approved the project stays private and members-only, so it
--     can't reach anyone through publication or the platform directory.
create or replace function enforce_project_approval()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and not is_curator_or_admin(auth.uid()) then
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

drop trigger if exists projects_enforce_approval on projects;
create trigger projects_enforce_approval
  before insert or update on projects
  for each row execute function enforce_project_approval();

-- Creator only while pending: no active membership for anyone but the
-- owner until the project is approved (approval itself flips the status
-- first, then adds pending_members).
create or replace function enforce_project_approval_membership()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  p record;
begin
  if new.status <> 'active' then
    return new;
  end if;
  select approval_status, owner_id into p from projects where id = new.project_id;
  if found and p.approval_status <> 'approved' and new.user_id is distinct from p.owner_id then
    raise exception 'This project is awaiting approval -- members can be added once a curator or admin approves it';
  end if;
  return new;
end;
$$;

drop trigger if exists project_members_enforce_approval on project_members;
create trigger project_members_enforce_approval
  before insert or update on project_members
  for each row execute function enforce_project_approval_membership();
