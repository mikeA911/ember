-- Builder agencies (2026-10-01, Mike): in Ember Builder the platform owner
-- is the admin, each builder agency is a curator account, and each builder
-- is a consultant account. This roster says which agency a builder works
-- under, so the agency dashboard (/agency) shows a curator only their own
-- builders, and the admin sees every agency's.
--
-- One agency per builder (builder_id is the primary key). The admin assigns
-- builders; the service layer (src/lib/workbench/agency-dashboard.ts)
-- checks that the agency is a curator and the builder a consultant, so the
-- table itself only enforces the shape.
create table if not exists agency_builders (
  builder_id uuid primary key references profiles(id) on delete cascade,
  agency_id uuid not null references profiles(id) on delete cascade,
  assigned_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (builder_id <> agency_id)
);

create index if not exists agency_builders_agency_id_idx on agency_builders(agency_id);

drop trigger if exists agency_builders_set_updated_at on agency_builders;
create trigger agency_builders_set_updated_at before update on agency_builders
  for each row execute function set_updated_at();

alter table agency_builders enable row level security;

-- An agency sees its own roster, a builder sees which agency they're under,
-- the admin sees everything.
drop policy if exists "agency_builders_select_own_or_admin" on agency_builders;
create policy "agency_builders_select_own_or_admin" on agency_builders
  for select using (
    agency_id = auth.uid()
    or builder_id = auth.uid()
    or is_admin(auth.uid())
  );

drop policy if exists "agency_builders_admin_write" on agency_builders;
create policy "agency_builders_admin_write" on agency_builders
  for all using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
