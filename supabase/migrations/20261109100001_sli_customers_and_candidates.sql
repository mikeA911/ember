-- Ember SLI, S3 part 3: the customer core, candidate customers and Targeting
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §7 "Candidate
-- customers", and the customer core of
-- docs/dev-request-sandz-sli-customer-and-contact-registry.md §4–§6).
--
-- Customer core (per organisation): companies with group links
-- (conglomerates), dated assignments (account rep in Sales, ISR owner in
-- Marketing, account owner), Discovery's rankings (Top 1000, BSP) and a
-- technology profile (what each customer runs: the basis for "existing
-- customers who would fit"). Duplicate checks on create: same domain is
-- blocked, same main phone needs a reason, similar names are shown.
-- Contacts, tags, notes, merge and the Zoho import follow in S4.
--
-- Candidate customers: the Discovery team adds companies to a Trigger in
-- tiers (existing customer, related company, new prospect) with a fit
-- rationale; trimmed candidates keep their reason. The list is settled in
-- the new Targeting stage (Approved -> Targeting). A handoff to a
-- department that requires candidates (Marketing) needs at least one
-- accepted candidate; to Presales or Sales they are optional. Every
-- handoff carries a snapshot of the accepted candidates, each with its
-- current account rep.
--
-- Safe to re-run.

-- Departments that need candidates in a handoff (Sandz: Marketing).
alter table sli_departments add column if not exists requires_candidates boolean not null default false;
update sli_departments set requires_candidates = true where code = 'marketing' and not requires_candidates;

-- Normalisation used for duplicate checks.
create or replace function sli_normalize_name(p text)
returns text
language sql immutable as $$
  select nullif(trim(regexp_replace(
    regexp_replace(
      regexp_replace(lower(coalesce(p, '')), '[^a-z0-9 ]', ' ', 'g'),
      '\m(incorporated|inc|corporation|corp|company|co|limited|ltd|philippines|phils|phil|ph|the)\M', ' ', 'g'),
    '\s+', ' ', 'g')), '');
$$;

create or replace function sli_normalize_domain(p text)
returns text
language sql immutable as $$
  select nullif(split_part(split_part(regexp_replace(regexp_replace(lower(trim(coalesce(p, ''))), '^[a-z]+://', ''), '^www\.', ''), '/', 1), ':', 1), '');
$$;

-- Digits only; a +63 or 63 prefix becomes the local 0.
create or replace function sli_normalize_phone(p text)
returns text
language sql immutable as $$
  select nullif(case
    when d like '63%' and length(d) >= 11 then '0' || substr(d, 3)
    else d
  end, '')
  from (select regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g') as d) x;
$$;

create table if not exists sli_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null check (length(trim(name)) between 2 and 200),
  normalized_name text generated always as (sli_normalize_name(name)) stored,
  website text check (length(website) <= 300),
  domain text generated always as (sli_normalize_domain(website)) stored,
  main_phone text check (length(main_phone) <= 40),
  main_phone_normalized text generated always as (sli_normalize_phone(main_phone)) stored,
  industry text check (length(industry) <= 100),
  sub_industry text check (length(sub_industry) <= 100),
  region text check (length(region) <= 100),
  parent_customer_id uuid,
  lifecycle_status text check (length(lifecycle_status) <= 60),
  priority text check (priority in ('low', 'medium', 'high')),
  information_sensitivity text not null default 'internal' check (information_sensitivity in ('public', 'internal', 'confidential', 'restricted')),
  source text not null default 'manual' check (source in ('manual', 'zoho_import', 'discovery')),
  duplicate_override_reason text check (length(duplicate_override_reason) <= 1000),
  archived_at timestamptz,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, parent_customer_id) references sli_customers(organization_id, id),
  check (parent_customer_id is distinct from id)
);

create unique index if not exists sli_customers_domain_idx on sli_customers(organization_id, domain) where domain is not null and archived_at is null;
create index if not exists sli_customers_name_idx on sli_customers(organization_id, normalized_name);
create index if not exists sli_customers_phone_idx on sli_customers(organization_id, main_phone_normalized);
create index if not exists sli_customers_parent_idx on sli_customers(parent_customer_id);

create table if not exists sli_customer_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  role text not null check (role in ('account_rep', 'isr_owner', 'account_owner')),
  user_id uuid not null references profiles(id),
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  assigned_by uuid references profiles(id),
  foreign key (organization_id, customer_id) references sli_customers(organization_id, id) on delete cascade
);

create unique index if not exists sli_customer_assignments_current_idx on sli_customer_assignments(customer_id, role) where valid_to is null;

create table if not exists sli_customer_rankings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  ranking_type text not null check (ranking_type in ('top1000', 'bsp')),
  rank_value integer not null check (rank_value > 0),
  as_of date,
  source text check (length(source) <= 200),
  source_reference text check (length(source_reference) <= 1000),
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references sli_customers(organization_id, id) on delete cascade
);

create index if not exists sli_customer_rankings_customer_idx on sli_customer_rankings(customer_id, ranking_type, recorded_at desc);

create table if not exists sli_customer_technologies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  category text not null check (category in ('virtualisation', 'storage', 'backup_dr', 'cloud', 'network', 'security', 'database', 'other')),
  vendor text not null check (length(trim(vendor)) between 1 and 100),
  product text check (length(product) <= 100),
  status text not null default 'in_use' check (status in ('in_use', 'evaluating', 'replacing', 'retired')),
  supplied_by_sandz boolean not null default false,
  scale text check (length(scale) <= 200),
  renewal_date date,
  notes text check (length(notes) <= 2000),
  recorded_by uuid references profiles(id),
  recorded_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references sli_customers(organization_id, id) on delete cascade
);

create index if not exists sli_customer_technologies_customer_idx on sli_customer_technologies(customer_id);

create table if not exists sli_trigger_candidate_customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  trigger_id uuid not null,
  customer_id uuid not null,
  tier text not null check (tier in ('existing_customer', 'related_company', 'new_prospect')),
  relationship_path text check (length(relationship_path) <= 500),
  solution_fit text not null default 'unknown' check (solution_fit in ('strong', 'partial', 'poor', 'unknown')),
  fit_rationale text not null check (length(trim(fit_rationale)) between 3 and 4000),
  priority text check (priority in ('low', 'medium', 'high')),
  target_industry text check (length(target_industry) <= 100),
  target_sub_industry text check (length(target_sub_industry) <= 100),
  known_relationships text check (length(known_relationships) <= 2000),
  evidence_reference text check (length(evidence_reference) <= 2000),
  status text not null default 'accepted' check (status in ('proposed', 'accepted', 'removed')),
  trimmed_reason text check (length(trimmed_reason) <= 1000),
  created_via text not null default 'manual' check (created_via in ('manual', 'assistant')),
  added_by uuid not null references profiles(id),
  accepted_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, trigger_id) references sli_triggers(organization_id, id) on delete cascade,
  foreign key (organization_id, customer_id) references sli_customers(organization_id, id),
  unique (trigger_id, customer_id),
  check (status <> 'removed' or trimmed_reason is not null)
);

alter table sli_handoffs add column if not exists candidates jsonb not null default '[]';

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'sli_customers_updated_at') then
    create trigger sli_customers_updated_at before update on sli_customers for each row execute function set_updated_at();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'sli_trigger_candidate_customers_updated_at') then
    create trigger sli_trigger_candidate_customers_updated_at before update on sli_trigger_candidate_customers for each row execute function set_updated_at();
  end if;
end;
$$;

alter table sli_customers enable row level security;
alter table sli_customer_assignments enable row level security;
alter table sli_customer_rankings enable row level security;
alter table sli_customer_technologies enable row level security;
alter table sli_trigger_candidate_customers enable row level security;
revoke all on sli_customers, sli_customer_assignments, sli_customer_rankings, sli_customer_technologies, sli_trigger_candidate_customers from anon, authenticated;

-- Internal ------------------------------------------------------------------------

create or replace function sli_caller_org()
returns uuid
language sql stable security definer set search_path = public as $$
  select coalesce(sli_active_organization(auth.uid()),
    case when is_admin(auth.uid()) then (select id from organizations where status = 'active' order by created_at, id limit 1) end);
$$;

-- Read: any department member (and platform admins). Edit: Marketing,
-- Sales and the Discovery team (Discovery adds new prospects in
-- Targeting).
create or replace function sli_can_read_customers(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_user) or sli_is_department_member(p_org, p_user);
$$;

create or replace function sli_can_edit_customers(p_org uuid, p_user uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(p_user) or sli_is_discovery_member(p_org, p_user) or exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.organization_id = p_org and dm.user_id = p_user and dm.status = 'active' and d.is_active and d.code in ('marketing', 'sales')
      and sli_is_org_member(p_org, p_user)
  );
$$;

create or replace function sli_current_assignee(p_customer uuid, p_role text)
returns uuid
language sql stable security definer set search_path = public as $$
  select user_id from sli_customer_assignments where customer_id = p_customer and role = p_role and valid_to is null;
$$;

create or replace function sli_customer_brief(p_customer sli_customers)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_customer.id, 'name', p_customer.name, 'domain', p_customer.domain, 'industry', p_customer.industry,
    'subIndustry', p_customer.sub_industry,
    'group', (select name from sli_customers where id = p_customer.parent_customer_id),
    'accountRep', (select sli_display_name(sli_current_assignee(p_customer.id, 'account_rep'))),
    'top1000', (select rank_value from sli_customer_rankings where customer_id = p_customer.id and ranking_type = 'top1000' order by recorded_at desc limit 1),
    'bsp', (select rank_value from sli_customer_rankings where customer_id = p_customer.id and ranking_type = 'bsp' order by recorded_at desc limit 1)
  );
$$;

-- Accepted candidates as a handoff carries them: with the account rep at
-- the time of the handoff.
create or replace function sli_candidate_snapshot(p_trigger uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(sli_customer_brief(c) || jsonb_build_object(
    'tier', k.tier, 'solutionFit', k.solution_fit, 'fitRationale', k.fit_rationale, 'priority', k.priority,
    'relationshipPath', k.relationship_path, 'targetIndustry', k.target_industry, 'knownRelationships', k.known_relationships
  ) order by k.tier, k.priority desc nulls last, c.name), '[]'::jsonb)
  from sli_trigger_candidate_customers k join sli_customers c on c.id = k.customer_id
  where k.trigger_id = p_trigger and k.status = 'accepted';
$$;

revoke all on function sli_caller_org() from public, anon, authenticated;
revoke all on function sli_can_read_customers(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_can_edit_customers(uuid, uuid) from public, anon, authenticated;
revoke all on function sli_current_assignee(uuid, text) from public, anon, authenticated;
revoke all on function sli_customer_brief(sli_customers) from public, anon, authenticated;
revoke all on function sli_candidate_snapshot(uuid) from public, anon, authenticated;

-- API: customers ---------------------------------------------------------------

-- Possible duplicates for a new or edited company, with the reason for each.
create or replace function sli_find_customer_duplicates(p_name text, p_website text default null, p_phone text default null, p_exclude uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_caller_org();
  v_name text := sli_normalize_name(p_name);
  v_domain text := sli_normalize_domain(p_website);
  v_phone text := sli_normalize_phone(p_phone);
begin
  if v_org is null or not sli_can_read_customers(v_org, v_actor) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name, 'domain', c.domain, 'reason', x.reason, 'strength', x.strength)
      order by x.rank, c.name)
    from sli_customers c
    cross join lateral (
      select * from (values
        (v_domain is not null and c.domain = v_domain, 'Same website domain', 'blocking', 1),
        (v_phone is not null and length(v_phone) >= 7 and c.main_phone_normalized = v_phone, 'Same main phone number', 'warning', 2),
        (v_name is not null and c.normalized_name is not null and (c.normalized_name = v_name
          or (length(v_name) >= 4 and length(c.normalized_name) >= 4 and (c.normalized_name like '%' || v_name || '%' or v_name like '%' || c.normalized_name || '%'))),
          'Similar name', 'possible', 3)
      ) as r(hit, reason, strength, rank)
      where r.hit
      order by r.rank
      limit 1
    ) x
    where c.organization_id = v_org and c.archived_at is null and c.id is distinct from p_exclude
  ), '[]'::jsonb);
end;
$$;

-- Create (p_id null) or update a company. A same-domain company is
-- refused; a same-phone one needs p_override_reason.
create or replace function sli_save_customer(
  p_id uuid,
  p_name text,
  p_website text default null,
  p_main_phone text default null,
  p_industry text default null,
  p_sub_industry text default null,
  p_region text default null,
  p_parent_id uuid default null,
  p_lifecycle_status text default null,
  p_priority text default null,
  p_override_reason text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
  v_existing sli_customers;
  v_dup record;
  v_id uuid;
begin
  if v_org is null or not sli_can_edit_customers(v_org, v_actor) then
    raise exception 'Only Marketing, Sales and the Discovery team can edit companies' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'Give the company name' using errcode = 'EC101';
  end if;
  if p_id is not null then
    select * into v_existing from sli_customers where id = p_id and organization_id = v_org for update;
    if not found then
      raise exception 'Company not found' using errcode = '42501';
    end if;
  end if;
  if p_parent_id is not null and not exists (select 1 from sli_customers where id = p_parent_id and organization_id = v_org and archived_at is null) then
    raise exception 'Choose a group from this organisation''s companies' using errcode = 'EC101';
  end if;
  if p_parent_id is not null and p_parent_id = p_id then
    raise exception 'A company can''t be its own group' using errcode = 'EC101';
  end if;

  select * into v_dup from sli_customers c
  where c.organization_id = v_org and c.archived_at is null and c.id is distinct from p_id
    and sli_normalize_domain(p_website) is not null and c.domain = sli_normalize_domain(p_website)
  limit 1;
  if found then
    raise exception '% already uses this website (%). Open that company instead.', v_dup.name, v_dup.domain using errcode = 'EC101';
  end if;
  select * into v_dup from sli_customers c
  where c.organization_id = v_org and c.archived_at is null and c.id is distinct from p_id
    and length(coalesce(sli_normalize_phone(p_main_phone), '')) >= 7 and c.main_phone_normalized = sli_normalize_phone(p_main_phone)
  limit 1;
  if found and nullif(trim(coalesce(p_override_reason, '')), '') is null then
    raise exception '% has the same main phone number. Give a reason to save anyway.', v_dup.name using errcode = 'EC101';
  end if;

  if p_id is null then
    insert into sli_customers (organization_id, name, website, main_phone, industry, sub_industry, region, parent_customer_id,
      lifecycle_status, priority, source, duplicate_override_reason, created_by, updated_by)
    values (v_org, trim(p_name), nullif(trim(coalesce(p_website, '')), ''), nullif(trim(coalesce(p_main_phone, '')), ''),
      nullif(trim(coalesce(p_industry, '')), ''), nullif(trim(coalesce(p_sub_industry, '')), ''), nullif(trim(coalesce(p_region, '')), ''),
      p_parent_id, nullif(trim(coalesce(p_lifecycle_status, '')), ''), nullif(p_priority, ''),
      case when sli_is_discovery_member(v_org, v_actor) then 'discovery' else 'manual' end,
      nullif(trim(coalesce(p_override_reason, '')), ''), v_actor, v_actor)
    returning id into v_id;
  else
    update sli_customers set name = trim(p_name), website = nullif(trim(coalesce(p_website, '')), ''),
      main_phone = nullif(trim(coalesce(p_main_phone, '')), ''), industry = nullif(trim(coalesce(p_industry, '')), ''),
      sub_industry = nullif(trim(coalesce(p_sub_industry, '')), ''), region = nullif(trim(coalesce(p_region, '')), ''),
      parent_customer_id = p_parent_id, lifecycle_status = nullif(trim(coalesce(p_lifecycle_status, '')), ''),
      priority = nullif(p_priority, ''), duplicate_override_reason = coalesce(nullif(trim(coalesce(p_override_reason, '')), ''), duplicate_override_reason),
      updated_by = v_actor
    where id = p_id returning id into v_id;
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- Companies in the caller's organisation: by name, domain or phone, and
-- optionally by what they run (vendor or product in the technology
-- profile, for example "VMware").
create or replace function sli_list_customers(p_search text default null, p_technology text default null, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_caller_org();
  v_search text := nullif(trim(coalesce(p_search, '')), '');
  v_tech text := nullif(trim(coalesce(p_technology, '')), '');
begin
  if v_org is null or not sli_can_read_customers(v_org, v_actor) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(sli_customer_brief(c) || jsonb_build_object(
      'technologies', coalesce((
        select jsonb_agg(t.vendor || coalesce(' ' || t.product, '') order by t.category)
        from sli_customer_technologies t where t.customer_id = c.id and t.status in ('in_use', 'evaluating', 'replacing')
      ), '[]'::jsonb)
    ) order by c.name)
    from sli_customers c
    where c.id in (
      select c2.id from sli_customers c2
      where c2.organization_id = v_org and c2.archived_at is null
        and (v_search is null or c2.name ilike '%' || v_search || '%' or c2.domain ilike '%' || v_search || '%'
          or c2.main_phone_normalized = sli_normalize_phone(v_search))
        and (v_tech is null or exists (
          select 1 from sli_customer_technologies t
          where t.customer_id = c2.id and t.status in ('in_use', 'evaluating', 'replacing')
            and (t.vendor ilike '%' || v_tech || '%' or t.product ilike '%' || v_tech || '%')
        ))
      order by c2.name
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    )
  ), '[]'::jsonb);
end;
$$;

create or replace function sli_get_customer(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_caller_org();
  v_customer sli_customers;
begin
  if v_org is null or not sli_can_read_customers(v_org, v_actor) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  select * into v_customer from sli_customers where id = p_id and organization_id = v_org;
  if not found then
    return null;
  end if;
  return sli_customer_brief(v_customer) || jsonb_build_object(
    'website', v_customer.website, 'mainPhone', v_customer.main_phone, 'region', v_customer.region,
    'parentId', v_customer.parent_customer_id, 'lifecycleStatus', v_customer.lifecycle_status, 'priority', v_customer.priority,
    'source', v_customer.source, 'archived', v_customer.archived_at is not null,
    'canEdit', sli_can_edit_customers(v_org, v_actor),
    'canAssign', jsonb_build_object(
      'account_rep', is_admin(v_actor) or exists (select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
        where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and dm.role = 'lead' and d.code = 'sales'),
      'isr_owner', is_admin(v_actor) or exists (select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
        where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and dm.role = 'lead' and d.code = 'marketing'),
      'account_owner', is_admin(v_actor) or exists (select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
        where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and dm.role = 'lead' and d.code in ('marketing', 'sales'))
    ),
    'assignments', coalesce((
      select jsonb_agg(jsonb_build_object('role', a.role, 'userId', a.user_id, 'name', sli_display_name(a.user_id),
        'from', a.valid_from, 'to', a.valid_to) order by a.valid_from desc)
      from sli_customer_assignments a where a.customer_id = v_customer.id
    ), '[]'::jsonb),
    'rankings', coalesce((
      select jsonb_agg(jsonb_build_object('type', r.ranking_type, 'rank', r.rank_value, 'asOf', r.as_of, 'source', r.source,
        'reference', r.source_reference, 'recordedBy', sli_display_name(r.recorded_by), 'recordedAt', r.recorded_at) order by r.recorded_at desc)
      from sli_customer_rankings r where r.customer_id = v_customer.id
    ), '[]'::jsonb),
    'technologies', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'category', t.category, 'vendor', t.vendor, 'product', t.product, 'status', t.status,
        'suppliedBySandz', t.supplied_by_sandz, 'scale', t.scale, 'renewalDate', t.renewal_date, 'notes', t.notes) order by t.category, t.vendor)
      from sli_customer_technologies t where t.customer_id = v_customer.id
    ), '[]'::jsonb),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.name)
      from sli_customers m where m.parent_customer_id = v_customer.id and m.archived_at is null
    ), '[]'::jsonb),
    'triggers', coalesce((
      select jsonb_agg(jsonb_build_object('code', t.code, 'title', t.title, 'stage', t.stage, 'tier', k.tier, 'status', k.status) order by t.code)
      from sli_trigger_candidate_customers k join sli_triggers t on t.id = k.trigger_id
      where k.customer_id = v_customer.id and sli_trigger_access(t, v_actor) = 'full'
    ), '[]'::jsonb),
    'salesMembers', coalesce((
      select jsonb_agg(jsonb_build_object('userId', dm.user_id, 'name', sli_display_name(dm.user_id), 'department', d.code) order by d.code, sli_display_name(dm.user_id))
      from sli_department_members dm join sli_departments d on d.id = dm.department_id
      where dm.organization_id = v_org and dm.status = 'active' and d.code in ('sales', 'marketing') and d.is_active
    ), '[]'::jsonb)
  );
end;
$$;

-- Assign (or end, with p_user null) the current account rep (a Sales
-- member, by a Sales lead), ISR owner (Marketing, by a Marketing lead) or
-- account owner (by a Marketing or Sales lead). History is kept.
create or replace function sli_assign_customer(p_customer uuid, p_role text, p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
  v_codes text[] := case p_role when 'account_rep' then array['sales'] when 'isr_owner' then array['marketing'] when 'account_owner' then array['marketing', 'sales'] end;
begin
  if v_codes is null then
    raise exception 'Unknown role' using errcode = 'EC101';
  end if;
  if not exists (select 1 from sli_customers where id = p_customer and organization_id = v_org) then
    raise exception 'Company not found' using errcode = '42501';
  end if;
  if not (is_admin(v_actor) or exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and dm.role = 'lead' and d.code = any (v_codes)
  )) then
    raise exception 'Only a % lead can assign this', array_to_string(v_codes, ' or ') using errcode = '42501';
  end if;
  if p_user is not null and not exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.organization_id = v_org and dm.user_id = p_user and dm.status = 'active' and d.is_active and d.code = any (v_codes)
  ) then
    raise exception 'Choose a member of %', array_to_string(v_codes, ' or ') using errcode = 'EC101';
  end if;

  update sli_customer_assignments set valid_to = now() where customer_id = p_customer and role = p_role and valid_to is null;
  if p_user is not null then
    insert into sli_customer_assignments (organization_id, customer_id, role, user_id, assigned_by)
    values (v_org, p_customer, p_role, p_user, v_actor);
  end if;
  return jsonb_build_object('id', p_customer);
end;
$$;

create or replace function sli_record_customer_ranking(p_customer uuid, p_type text, p_rank integer, p_as_of date, p_source text, p_reference text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
begin
  if not exists (select 1 from sli_customers where id = p_customer and organization_id = v_org) then
    raise exception 'Company not found' using errcode = '42501';
  end if;
  if not (is_admin(v_actor) or sli_is_discovery_member(v_org, v_actor)) then
    raise exception 'Rankings are maintained by the Discovery team' using errcode = '42501';
  end if;
  if p_type not in ('top1000', 'bsp') or coalesce(p_rank, 0) <= 0 then
    raise exception 'Choose the ranking and a rank above zero' using errcode = 'EC101';
  end if;
  insert into sli_customer_rankings (organization_id, customer_id, ranking_type, rank_value, as_of, source, source_reference, recorded_by)
  values (v_org, p_customer, p_type, p_rank, p_as_of, nullif(trim(coalesce(p_source, '')), ''), nullif(trim(coalesce(p_reference, '')), ''), v_actor);
  return jsonb_build_object('id', p_customer);
end;
$$;

-- Add, change (p_id) or remove (p_remove) a technology profile entry.
create or replace function sli_save_customer_technology(
  p_customer uuid, p_id uuid, p_category text, p_vendor text, p_product text, p_status text,
  p_supplied_by_sandz boolean, p_scale text, p_renewal_date date, p_notes text, p_remove boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
begin
  if not exists (select 1 from sli_customers where id = p_customer and organization_id = v_org) then
    raise exception 'Company not found' using errcode = '42501';
  end if;
  if not (sli_can_edit_customers(v_org, v_actor) or exists (
    select 1 from sli_department_members dm join sli_departments d on d.id = dm.department_id
    where dm.organization_id = v_org and dm.user_id = v_actor and dm.status = 'active' and d.code = 'presales'
  )) then
    raise exception 'Only Marketing, Sales, Presales and the Discovery team can edit a technology profile' using errcode = '42501';
  end if;
  if p_remove then
    delete from sli_customer_technologies where id = p_id and customer_id = p_customer;
    return jsonb_build_object('id', p_customer);
  end if;
  if length(trim(coalesce(p_vendor, ''))) = 0 then
    raise exception 'Give the vendor' using errcode = 'EC101';
  end if;
  if p_id is null then
    insert into sli_customer_technologies (organization_id, customer_id, category, vendor, product, status, supplied_by_sandz, scale, renewal_date, notes, recorded_by)
    values (v_org, p_customer, p_category, trim(p_vendor), nullif(trim(coalesce(p_product, '')), ''), coalesce(p_status, 'in_use'),
      coalesce(p_supplied_by_sandz, false), nullif(trim(coalesce(p_scale, '')), ''), p_renewal_date, nullif(trim(coalesce(p_notes, '')), ''), v_actor);
  else
    update sli_customer_technologies set category = p_category, vendor = trim(p_vendor), product = nullif(trim(coalesce(p_product, '')), ''),
      status = coalesce(p_status, 'in_use'), supplied_by_sandz = coalesce(p_supplied_by_sandz, false), scale = nullif(trim(coalesce(p_scale, '')), ''),
      renewal_date = p_renewal_date, notes = nullif(trim(coalesce(p_notes, '')), ''), recorded_by = v_actor, recorded_at = now()
    where id = p_id and customer_id = p_customer;
  end if;
  return jsonb_build_object('id', p_customer);
end;
$$;

-- API: candidate customers ----------------------------------------------------

create or replace function sli_add_candidate_customer(
  p_trigger uuid, p_customer uuid, p_tier text, p_fit_rationale text,
  p_solution_fit text default 'unknown', p_priority text default null, p_relationship_path text default null,
  p_target_industry text default null, p_known_relationships text default null, p_evidence_reference text default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or not (is_admin(v_actor) or sli_is_discovery_member(v_trigger.organization_id, v_actor)) then
    raise exception 'Only the Discovery team can add candidate customers' using errcode = '42501';
  end if;
  if v_trigger.stage not in ('researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting') or v_trigger.archived_at is not null then
    raise exception 'Candidate customers are added during research and Targeting' using errcode = 'EC101';
  end if;
  if not exists (select 1 from sli_customers where id = p_customer and organization_id = v_trigger.organization_id and archived_at is null) then
    raise exception 'Choose a company from the registry, or add it there first' using errcode = 'EC101';
  end if;
  if p_tier not in ('existing_customer', 'related_company', 'new_prospect') then
    raise exception 'Choose the tier' using errcode = 'EC101';
  end if;
  if length(trim(coalesce(p_fit_rationale, ''))) < 3 then
    raise exception 'Say why this company is a candidate' using errcode = 'EC101';
  end if;

  insert into sli_trigger_candidate_customers (organization_id, trigger_id, customer_id, tier, fit_rationale, solution_fit, priority,
    relationship_path, target_industry, known_relationships, evidence_reference, status, added_by, accepted_by)
  values (v_trigger.organization_id, v_trigger.id, p_customer, p_tier, trim(p_fit_rationale), coalesce(nullif(p_solution_fit, ''), 'unknown'),
    nullif(p_priority, ''), nullif(trim(coalesce(p_relationship_path, '')), ''), nullif(trim(coalesce(p_target_industry, '')), ''),
    nullif(trim(coalesce(p_known_relationships, '')), ''), nullif(trim(coalesce(p_evidence_reference, '')), ''), 'accepted', v_actor, v_actor)
  on conflict (trigger_id, customer_id) do update
    set tier = excluded.tier, fit_rationale = excluded.fit_rationale, solution_fit = excluded.solution_fit, priority = excluded.priority,
      relationship_path = excluded.relationship_path, target_industry = excluded.target_industry,
      known_relationships = excluded.known_relationships, evidence_reference = excluded.evidence_reference,
      status = 'accepted', trimmed_reason = null, accepted_by = v_actor;
  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code);
end;
$$;

-- Trim a candidate (keeping why) or bring it back.
create or replace function sli_set_candidate_status(p_candidate uuid, p_status text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_candidate sli_trigger_candidate_customers;
  v_trigger sli_triggers;
begin
  select * into v_candidate from sli_trigger_candidate_customers where id = p_candidate for update;
  if not found then
    raise exception 'Candidate not found' using errcode = '42501';
  end if;
  select * into v_trigger from sli_triggers where id = v_candidate.trigger_id;
  if not (is_admin(v_actor) or sli_is_discovery_member(v_trigger.organization_id, v_actor)) then
    raise exception 'Only the Discovery team can change candidate customers' using errcode = '42501';
  end if;
  if p_status = 'removed' then
    if length(trim(coalesce(p_reason, ''))) < 3 then
      raise exception 'Say why it is being trimmed' using errcode = 'EC101';
    end if;
    update sli_trigger_candidate_customers set status = 'removed', trimmed_reason = trim(p_reason) where id = p_candidate;
  elsif p_status = 'accepted' then
    update sli_trigger_candidate_customers set status = 'accepted', trimmed_reason = null, accepted_by = v_actor where id = p_candidate;
  else
    raise exception 'Unknown status' using errcode = 'EC101';
  end if;
  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code);
end;
$$;

create or replace function sli_list_candidate_customers(p_trigger uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_trigger sli_triggers;
begin
  select * into v_trigger from sli_triggers where id = p_trigger;
  if not found or sli_trigger_access(v_trigger, v_actor) is distinct from 'full' then
    return null;
  end if;
  return jsonb_build_object(
    'canEdit', v_trigger.archived_at is null and v_trigger.stage in ('researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting')
      and (is_admin(v_actor) or sli_is_discovery_member(v_trigger.organization_id, v_actor)),
    'candidates', coalesce((
      select jsonb_agg(sli_customer_brief(c) || jsonb_build_object(
        'candidateId', k.id, 'tier', k.tier, 'solutionFit', k.solution_fit, 'fitRationale', k.fit_rationale, 'priority', k.priority,
        'relationshipPath', k.relationship_path, 'targetIndustry', k.target_industry, 'knownRelationships', k.known_relationships,
        'evidenceReference', k.evidence_reference, 'status', k.status, 'trimmedReason', k.trimmed_reason,
        'addedBy', sli_display_name(k.added_by), 'createdVia', k.created_via
      ) order by case k.status when 'accepted' then 0 when 'proposed' then 1 else 2 end, k.tier, k.priority desc nulls last, c.name)
      from sli_trigger_candidate_customers k join sli_customers c on c.id = k.customer_id
      where k.trigger_id = v_trigger.id
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function sli_find_customer_duplicates(text, text, text, uuid) from public, anon;
revoke all on function sli_save_customer(uuid, text, text, text, text, text, text, uuid, text, text, text) from public, anon;
revoke all on function sli_list_customers(text, text, integer) from public, anon;
revoke all on function sli_get_customer(uuid) from public, anon;
revoke all on function sli_assign_customer(uuid, text, uuid) from public, anon;
revoke all on function sli_record_customer_ranking(uuid, text, integer, date, text, text) from public, anon;
revoke all on function sli_save_customer_technology(uuid, uuid, text, text, text, text, boolean, text, date, text, boolean) from public, anon;
revoke all on function sli_add_candidate_customer(uuid, uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function sli_set_candidate_status(uuid, text, text) from public, anon;
revoke all on function sli_list_candidate_customers(uuid) from public, anon;
grant execute on function sli_find_customer_duplicates(text, text, text, uuid) to authenticated;
grant execute on function sli_save_customer(uuid, text, text, text, text, text, text, uuid, text, text, text) to authenticated;
grant execute on function sli_list_customers(text, text, integer) to authenticated;
grant execute on function sli_get_customer(uuid) to authenticated;
grant execute on function sli_assign_customer(uuid, text, uuid) to authenticated;
grant execute on function sli_record_customer_ranking(uuid, text, integer, date, text, text) to authenticated;
grant execute on function sli_save_customer_technology(uuid, uuid, text, text, text, text, boolean, text, date, text, boolean) to authenticated;
grant execute on function sli_add_candidate_customer(uuid, uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function sli_set_candidate_status(uuid, text, text) to authenticated;
grant execute on function sli_list_candidate_customers(uuid) to authenticated;

-- Updated: Targeting (Approved -> Targeting, and back with a reason), and
-- handoffs carry candidates, required for departments that need them.
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
    ('deferred', 'feasibility', 'revisit', 'discovery', true),
    ('approved', 'targeting', 'start_targeting', 'sponsor', false),
    ('targeting', 'approved', 'step_back', 'sponsor', true)
  ) as t(from_stage, to_stage, action, actor, reason_required)
  where t.from_stage = p_from and t.to_stage = p_to;
$$;

create or replace function sli_trigger_allowed_actions(p_trigger sli_triggers, p_user uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('action', x.action, 'toStage', x.to_stage, 'reasonRequired', x.reason_required)
    order by x.ord), '[]'::jsonb)
  from (
    select t.action, s.to_stage, t.reason_required, s.ord
    from (values ('researching', 1), ('concept', 2), ('feasibility', 3), ('under_review', 4), ('targeting', 5), ('approved', 6), ('declined', 7)) as s(to_stage, ord)
    cross join lateral sli_trigger_transition(p_trigger.stage, s.to_stage) t
    where p_trigger.archived_at is null
      and (
        is_admin(p_user)
        or (t.actor = 'sponsor_pool' and sli_can_sponsor(p_trigger.organization_id, p_user))
        or (t.actor = 'sponsor' and p_trigger.sponsor_id = p_user and sli_is_org_member(p_trigger.organization_id, p_user))
        or (t.actor = 'discovery' and sli_is_discovery_member(p_trigger.organization_id, p_user))
      )
    union all
    select case when p_trigger.archived_at is null then 'archive' else 'unarchive' end, null, p_trigger.archived_at is null, 8
    where is_admin(p_user) or sli_is_discovery_member(p_trigger.organization_id, p_user)
  ) x;
$$;

revoke all on function sli_trigger_allowed_actions(sli_triggers, uuid) from public, anon, authenticated;

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
  if v_trigger.stage not in ('approved', 'targeting') or v_trigger.archived_at is not null then
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

  if (select requires_candidates from sli_departments where id = v_decision.destination_department_id)
    and not exists (select 1 from sli_trigger_candidate_customers where trigger_id = v_trigger.id and status = 'accepted') then
    raise exception 'A handoff to % needs at least one accepted candidate customer. Build the list in Targeting first.',
      (select name from sli_departments where id = v_decision.destination_department_id) using errcode = 'EC101';
  end if;

  select id into v_previous from sli_handoffs
  where trigger_id = v_trigger.id and kind = 'promote' and status = 'returned' order by decided_at desc limit 1;

  insert into sli_handoffs (
    organization_id, trigger_id, kind, decision_id, destination_department_id,
    message, conditions, target_industries, approved_claims, proposed_by, previous_handoff_id, candidates
  ) values (
    v_trigger.organization_id, v_trigger.id, 'promote', v_decision.id, v_decision.destination_department_id,
    nullif(trim(coalesce(p_message, '')), ''), v_decision.conditions,
    nullif(trim(coalesce(p_target_industries, '')), ''), nullif(trim(coalesce(p_approved_claims, '')), ''),
    v_actor, v_previous, sli_candidate_snapshot(v_trigger.id)
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
        'candidates', h.candidates,
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
    'canPropose', p_access = 'full' and p_trigger.stage in ('approved', 'targeting') and p_trigger.archived_at is null
      and (is_admin(p_user) or p_trigger.sponsor_id = p_user)
      and not exists (select 1 from sli_handoffs h where h.trigger_id = p_trigger.id and h.kind = 'promote' and h.status = 'proposed'),
    'proposeTo', case when p_trigger.stage in ('approved', 'targeting') then (
      select jsonb_build_object('departmentId', d.id, 'name', d.name, 'conditions', (sli_current_decision(p_trigger.id)).conditions,
        'requiresCandidates', d.requires_candidates,
        'acceptedCandidates', (select count(*) from sli_trigger_candidate_customers c where c.trigger_id = p_trigger.id and c.status = 'accepted'))
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

revoke all on function sli_trigger_handoff_dto(sli_triggers, text, uuid) from public, anon, authenticated;

-- External MCP read-only guarantee, guarded so this migration also applies
-- before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
