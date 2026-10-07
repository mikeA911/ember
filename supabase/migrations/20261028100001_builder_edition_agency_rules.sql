-- Builder edition agency rules (2026-10-07, Mike). In the Builder edition
-- the platform owner (admin) is the agency for every builder -- an
-- Enterprise deployment can name its own agency later.
--
--   * A builder requests promotion of their own workstream once their
--     client has agreed (client_agreed_at); the agency or the platform
--     admin approves it. A builder's work is never decided by another
--     curator on the same Project -- e.g. a builder they invited.
--   * Only the builder who requested the promotion is paid
--     (projects.builder_id); sharing with the people they invited is up to
--     them. Each builder can have their own share of the maintenance fee
--     (builder_billing_shares); builders without one get the deployment
--     default (settings.builder_billing.builderSharePct). A share is
--     recorded on each fee when the fee is created, so changing it later
--     only affects projects promoted from then on.
--   * Builders already on no agency's roster join the platform admin's,
--     when the deployment has exactly one active admin. New builders are
--     added to it by createUserAction.
--
-- Safe to re-run.

alter table workstream_promotions add column if not exists client_agreed_at timestamptz;

create table if not exists builder_billing_shares (
  builder_id uuid primary key references profiles(id) on delete cascade,
  share_pct numeric(5, 2) not null check (share_pct >= 0 and share_pct <= 100),
  set_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists builder_billing_shares_set_updated_at on builder_billing_shares;
create trigger builder_billing_shares_set_updated_at before update on builder_billing_shares
  for each row execute function set_updated_at();

alter table builder_billing_shares enable row level security;

-- The builder sees their own share, their agency sees its builders', the
-- admin sees all. Only the admin sets them.
drop policy if exists "builder_billing_shares_select_own_agency_or_admin" on builder_billing_shares;
create policy "builder_billing_shares_select_own_agency_or_admin" on builder_billing_shares
  for select using (
    builder_id = auth.uid()
    or is_builder_agency(builder_id, auth.uid())
    or is_admin(auth.uid())
  );

drop policy if exists "builder_billing_shares_admin_write" on builder_billing_shares;
create policy "builder_billing_shares_admin_write" on builder_billing_shares
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));

-- Deciding a promotion: a builder's (builder_lab) work is decided by their
-- agency or the platform admin only; any other Project's own curator
-- decides as before. Never the submitter.
drop policy if exists "workstream_promotions_decide_curator_or_agency" on workstream_promotions;
create policy "workstream_promotions_decide_curator_or_agency" on workstream_promotions
  for update
  using (
    submitted_by != auth.uid()
    and (
      is_admin(auth.uid())
      or is_builder_agency(submitted_by, auth.uid())
      or exists (
        select 1 from project_workstreams w join projects p on p.id = w.project_id
        where w.id = workstream_id
          and p.portfolio_category is distinct from 'builder_lab'
          and can_curate_project(w.project_id, auth.uid())
      )
    )
  )
  with check (
    submitted_by != auth.uid()
    and (
      is_admin(auth.uid())
      or is_builder_agency(submitted_by, auth.uid())
      or exists (
        select 1 from project_workstreams w join projects p on p.id = w.project_id
        where w.id = workstream_id
          and p.portfolio_category is distinct from 'builder_lab'
          and can_curate_project(w.project_id, auth.uid())
      )
    )
  );

-- Requesting a promotion of a builder's work: only the builder of record
-- (builder_id, or the owner before one was recorded) or the platform
-- admin. Any member still submits on other Projects.
drop policy if exists "workstream_promotions_insert_member" on workstream_promotions;
create policy "workstream_promotions_insert_member" on workstream_promotions
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from project_workstreams w join projects p on p.id = w.project_id
      where w.id = workstream_id
        and is_project_member(w.project_id, auth.uid())
        and (
          p.portfolio_category is distinct from 'builder_lab'
          or coalesce(p.builder_id, p.owner_id) = auth.uid()
          or is_admin(auth.uid())
        )
    )
  );

-- Existing builders on no roster join the platform admin's agency.
do $$
declare
  v_admin uuid;
begin
  if (select count(*) from profiles where role = 'admin' and is_active = true) = 1 then
    select id into v_admin from profiles where role = 'admin' and is_active = true;
    insert into agency_builders (builder_id, agency_id, assigned_by)
    select p.id, v_admin, v_admin
    from profiles p
    where p.role = 'consultant'
      and not exists (select 1 from agency_builders ab where ab.builder_id = p.id)
    on conflict (builder_id) do nothing;
  end if;
end $$;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
