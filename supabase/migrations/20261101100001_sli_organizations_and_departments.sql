-- Ember SLI, S2: tenant and departments
-- (docs/architecture-decisions/ADR-0005-ember-sli-tenant-ready.md,
-- docs/dev-request-sandz-sli-discovery-and-triggers.md §3 and §9).
--
-- organizations is the tenant. Every sli_ table carries organization_id,
-- and every SLI function resolves the caller's organisation itself (never
-- from client input) and checks active membership before anything else.
-- The first deployment (ember-sli) has one organisation; a person may
-- belong to several.
--
-- Departments are data, not code: Sandz's Discovery team, Marketing,
-- Sales, Presales, Engineering, Project Delivery and Maintenance & Support
-- are rows created by scripts/sli-setup.mjs. One department per
-- organisation is the Discovery team (management): its members see every
-- Trigger and its research; members with can_sponsor accept Triggers and
-- sponsor them.
--
-- No client reads or writes these tables directly: RLS is on with no
-- policies and grants are revoked from anon and authenticated. Pages call
-- the security-definer functions, which return small JSON DTOs. Safe to
-- re-run.

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$'),
  name text not null check (length(trim(name)) between 1 and 200),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Tenant role: owner and admin manage the organisation's SLI setup (later
-- stages); member is everyone else. is_default picks the organisation a
-- person works in when they belong to more than one.
create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'inactive')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create index if not exists organization_members_user_idx on organization_members(user_id);
create unique index if not exists organization_members_one_default_idx on organization_members(user_id) where is_default;

-- Per-organisation SLI configuration: what the module is called (Sandz:
-- "Ember Sandz", byline "Solution Lifecycle Intelligence"), who sees other
-- people's Triggers, and the Trigger code counter (TRG-001, TRG-002, ...).
create table if not exists sli_settings (
  organization_id uuid primary key references organizations(id) on delete cascade,
  product_name text not null default 'Ember SLI' check (length(trim(product_name)) between 1 and 80),
  byline text not null default 'Solution Lifecycle Intelligence' check (length(byline) <= 120),
  trigger_visibility text not null default 'all_members' check (trigger_visibility in ('own', 'all_members')),
  next_trigger_number integer not null default 1 check (next_trigger_number > 0),
  updated_at timestamptz not null default now()
);

create table if not exists sli_departments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  code text not null check (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  name text not null check (length(trim(name)) between 1 and 120),
  is_discovery_team boolean not null default false,
  -- Can receive a handoff from Discovery (Marketing, Presales, Engineering,
  -- Sales, Project Delivery). Used from S3.
  accepts_handoffs boolean not null default false,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create unique index if not exists sli_departments_one_discovery_team_idx on sli_departments(organization_id) where is_discovery_team;

-- A department member must be a member of the same organisation (the
-- composite keys make a cross-tenant row impossible).
create table if not exists sli_department_members (
  organization_id uuid not null,
  department_id uuid not null,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null default 'member' check (role in ('lead', 'member')),
  can_sponsor boolean not null default false,
  status text not null default 'active' check (status in ('active', 'inactive')),
  created_at timestamptz not null default now(),
  primary key (department_id, user_id),
  foreign key (organization_id, department_id) references sli_departments(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references organization_members(organization_id, user_id) on delete cascade
);

create index if not exists sli_department_members_user_idx on sli_department_members(user_id, organization_id);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'organizations_updated_at') then
    create trigger organizations_updated_at before update on organizations
      for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sli_settings_updated_at') then
    create trigger sli_settings_updated_at before update on sli_settings
      for each row execute function set_updated_at();
  end if;
end;
$$;

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table sli_settings enable row level security;
alter table sli_departments enable row level security;
alter table sli_department_members enable row level security;
revoke all on organizations, organization_members, sli_settings, sli_departments, sli_department_members from anon, authenticated;

-- Internal helpers ----------------------------------------------------------------
-- Not callable by API roles: each answers a question about any user, so
-- only the SLI functions below (which run as their owner) use them.

-- Active member of an active organisation, with an active profile.
create or replace function sli_is_org_member(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
    from organization_members m
    join organizations o on o.id = m.organization_id
    join profiles p on p.id = m.user_id
    where m.organization_id = p_org and m.user_id = p_user
      and m.status = 'active' and o.status = 'active' and p.is_active
  );
$$;

-- Active member of at least one active department of the organisation.
create or replace function sli_is_department_member(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sli_is_org_member(p_org, p_user) and exists (
    select 1
    from sli_department_members dm
    join sli_departments d on d.id = dm.department_id
    where dm.organization_id = p_org and dm.user_id = p_user and dm.status = 'active' and d.is_active
  );
$$;

create or replace function sli_is_discovery_member(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sli_is_org_member(p_org, p_user) and exists (
    select 1
    from sli_department_members dm
    join sli_departments d on d.id = dm.department_id
    where dm.organization_id = p_org and dm.user_id = p_user and dm.status = 'active'
      and d.is_active and d.is_discovery_team
  );
$$;

create or replace function sli_can_sponsor(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select sli_is_org_member(p_org, p_user) and exists (
    select 1
    from sli_department_members dm
    join sli_departments d on d.id = dm.department_id
    where dm.organization_id = p_org and dm.user_id = p_user and dm.status = 'active'
      and d.is_active and d.is_discovery_team and dm.can_sponsor
  );
$$;

-- The organisation the person is working in: their default membership,
-- else their earliest active one. Null when they belong to none.
create or replace function sli_active_organization(p_user uuid)
returns uuid
language sql stable security definer set search_path = public as $$
  select m.organization_id
  from organization_members m
  join organizations o on o.id = m.organization_id
  join profiles p on p.id = m.user_id
  where m.user_id = p_user and m.status = 'active' and o.status = 'active' and p.is_active
  order by m.is_default desc, m.created_at, m.organization_id
  limit 1;
$$;

create or replace function sli_display_name(p_user uuid)
returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(trim(full_name), ''), email, 'Former member') from profiles where id = p_user;
$$;

-- The signed-in caller, with an active profile. Errors meant for the
-- person use SQLSTATE EC101 (shown as written); 42501 is "no access".
create or replace function sli_actor()
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from profiles where id = v_actor and is_active) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;

-- Same, for anything that writes: an external MCP client token is
-- read-only (20261005100001_external_mcp_access.sql), and these functions
-- run past its restrictive policies.
create or replace function sli_writer()
returns uuid
language plpgsql stable security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'An external client cannot change SLI records' using errcode = '42501';
  end if;
  return sli_actor();
end;
$$;

revoke all on function sli_is_org_member(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_is_department_member(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_is_discovery_member(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_can_sponsor(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_active_organization(uuid) from public, anon, authenticated;
revoke all on function sli_display_name(uuid) from public, anon, authenticated;
revoke all on function sli_actor() from public, anon, authenticated;
revoke all on function sli_writer() from public, anon, authenticated;

-- API ----------------------------------------------------------------------------

-- What the SLI shell needs about the caller: their organisation, the
-- module's name, their departments and what they may do in Discovery.
-- Null when they belong to no organisation. A platform admin who is not a
-- member sees the first active organisation, flagged as admin access.
create or replace function sli_context()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_active_organization(v_actor);
  v_admin boolean := is_admin(v_actor);
  v_result jsonb;
begin
  if v_org is null and v_admin then
    select id into v_org from organizations where status = 'active' order by created_at, id limit 1;
  end if;
  if v_org is null then
    return null;
  end if;

  select jsonb_build_object(
    'organizationId', o.id,
    'organizationName', o.name,
    'productName', coalesce(s.product_name, 'Ember SLI'),
    'byline', coalesce(s.byline, 'Solution Lifecycle Intelligence'),
    'triggerVisibility', coalesce(s.trigger_visibility, 'all_members'),
    'isMember', sli_is_org_member(o.id, v_actor),
    'isDepartmentMember', sli_is_department_member(o.id, v_actor),
    'isDiscoveryMember', sli_is_discovery_member(o.id, v_actor),
    'canSponsor', sli_can_sponsor(o.id, v_actor),
    'isPlatformAdmin', v_admin,
    'departments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', d.id, 'code', d.code, 'name', d.name, 'role', dm.role,
        'canSponsor', dm.can_sponsor, 'isDiscoveryTeam', d.is_discovery_team
      ) order by d.sort_order, d.name)
      from sli_department_members dm
      join sli_departments d on d.id = dm.department_id
      where dm.organization_id = o.id and dm.user_id = v_actor and dm.status = 'active' and d.is_active
    ), '[]'::jsonb)
  )
  into v_result
  from organizations o
  left join sli_settings s on s.organization_id = o.id
  where o.id = v_org;

  return v_result;
end;
$$;

revoke all on function sli_context() from public, anon;
grant execute on function sli_context() to authenticated;

-- External MCP read-only guarantee, guarded so this migration also applies
-- before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
