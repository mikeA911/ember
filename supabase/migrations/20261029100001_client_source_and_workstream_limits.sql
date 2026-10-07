-- Who found the client, and a workstream limit for builders (2026-10-07,
-- Mike).
--
-- Who found the client (projects.client_source) decides how a client
-- Project's maintenance fee is split between Ember and its builder. The two
-- shares on a fee now always add up to 100%:
--   * 'builder' -- the builder found the client. Ember takes its cut
--     (default settings.builder_billing.platformRatePct, 10%) because it
--     keeps the documentation and the builder maintains the project through
--     new workstreams in it; the builder keeps the rest.
--   * 'ember'   -- Ember (the platform owner) found the client. The builder
--     gets their share (default settings.builder_billing.builderSharePct,
--     10%); Ember keeps the rest.
-- Each builder can have their own starting figures (builder_billing_shares:
-- platform_rate_pct for clients they find, share_pct for clients Ember
-- finds), and each fee can still be adjusted per Project. Contract value
-- commission is negotiated outside Ember.
--
-- Workstream limit: a builder's own workspace holds up to 20 workstreams
-- (builder_workstream_limits raises it per builder). Projects created by
-- promotion don't count. A builder asks for more with a reason
-- (builder_workstream_limit_requests) and the platform admin decides.
--
-- Safe to re-run.

-- Who found the client ---------------------------------------------------------

alter table projects add column if not exists client_source text check (client_source in ('builder', 'ember'));

-- Only the service layer (promotion, builder assignment) or a platform
-- admin sets it -- it decides who is paid what.
create or replace function enforce_project_client_source()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin(auth.uid()) and (
    (tg_op = 'INSERT' and new.client_source is not null)
    or (tg_op = 'UPDATE' and new.client_source is distinct from old.client_source)
  ) then
    raise exception 'Only a platform admin can change who found a project''s client';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_enforce_client_source on projects;
create trigger projects_enforce_client_source
  before insert or update on projects
  for each row execute function enforce_project_client_source();

-- Every Project already created by promotion: Ember-found when its builder
-- of record is a platform admin, builder-found otherwise.
update projects p
set client_source = case
  when exists (select 1 from profiles pr where pr.id = coalesce(p.builder_id, p.owner_id) and pr.role = 'admin') then 'ember'
  else 'builder'
end
where p.client_source is null
  and exists (select 1 from workstream_promotions wp where wp.created_project_id = p.id and wp.status = 'approved');

-- Recorded fees move to the new split: the two shares add up to 100%.
update client_project_fees f
set builder_share_pct = 100 - f.platform_rate_pct
from projects p
where p.id = f.project_id and p.client_source = 'builder' and f.builder_share_pct + f.platform_rate_pct <> 100;

update client_project_fees f
set platform_rate_pct = 100 - f.builder_share_pct
from projects p
where p.id = f.project_id and p.client_source = 'ember' and f.builder_share_pct + f.platform_rate_pct <> 100;

-- Per-builder starting figures for both cases. share_pct (the builder's
-- share when Ember found the client) may now be left to the default.
alter table builder_billing_shares alter column share_pct drop not null;
alter table builder_billing_shares
  add column if not exists platform_rate_pct numeric(5, 2) check (platform_rate_pct >= 0 and platform_rate_pct <= 100);

-- Workstream limit ------------------------------------------------------------

create table if not exists builder_workstream_limits (
  builder_id uuid primary key references profiles(id) on delete cascade,
  workstream_limit integer not null check (workstream_limit >= 0),
  set_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists builder_workstream_limits_set_updated_at on builder_workstream_limits;
create trigger builder_workstream_limits_set_updated_at before update on builder_workstream_limits
  for each row execute function set_updated_at();

alter table builder_workstream_limits enable row level security;

drop policy if exists "builder_workstream_limits_select_own_agency_or_admin" on builder_workstream_limits;
create policy "builder_workstream_limits_select_own_agency_or_admin" on builder_workstream_limits
  for select using (builder_id = auth.uid() or is_builder_agency(builder_id, auth.uid()) or is_admin(auth.uid()));

drop policy if exists "builder_workstream_limits_admin_write" on builder_workstream_limits;
create policy "builder_workstream_limits_admin_write" on builder_workstream_limits
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

create table if not exists builder_workstream_limit_requests (
  id uuid primary key default gen_random_uuid(),
  builder_id uuid not null references profiles(id) on delete cascade,
  requested_limit integer not null check (requested_limit > 0),
  reason text not null check (length(trim(reason)) > 0),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  decided_by uuid references profiles(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now()
);

-- One open request per builder.
create unique index if not exists builder_workstream_limit_requests_one_pending_idx
  on builder_workstream_limit_requests(builder_id) where status = 'pending';

alter table builder_workstream_limit_requests enable row level security;

drop policy if exists "builder_workstream_limit_requests_select_own_agency_or_admin" on builder_workstream_limit_requests;
create policy "builder_workstream_limit_requests_select_own_agency_or_admin" on builder_workstream_limit_requests
  for select using (builder_id = auth.uid() or is_builder_agency(builder_id, auth.uid()) or is_admin(auth.uid()));

drop policy if exists "builder_workstream_limit_requests_insert_own" on builder_workstream_limit_requests;
create policy "builder_workstream_limit_requests_insert_own" on builder_workstream_limit_requests
  for insert to authenticated
  with check (builder_id = auth.uid() and status = 'pending' and decided_by is null and decided_at is null);

drop policy if exists "builder_workstream_limit_requests_admin_decide" on builder_workstream_limit_requests;
create policy "builder_workstream_limit_requests_admin_decide" on builder_workstream_limit_requests
  for update using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- A builder's workspace: a builder_lab Project they own that no promotion
-- created (client Projects don't count toward the limit).
create or replace function is_builder_workspace(pid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from projects p
    where p.id = pid
      and p.portfolio_category = 'builder_lab'
      and not exists (select 1 from workstream_promotions wp where wp.created_project_id = p.id and wp.status = 'approved')
  );
$$;

create or replace function builder_workspace_workstream_count(builder uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::integer
  from project_workstreams w
  join projects p on p.id = w.project_id
  where p.owner_id = builder and is_builder_workspace(p.id);
$$;

create or replace function builder_workstream_limit(builder uuid)
returns integer
language sql stable security definer set search_path = public as $$
  select coalesce((select workstream_limit from builder_workstream_limits where builder_id = builder), 20);
$$;

-- The real gate for every path that creates workstreams through a signed-in
-- caller (form, Ember, wizard, cloning, Methods). The service role and
-- platform admins are not limited.
create or replace function enforce_builder_workstream_limit()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_owner uuid;
  v_limit integer;
begin
  if auth.uid() is null or is_admin(auth.uid()) or not is_builder_workspace(new.project_id) then
    return new;
  end if;
  select owner_id into v_owner from projects where id = new.project_id;
  if v_owner is null or is_admin(v_owner) then
    return new;
  end if;
  v_limit := builder_workstream_limit(v_owner);
  if builder_workspace_workstream_count(v_owner) >= v_limit then
    raise exception 'Workstream limit reached: this workspace can hold % workstreams. Ask for more from the New Workstream page.', v_limit;
  end if;
  return new;
end;
$$;

drop trigger if exists project_workstreams_enforce_builder_limit on project_workstreams;
create trigger project_workstreams_enforce_builder_limit
  before insert on project_workstreams
  for each row execute function enforce_builder_workstream_limit();

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
