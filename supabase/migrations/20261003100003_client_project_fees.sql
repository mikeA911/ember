-- Client maintenance fees and the platform's share (2026-10-01, Mike).
-- A builder charges each client a maintenance fee (PHP or USD, monthly or
-- annual); the platform owner takes a percentage of it -- 10% by default,
-- set per deployment in settings.builder_billing (a dev house running its
-- own Ember sets its own). Ember doesn't collect payments: these figures
-- are for invoicing builders.
--
-- The builder proposes the fee when requesting the client Project
-- (workstream_promotions.proposed_fee_*); approval records it in
-- client_project_fees with the platform rate in force at that moment, so a
-- later rate change never rewrites what was already agreed. The agency or
-- admin can correct a fee afterwards; that keeps the recorded rate.

alter table workstream_promotions drop constraint if exists workstream_promotions_proposed_fee_complete;
alter table workstream_promotions
  add column if not exists proposed_fee_amount numeric(12, 2) check (proposed_fee_amount >= 0),
  add column if not exists proposed_fee_currency text check (proposed_fee_currency in ('PHP', 'USD')),
  add column if not exists proposed_fee_period text check (proposed_fee_period in ('monthly', 'annual')),
  add constraint workstream_promotions_proposed_fee_complete check (
    (proposed_fee_amount is null and proposed_fee_currency is null and proposed_fee_period is null)
    or (proposed_fee_amount is not null and proposed_fee_currency is not null and proposed_fee_period is not null)
  );

create table if not exists client_project_fees (
  project_id uuid primary key references projects(id) on delete cascade,
  amount numeric(12, 2) not null check (amount >= 0),
  currency text not null check (currency in ('PHP', 'USD')),
  billing_period text not null check (billing_period in ('monthly', 'annual')),
  platform_rate_pct numeric(5, 2) not null check (platform_rate_pct >= 0 and platform_rate_pct <= 100),
  set_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists client_project_fees_set_updated_at on client_project_fees;
create trigger client_project_fees_set_updated_at before update on client_project_fees
  for each row execute function set_updated_at();

-- The platform owner (admin) can be an agency too -- e.g. the owner
-- running the first agency themselves before selling to dev houses.
create or replace function is_builder_agency(builder uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agency_builders ab
    join profiles p on p.id = ab.agency_id
    where ab.builder_id = builder and ab.agency_id = uid and p.role in ('curator', 'admin') and p.is_active = true
  );
$$;

alter table client_project_fees enable row level security;

-- The builder sees the fee on their own client Project; their agency and
-- the admin see and set it.
drop policy if exists "client_project_fees_select_owner_agency_or_admin" on client_project_fees;
create policy "client_project_fees_select_owner_agency_or_admin" on client_project_fees
  for select using (
    is_admin(auth.uid())
    or exists (
      select 1 from projects p
      where p.id = project_id and (p.owner_id = auth.uid() or is_builder_agency(p.owner_id, auth.uid()))
    )
  );

drop policy if exists "client_project_fees_write_agency_or_admin" on client_project_fees;
create policy "client_project_fees_write_agency_or_admin" on client_project_fees
  for all
  using (
    is_admin(auth.uid())
    or exists (select 1 from projects p where p.id = project_id and is_builder_agency(p.owner_id, auth.uid()))
  )
  with check (
    is_admin(auth.uid())
    or exists (select 1 from projects p where p.id = project_id and is_builder_agency(p.owner_id, auth.uid()))
  );
