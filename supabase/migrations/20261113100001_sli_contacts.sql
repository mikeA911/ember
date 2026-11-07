-- Ember SLI: contacts, and the company profile from Marketing's Lead Form
-- (docs/dev-request-sandz-sli-customer-and-contact-registry.md §4, stage 3).
--
-- Contacts are people, kept apart from companies because people change
-- jobs: a contact has dated links to customers (current and past), each
-- with a job title, department and buying role. Contact methods (email,
-- mobile, ...) carry their own opt-out, and the contact carries marketing
-- consent and do-not-contact, which Marketing's campaigns will enforce.
-- Who may see and change contacts follows the customers: any department
-- member reads, Marketing, Sales and the Discovery team edit.
--
-- The company gains the Lead Form's profile fields: overview, products and
-- services, notable customers, address, size and procurement type.

alter table sli_customers
  add column if not exists company_overview text check (length(company_overview) <= 4000),
  add column if not exists products_services text check (length(products_services) <= 4000),
  add column if not exists notable_customers text check (length(notable_customers) <= 2000),
  add column if not exists address text check (length(address) <= 500),
  add column if not exists employee_count text check (length(employee_count) <= 50),
  add column if not exists procurement_type text check (procurement_type in ('local', 'global_mandate', 'local_and_global'));

create table if not exists sli_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  first_name text not null check (length(trim(first_name)) between 1 and 100),
  last_name text check (length(last_name) <= 100),
  -- From the Lead Form's "Title Description".
  buying_role text check (buying_role in ('decision_maker', 'influencer', 'user', 'other')),
  marketing_consent text not null default 'unknown' check (marketing_consent in ('unknown', 'given', 'withdrawn')),
  consent_recorded_at timestamptz,
  consent_source text check (length(consent_source) <= 200),
  do_not_contact boolean not null default false,
  notes text check (length(notes) <= 4000),
  source text not null default 'manual' check (source in ('manual', 'zoho_import', 'assistant')),
  archived_at timestamptz,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table if not exists sli_contact_methods (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  contact_id uuid not null,
  kind text not null check (kind in ('email', 'mobile', 'landline', 'viber', 'whatsapp', 'linkedin', 'other')),
  value text not null check (length(trim(value)) between 1 and 300),
  normalized_value text not null,
  is_primary boolean not null default false,
  opted_out_at timestamptz,
  foreign key (organization_id, contact_id) references sli_contacts(organization_id, id) on delete cascade,
  unique (contact_id, kind, normalized_value)
);
create index if not exists sli_contact_methods_lookup_idx on sli_contact_methods(organization_id, kind, normalized_value);

create table if not exists sli_customer_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  contact_id uuid not null,
  job_title text check (length(job_title) <= 200),
  department_text text check (length(department_text) <= 200),
  is_primary boolean not null default false,
  started_on date,
  ended_on date,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  foreign key (organization_id, customer_id) references sli_customers(organization_id, id) on delete cascade,
  foreign key (organization_id, contact_id) references sli_contacts(organization_id, id) on delete cascade,
  check (ended_on is null or started_on is null or ended_on >= started_on)
);
create unique index if not exists sli_customer_contacts_current_idx on sli_customer_contacts(customer_id, contact_id) where ended_on is null;
create index if not exists sli_customer_contacts_contact_idx on sli_customer_contacts(contact_id);

drop trigger if exists sli_contacts_set_updated_at on sli_contacts;
create trigger sli_contacts_set_updated_at before update on sli_contacts for each row execute function set_updated_at();

alter table sli_contacts enable row level security;
alter table sli_contact_methods enable row level security;
alter table sli_customer_contacts enable row level security;
revoke all on sli_contacts, sli_contact_methods, sli_customer_contacts from anon, authenticated;

-- Internal ------------------------------------------------------------------------

create or replace function sli_normalize_contact_method(p_kind text, p_value text)
returns text
language sql immutable as $$
  select case
    when p_kind = 'email' then lower(trim(p_value))
    when p_kind in ('mobile', 'landline', 'viber', 'whatsapp') then coalesce(sli_normalize_phone(p_value), lower(trim(p_value)))
    else lower(trim(p_value))
  end;
$$;

create or replace function sli_contact_brief(p_contact sli_contacts)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', p_contact.id,
    'firstName', p_contact.first_name,
    'lastName', p_contact.last_name,
    'name', trim(p_contact.first_name || ' ' || coalesce(p_contact.last_name, '')),
    'buyingRole', p_contact.buying_role,
    'marketingConsent', p_contact.marketing_consent,
    'doNotContact', p_contact.do_not_contact,
    'methods', coalesce((
      select jsonb_agg(jsonb_build_object('id', m.id, 'kind', m.kind, 'value', m.value, 'isPrimary', m.is_primary, 'optedOut', m.opted_out_at is not null)
        order by m.is_primary desc, m.kind, m.value)
      from sli_contact_methods m where m.contact_id = p_contact.id
    ), '[]'::jsonb)
  );
$$;

revoke all on function sli_normalize_contact_method(text, text) from public, anon, authenticated;
revoke all on function sli_contact_brief(sli_contacts) from public, anon, authenticated;

-- API: company profile ------------------------------------------------------------

create or replace function sli_save_customer_profile(
  p_customer uuid, p_overview text, p_products_services text, p_notable_customers text,
  p_address text, p_employee_count text, p_procurement_type text
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
begin
  if v_org is null or not sli_can_edit_customers(v_org, v_actor) then
    raise exception 'Only Marketing, Sales and the Discovery team can edit companies' using errcode = '42501';
  end if;
  if nullif(p_procurement_type, '') is not null and p_procurement_type not in ('local', 'global_mandate', 'local_and_global') then
    raise exception 'Choose how they procure' using errcode = 'EC101';
  end if;
  update sli_customers set
    company_overview = nullif(trim(coalesce(p_overview, '')), ''),
    products_services = nullif(trim(coalesce(p_products_services, '')), ''),
    notable_customers = nullif(trim(coalesce(p_notable_customers, '')), ''),
    address = nullif(trim(coalesce(p_address, '')), ''),
    employee_count = nullif(trim(coalesce(p_employee_count, '')), ''),
    procurement_type = nullif(p_procurement_type, ''),
    updated_by = v_actor
  where id = p_customer and organization_id = v_org;
  if not found then
    raise exception 'Company not found' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_customer);
end;
$$;

-- API: contacts -------------------------------------------------------------------

-- Create (p_id null) or update a contact and replace their contact methods
-- (p_methods: [{kind, value, isPrimary, optedOut}]). An email already used
-- by another contact is refused, naming them. With p_customer, also links
-- the contact to that company now (if not linked already) with the job
-- title, department and primary flag given.
create or replace function sli_save_contact(
  p_id uuid,
  p_first_name text,
  p_last_name text,
  p_buying_role text,
  p_marketing_consent text,
  p_consent_source text,
  p_do_not_contact boolean,
  p_notes text,
  p_methods jsonb,
  p_customer uuid default null,
  p_job_title text default null,
  p_department text default null,
  p_is_primary boolean default false
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
  v_contact sli_contacts;
  v_method jsonb;
  v_kind text;
  v_value text;
  v_norm text;
  v_dup record;
  v_seen text[] := '{}';
  v_old jsonb;
begin
  if v_org is null or not sli_can_edit_customers(v_org, v_actor) then
    raise exception 'Only Marketing, Sales and the Discovery team can edit contacts' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_first_name, ''))) < 1 then
    raise exception 'Give the contact''s first name' using errcode = 'EC101';
  end if;
  if nullif(p_buying_role, '') is not null and p_buying_role not in ('decision_maker', 'influencer', 'user', 'other') then
    raise exception 'Choose the buying role' using errcode = 'EC101';
  end if;
  if coalesce(p_marketing_consent, 'unknown') not in ('unknown', 'given', 'withdrawn') then
    raise exception 'Choose the marketing consent' using errcode = 'EC101';
  end if;
  if p_methods is not null and jsonb_typeof(p_methods) <> 'array' then
    raise exception 'Contact methods must be a list' using errcode = 'EC101';
  end if;
  if p_customer is not null and not exists (select 1 from sli_customers where id = p_customer and organization_id = v_org and archived_at is null) then
    raise exception 'Company not found' using errcode = 'EC101';
  end if;

  -- Check the methods before writing anything.
  for v_method in select * from jsonb_array_elements(coalesce(p_methods, '[]'::jsonb)) loop
    v_kind := v_method ->> 'kind';
    v_value := trim(coalesce(v_method ->> 'value', ''));
    if v_value = '' then
      continue;
    end if;
    if v_kind not in ('email', 'mobile', 'landline', 'viber', 'whatsapp', 'linkedin', 'other') then
      raise exception 'Unknown contact method' using errcode = 'EC101';
    end if;
    if v_kind = 'email' and v_value !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '% isn''t a valid email address', v_value using errcode = 'EC101';
    end if;
    v_norm := sli_normalize_contact_method(v_kind, v_value);
    if v_kind || ':' || v_norm = any(v_seen) then
      raise exception '% is listed twice', v_value using errcode = 'EC101';
    end if;
    v_seen := v_seen || (v_kind || ':' || v_norm);
    if v_kind = 'email' then
      select c.id, trim(c.first_name || ' ' || coalesce(c.last_name, '')) as name into v_dup
      from sli_contact_methods m join sli_contacts c on c.id = m.contact_id
      where m.organization_id = v_org and m.kind = 'email' and m.normalized_value = v_norm
        and c.archived_at is null and c.id is distinct from p_id
      limit 1;
      if found then
        raise exception '% already uses %. Open that contact instead.', v_dup.name, v_value using errcode = 'EC101';
      end if;
    end if;
  end loop;

  if p_id is null then
    insert into sli_contacts (organization_id, first_name, last_name, buying_role, marketing_consent, consent_recorded_at, consent_source,
      do_not_contact, notes, created_by, updated_by)
    values (v_org, trim(p_first_name), nullif(trim(coalesce(p_last_name, '')), ''), nullif(p_buying_role, ''), coalesce(p_marketing_consent, 'unknown'),
      case when coalesce(p_marketing_consent, 'unknown') <> 'unknown' then now() end, nullif(trim(coalesce(p_consent_source, '')), ''),
      coalesce(p_do_not_contact, false), nullif(trim(coalesce(p_notes, '')), ''), v_actor, v_actor)
    returning * into v_contact;
  else
    select * into v_contact from sli_contacts where id = p_id and organization_id = v_org for update;
    if not found then
      raise exception 'Contact not found' using errcode = '42501';
    end if;
    update sli_contacts set
      first_name = trim(p_first_name), last_name = nullif(trim(coalesce(p_last_name, '')), ''), buying_role = nullif(p_buying_role, ''),
      consent_recorded_at = case when coalesce(p_marketing_consent, 'unknown') is distinct from v_contact.marketing_consent then now() else consent_recorded_at end,
      marketing_consent = coalesce(p_marketing_consent, 'unknown'),
      consent_source = coalesce(nullif(trim(coalesce(p_consent_source, '')), ''), consent_source),
      do_not_contact = coalesce(p_do_not_contact, false), notes = nullif(trim(coalesce(p_notes, '')), ''), updated_by = v_actor
    where id = p_id returning * into v_contact;
  end if;

  -- Replace the methods, keeping when an unchanged one was opted out.
  if p_methods is not null then
    select coalesce(jsonb_object_agg(kind || ':' || normalized_value, opted_out_at), '{}'::jsonb) into v_old
    from sli_contact_methods where contact_id = v_contact.id and opted_out_at is not null;
    delete from sli_contact_methods where contact_id = v_contact.id;
    for v_method in select * from jsonb_array_elements(p_methods) loop
      v_kind := v_method ->> 'kind';
      v_value := trim(coalesce(v_method ->> 'value', ''));
      continue when v_value = '';
      v_norm := sli_normalize_contact_method(v_kind, v_value);
      insert into sli_contact_methods (organization_id, contact_id, kind, value, normalized_value, is_primary, opted_out_at)
      values (v_org, v_contact.id, v_kind, v_value, v_norm, coalesce((v_method ->> 'isPrimary')::boolean, false),
        case when coalesce((v_method ->> 'optedOut')::boolean, false)
          then coalesce((v_old ->> (v_kind || ':' || v_norm))::timestamptz, now()) end);
    end loop;
  end if;

  if p_customer is not null and not exists (
    select 1 from sli_customer_contacts where customer_id = p_customer and contact_id = v_contact.id and ended_on is null
  ) then
    insert into sli_customer_contacts (organization_id, customer_id, contact_id, job_title, department_text, is_primary, started_on, created_by)
    values (v_org, p_customer, v_contact.id, nullif(trim(coalesce(p_job_title, '')), ''), nullif(trim(coalesce(p_department, '')), ''),
      coalesce(p_is_primary, false), current_date, v_actor);
  end if;

  return jsonb_build_object('id', v_contact.id);
end;
$$;

-- Change what a contact does at a company (title, department, primary), or
-- record that they left (p_ended_on), keeping the link as history.
create or replace function sli_update_contact_link(p_link uuid, p_job_title text, p_department text, p_is_primary boolean, p_ended_on date default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
  v_link sli_customer_contacts;
begin
  if v_org is null or not sli_can_edit_customers(v_org, v_actor) then
    raise exception 'Only Marketing, Sales and the Discovery team can edit contacts' using errcode = '42501';
  end if;
  select * into v_link from sli_customer_contacts where id = p_link and organization_id = v_org for update;
  if not found then
    raise exception 'Link not found' using errcode = '42501';
  end if;
  if v_link.ended_on is not null and p_ended_on is null then
    raise exception 'This person has already left; add them to the company again instead' using errcode = 'EC101';
  end if;
  if p_ended_on is not null and v_link.started_on is not null and p_ended_on < v_link.started_on then
    raise exception 'The leaving date is before they joined' using errcode = 'EC101';
  end if;
  update sli_customer_contacts set
    job_title = nullif(trim(coalesce(p_job_title, '')), ''), department_text = nullif(trim(coalesce(p_department, '')), ''),
    is_primary = coalesce(p_is_primary, false) and p_ended_on is null, ended_on = p_ended_on
  where id = p_link;
  return jsonb_build_object('id', v_link.contact_id, 'customerId', v_link.customer_id);
end;
$$;

create or replace function sli_archive_contact(p_contact uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
begin
  if v_org is null or not sli_can_edit_customers(v_org, v_actor) then
    raise exception 'Only Marketing, Sales and the Discovery team can edit contacts' using errcode = '42501';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Say why the contact is being removed' using errcode = 'EC101';
  end if;
  update sli_contacts set archived_at = now(), notes = concat_ws(E'\n', notes, 'Removed: ' || trim(p_reason)), updated_by = v_actor
  where id = p_contact and organization_id = v_org and archived_at is null;
  if not found then
    raise exception 'Contact not found' using errcode = '42501';
  end if;
  return jsonb_build_object('id', p_contact);
end;
$$;

-- Contacts by name, email or phone, with their current companies.
create or replace function sli_list_contacts(p_search text default null, p_limit integer default 100)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_caller_org();
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if v_org is null or not sli_can_read_customers(v_org, v_actor) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by x.sort_name)
    from (
      select sli_contact_brief(c) || jsonb_build_object(
        'companies', coalesce((
          select jsonb_agg(jsonb_build_object('id', k.id, 'name', k.name, 'jobTitle', l.job_title) order by k.name)
          from sli_customer_contacts l join sli_customers k on k.id = l.customer_id
          where l.contact_id = c.id and l.ended_on is null
        ), '[]'::jsonb)
      ) as j, lower(coalesce(c.last_name, '') || ' ' || c.first_name) as sort_name
      from sli_contacts c
      where c.organization_id = v_org and c.archived_at is null
        and (v_search is null
          or (c.first_name || ' ' || coalesce(c.last_name, '')) ilike '%' || v_search || '%'
          or exists (select 1 from sli_contact_methods m where m.contact_id = c.id
            and (m.normalized_value = sli_normalize_contact_method(m.kind, v_search) or m.value ilike '%' || v_search || '%')))
      order by sort_name
      limit greatest(1, least(coalesce(p_limit, 100), 500))
    ) x
  ), '[]'::jsonb);
end;
$$;

create or replace function sli_get_contact(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_actor uuid := sli_actor();
  v_org uuid := sli_caller_org();
  v_contact sli_contacts;
begin
  if v_org is null or not sli_can_read_customers(v_org, v_actor) then
    raise exception 'SLI access denied' using errcode = '42501';
  end if;
  select * into v_contact from sli_contacts where id = p_id and organization_id = v_org and archived_at is null;
  if not found then
    return null;
  end if;
  return sli_contact_brief(v_contact) || jsonb_build_object(
    'consentRecordedAt', v_contact.consent_recorded_at, 'consentSource', v_contact.consent_source, 'notes', v_contact.notes,
    'source', v_contact.source, 'createdBy', sli_display_name(v_contact.created_by), 'updatedAt', v_contact.updated_at,
    'canEdit', sli_can_edit_customers(v_org, v_actor),
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('linkId', l.id, 'customerId', k.id, 'customerName', k.name, 'jobTitle', l.job_title,
        'department', l.department_text, 'isPrimary', l.is_primary, 'startedOn', l.started_on, 'endedOn', l.ended_on)
        order by l.ended_on is not null, l.ended_on desc, k.name)
      from sli_customer_contacts l join sli_customers k on k.id = l.customer_id
      where l.contact_id = v_contact.id
    ), '[]'::jsonb)
  );
end;
$$;

-- Updated: the company profile and its contacts (current and past).
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
    'profile', jsonb_build_object(
      'overview', v_customer.company_overview, 'productsServices', v_customer.products_services,
      'notableCustomers', v_customer.notable_customers, 'address', v_customer.address,
      'employeeCount', v_customer.employee_count, 'procurementType', v_customer.procurement_type
    ),
    'contacts', coalesce((
      select jsonb_agg(sli_contact_brief(c) || jsonb_build_object(
        'linkId', l.id, 'jobTitle', l.job_title, 'department', l.department_text, 'isPrimary', l.is_primary,
        'startedOn', l.started_on, 'endedOn', l.ended_on
      ) order by l.ended_on is not null, l.is_primary desc, c.last_name, c.first_name)
      from sli_customer_contacts l join sli_contacts c on c.id = l.contact_id
      where l.customer_id = v_customer.id and c.archived_at is null
    ), '[]'::jsonb),
    'salesMembers', coalesce((
      select jsonb_agg(jsonb_build_object('userId', dm.user_id, 'name', sli_display_name(dm.user_id), 'department', d.code) order by d.code, sli_display_name(dm.user_id))
      from sli_department_members dm join sli_departments d on d.id = dm.department_id
      where dm.organization_id = v_org and dm.status = 'active' and d.code in ('sales', 'marketing') and d.is_active
    ), '[]'::jsonb)
  );
end;
$$;

revoke all on function sli_save_customer_profile(uuid, text, text, text, text, text, text) from public, anon;
revoke all on function sli_save_contact(uuid, text, text, text, text, text, boolean, text, jsonb, uuid, text, text, boolean) from public, anon;
revoke all on function sli_update_contact_link(uuid, text, text, boolean, date) from public, anon;
revoke all on function sli_archive_contact(uuid, text) from public, anon;
revoke all on function sli_list_contacts(text, integer) from public, anon;
revoke all on function sli_get_contact(uuid) from public, anon;
grant execute on function sli_save_customer_profile(uuid, text, text, text, text, text, text) to authenticated;
grant execute on function sli_save_contact(uuid, text, text, text, text, text, boolean, text, jsonb, uuid, text, text, boolean) to authenticated;
grant execute on function sli_update_contact_link(uuid, text, text, boolean, date) to authenticated;
grant execute on function sli_archive_contact(uuid, text) to authenticated;
grant execute on function sli_list_contacts(text, integer) to authenticated;
grant execute on function sli_get_contact(uuid) to authenticated;

-- External MCP read-only guarantee, guarded as in the earlier SLI migrations.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
