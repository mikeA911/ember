-- Catch-up: migrations 20261001-20261011 in one script (presentation
-- scheduling, default embedding model, agency builders and client fees,
-- project approval and Live status, external MCP access, self-hosted AI
-- providers, builder budgets, live handover, self-registration, AI task
-- logging and the AI cost report).
--
-- For a database that skipped some or all of these. Every part is safe to
-- re-run, and it is all one transaction: it either applies completely or
-- changes nothing. Run the WHOLE file in the Supabase SQL Editor.
--
-- Verified 2026-10-06 against local Postgres 16 + pgvector: applied on a
-- database built from every other migration, run twice, and run again on a
-- fully migrated database -- each time without errors, ending with the same
-- policies, functions, triggers and columns as applying every migration in
-- order. Later migrations never redefine anything these define.
--
-- Built from the migration files below by concatenation; if one of them
-- changes, rebuild this file the same way.

begin;

-- ============================================================================
-- 20261001100001_presentation_scheduled_open.sql
-- ============================================================================

-- A curator can schedule a presentation review to open automatically at a
-- future date/time (draft -> review_open) instead of clicking "Open for
-- review" that day. Nullable -- most presentations are opened manually and
-- never set this. review_deadline (existing column) can be set together
-- with this at schedule time; it just sits on the row until the cron job
-- flips status, same as it already does for a manual open.
alter table presentations add column if not exists scheduled_open_at timestamptz;

create index if not exists presentations_scheduled_open_at_idx on presentations(scheduled_open_at) where scheduled_open_at is not null;

-- ============================================================================
-- 20261002100001_openai_default_embedding.sql
-- ============================================================================

-- Default embedding model: OpenAI text-embedding-3-small (1536 dimensions,
-- same as every vector(1536) column). Replaces the seed's gemini-embedding-001
-- default (20260810110002_seed_ai_providers.sql), and the RAG Answer agent
-- template's pinned embedding default (20260811100003_agent_framework.sql), so
-- knowledge vectors and the queries searched against them come from the same
-- model. The embedding default stays admin-changeable from the "Model
-- assignments" summary on the AI Config tab.
--
-- Vectors from different embedding models are not comparable, so this only
-- switches while no kb_vectors/wiki_vectors row was embedded by another model
-- -- an environment already running on a different embedding model keeps it
-- until an admin changes it deliberately (and re-embeds).
do $$
declare
  v_provider uuid;
  v_model uuid;
begin
  select m.provider_id, m.id into v_provider, v_model
  from ai_models m
  join ai_providers p on p.id = m.provider_id
  where p.name = 'openai' and m.model_id = 'text-embedding-3-small' and m.model_type = 'embedding';

  if v_model is null then
    return;
  end if;
  -- Re-run safe: only replace the original seed default (or no default),
  -- never an embedding model an admin has chosen since.
  if exists (
    select 1 from ai_models m
    where m.model_type = 'embedding' and m.is_default and m.id <> v_model and m.model_id <> 'gemini-embedding-001'
  ) then
    return;
  end if;
  if exists (select 1 from kb_vectors where embedding_model is distinct from 'text-embedding-3-small')
     or exists (select 1 from wiki_vectors where embedding_model is distinct from 'text-embedding-3-small') then
    return;
  end if;

  update ai_models set is_default = false where model_type = 'embedding' and is_default and id <> v_model;
  update ai_models set is_default = true, enabled = true where id = v_model;

  update agent_templates
  set default_embedding_provider_id = v_provider, default_embedding_model_id = v_model
  where default_embedding_model_id is not null and default_embedding_model_id <> v_model;
end $$;

-- ============================================================================
-- 20261003100001_agency_builders.sql
-- ============================================================================

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

-- ============================================================================
-- 20261003100002_builder_proposal_promotions.sql
-- ============================================================================

-- Builder proposals become client Projects (2026-10-01, Mike). A builder
-- keeps one workspace Project; each client proposal is a Workstream on it.
-- Once the client accepts, the builder submits the workstream for promotion
-- with the client's email addresses, and the builder's agency (curator, via
-- agency_builders) or the platform admin approves it. Approval creates the
-- client Project, owned by the builder, with the agency as curator and the
-- client as viewers (src/lib/workbench/workstream-promotions.ts). Each
-- approved promotion (decided_at, created_project_id) is the billable
-- "client project created" event the agency dashboard counts.
alter table workstream_promotions add column if not exists client_emails text[] not null default '{}';

-- An agency is not a member of its builders' private workspaces, so
-- can_curate_project alone never lets it decide their promotions.
create or replace function is_builder_agency(builder uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from agency_builders ab
    join profiles p on p.id = ab.agency_id
    where ab.builder_id = builder and ab.agency_id = uid and p.role = 'curator' and p.is_active = true
  );
$$;

drop policy if exists "workstream_promotions_select_own_or_curator" on workstream_promotions;
drop policy if exists "workstream_promotions_select_own_curator_or_agency" on workstream_promotions;
create policy "workstream_promotions_select_own_curator_or_agency" on workstream_promotions
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from project_workstreams w where w.id = workstream_id and can_curate_project(w.project_id, auth.uid()))
    or is_builder_agency(submitted_by, auth.uid())
  );

drop policy if exists "workstream_promotions_decide_curator" on workstream_promotions;
drop policy if exists "workstream_promotions_decide_curator_or_agency" on workstream_promotions;
create policy "workstream_promotions_decide_curator_or_agency" on workstream_promotions
  for update
  using (
    submitted_by != auth.uid()
    and (
      exists (select 1 from project_workstreams w where w.id = workstream_id and can_curate_project(w.project_id, auth.uid()))
      or is_builder_agency(submitted_by, auth.uid())
    )
  )
  with check (
    submitted_by != auth.uid()
    and (
      exists (select 1 from project_workstreams w where w.id = workstream_id and can_curate_project(w.project_id, auth.uid()))
      or is_builder_agency(submitted_by, auth.uid())
    )
  );

-- ============================================================================
-- 20261003100003_client_project_fees.sql
-- ============================================================================

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

-- ============================================================================
-- 20261004100001_project_creation_approval.sql
-- ============================================================================

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

-- ============================================================================
-- 20261004100002_project_live_status.sql
-- ============================================================================

-- Live status (2026-10-02, Mike). After a project is Approved ('completed')
-- it waits for the client's approval -- normally given through the
-- workstream presentation -- and then goes Live: in production and in
-- maintenance. Pipeline: draft -> active -> review -> completed -> live.
-- A Live project stays Live: bug fixes and new features are new workstreams
-- inside it. An Approved project can be reopened to Working on it. Safe to re-run.
alter table projects drop constraint if exists projects_status_check;
alter table projects add constraint projects_status_check
  check (status = any (array['draft'::text, 'active'::text, 'review'::text, 'completed'::text, 'live'::text, 'archived'::text]));

-- ============================================================================
-- 20261005100001_external_mcp_access.sql
-- ============================================================================

-- External MCP server (docs/dev-request-ember-external-mcp-server.md):
-- builders ask their own AI chatbot (Claude, ChatGPT) about their Ember
-- projects. The chatbot signs in through Supabase Auth's OAuth 2.1 server,
-- so every token it holds is an ordinary Supabase user JWT carrying a
-- `client_id` claim. This migration adds:
--
--   1. mcp_access_users           who may connect a chatbot at all (admin-managed)
--   2. mcp_approved_clients       which chatbots, by exact OAuth redirect URI,
--                                 and the highest sensitivity tier each may receive
--   3. mcp_access_log             one row per MCP call, including denied ones
--   4. mcp_rate_counters          per user+client call counters (serverless-safe)
--   5. read-only enforcement      a RESTRICTIVE insert/update/delete policy on
--                                 every public table and storage.objects that
--                                 fails for any token with a client_id claim --
--                                 so a leaked chatbot token is read-only even
--                                 when sent straight to PostgREST, not just
--                                 through Ember's own read-only tools
--   6. guards on the three writing SECURITY DEFINER RPCs (they bypass RLS)

-- 1. Allowlist ---------------------------------------------------------------
create table if not exists mcp_access_users (
  user_id uuid primary key references profiles(id) on delete cascade,
  note text,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table mcp_access_users enable row level security;

drop policy if exists "mcp_access_users_select_self_or_admin" on mcp_access_users;
create policy "mcp_access_users_select_self_or_admin" on mcp_access_users
  for select to authenticated using (user_id = auth.uid() or is_admin(auth.uid()));
drop policy if exists "mcp_access_users_admin_insert" on mcp_access_users;
create policy "mcp_access_users_admin_insert" on mcp_access_users
  for insert to authenticated with check (is_admin(auth.uid()));
drop policy if exists "mcp_access_users_admin_delete" on mcp_access_users;
create policy "mcp_access_users_admin_delete" on mcp_access_users
  for delete to authenticated using (is_admin(auth.uid()));

-- 2. Approved chatbot clients --------------------------------------------------
-- Dynamic client registration lets anyone register an OAuth client, so the
-- consent page only approves a client whose redirect URI is listed here
-- (exact match). max_sensitivity caps what that chatbot's provider may be
-- sent -- same tiers as ai_provider_sensitivity_eligibility, and never
-- 'restricted'.
create table if not exists mcp_approved_clients (
  redirect_uri text primary key check (redirect_uri ~ '^https://' or redirect_uri ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]+)?/'),
  label text not null check (length(label) between 1 and 80),
  max_sensitivity text not null default 'internal' check (max_sensitivity in ('public', 'internal', 'confidential')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table mcp_approved_clients enable row level security;

-- Readable by any signed-in user: the consent page shows the label, and a
-- redirect URI is not a secret.
drop policy if exists "mcp_approved_clients_select_authenticated" on mcp_approved_clients;
create policy "mcp_approved_clients_select_authenticated" on mcp_approved_clients
  for select to authenticated using (true);
drop policy if exists "mcp_approved_clients_admin_insert" on mcp_approved_clients;
create policy "mcp_approved_clients_admin_insert" on mcp_approved_clients
  for insert to authenticated with check (is_admin(auth.uid()));
drop policy if exists "mcp_approved_clients_admin_update" on mcp_approved_clients;
create policy "mcp_approved_clients_admin_update" on mcp_approved_clients
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
drop policy if exists "mcp_approved_clients_admin_delete" on mcp_approved_clients;
create policy "mcp_approved_clients_admin_delete" on mcp_approved_clients
  for delete to authenticated using (is_admin(auth.uid()));

insert into mcp_approved_clients (redirect_uri, label, max_sensitivity) values
  ('https://claude.ai/api/mcp/auth_callback', 'Claude', 'internal'),
  ('https://claude.com/api/mcp/auth_callback', 'Claude', 'internal'),
  ('https://chatgpt.com/connector_platform_oauth_redirect', 'ChatGPT', 'internal')
on conflict (redirect_uri) do nothing;

-- 3. Audit log -----------------------------------------------------------------
-- No client insert policy: written only by the service-role client in
-- src/lib/mcp/access.ts, same shape as ai_operation_logs.
create table if not exists mcp_access_log (
  id bigint generated always as identity primary key,
  user_id uuid references profiles(id) on delete set null,
  client_id text,
  method text not null,
  tool text,
  project_id uuid,
  args_summary text,
  result_count integer,
  withheld_count integer,
  status text not null check (status in ('ok', 'denied', 'rate_limited', 'error')),
  error text,
  latency_ms integer,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists mcp_access_log_user_created_idx on mcp_access_log (user_id, created_at desc);
create index if not exists mcp_access_log_created_idx on mcp_access_log (created_at desc);

alter table mcp_access_log enable row level security;

drop policy if exists "mcp_access_log_select_self_or_admin" on mcp_access_log;
create policy "mcp_access_log_select_self_or_admin" on mcp_access_log
  for select to authenticated using (user_id = auth.uid() or is_admin(auth.uid()));

-- 4. Rate counters ---------------------------------------------------------------
create table if not exists mcp_rate_counters (
  user_id uuid not null references profiles(id) on delete cascade,
  client_id text not null,
  window_kind text not null check (window_kind in ('minute', 'day')),
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (user_id, client_id, window_kind, window_start)
);

alter table mcp_rate_counters enable row level security;
-- No policies: service role only.

-- Counts this call against both windows and reports whether it is within
-- both limits. One atomic upsert per window, so concurrent serverless
-- instances can't under-count. Service role only.
create or replace function mcp_rate_hit(p_user_id uuid, p_client_id text, p_minute_limit integer, p_day_limit integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minute integer;
  v_day integer;
begin
  insert into mcp_rate_counters (user_id, client_id, window_kind, window_start, hits)
  values (p_user_id, p_client_id, 'minute', date_trunc('minute', now()), 1)
  on conflict (user_id, client_id, window_kind, window_start) do update set hits = mcp_rate_counters.hits + 1
  returning hits into v_minute;

  insert into mcp_rate_counters (user_id, client_id, window_kind, window_start, hits)
  values (p_user_id, p_client_id, 'day', date_trunc('day', now()), 1)
  on conflict (user_id, client_id, window_kind, window_start) do update set hits = mcp_rate_counters.hits + 1
  returning hits into v_day;

  delete from mcp_rate_counters where window_start < now() - interval '2 days';

  return v_minute <= p_minute_limit and v_day <= p_day_limit;
end;
$$;

revoke all on function mcp_rate_hit(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function mcp_rate_hit(uuid, text, integer, integer) to service_role;

-- 5. Read-only enforcement for OAuth-issued tokens ------------------------------
-- A RESTRICTIVE policy is ANDed with every permissive one, so browser sessions
-- (no client_id claim) are unaffected while any OAuth client token fails every
-- insert, update and delete. Idempotent: creates only the policies a table is
-- missing. Any future migration that creates a table must end with
--   select apply_oauth_read_only_policies();
-- (src/lib/mcp/read-only-migrations.test.ts fails otherwise).
create or replace function apply_oauth_read_only_policies()
returns void
language plpgsql
set search_path = public
as $$
declare
  t record;
begin
  for t in
    select c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.table_name and policyname = 'oauth_clients_no_insert') then
      execute format(
        'create policy oauth_clients_no_insert on public.%I as restrictive for insert to public with check ((auth.jwt() ->> ''client_id'') is null)',
        t.table_name
      );
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.table_name and policyname = 'oauth_clients_no_update') then
      execute format(
        'create policy oauth_clients_no_update on public.%I as restrictive for update to public using ((auth.jwt() ->> ''client_id'') is null) with check ((auth.jwt() ->> ''client_id'') is null)',
        t.table_name
      );
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.table_name and policyname = 'oauth_clients_no_delete') then
      execute format(
        'create policy oauth_clients_no_delete on public.%I as restrictive for delete to public using ((auth.jwt() ->> ''client_id'') is null)',
        t.table_name
      );
    end if;
  end loop;
end;
$$;

revoke all on function apply_oauth_read_only_policies() from public, anon, authenticated;

select apply_oauth_read_only_policies();

drop policy if exists "oauth_clients_no_insert" on storage.objects;
create policy "oauth_clients_no_insert" on storage.objects
  as restrictive for insert to public with check ((auth.jwt() ->> 'client_id') is null);
drop policy if exists "oauth_clients_no_update" on storage.objects;
create policy "oauth_clients_no_update" on storage.objects
  as restrictive for update to public using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
drop policy if exists "oauth_clients_no_delete" on storage.objects;
create policy "oauth_clients_no_delete" on storage.objects
  as restrictive for delete to public using ((auth.jwt() ->> 'client_id') is null);

-- 6. Writing SECURITY DEFINER RPCs bypass RLS, so guard them directly.
-- Same bodies as 20260808190009_functions.sql / 20260828160001, plus the guard.
create or replace function increment_approved_chunks(doc_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'OAuth client tokens are read-only' using errcode = '42501';
  end if;
  update documents set approved_chunks = approved_chunks + 1 where id = doc_id;
end;
$$;

create or replace function increment_rejected_chunks(doc_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'OAuth client tokens are read-only' using errcode = '42501';
  end if;
  update documents set rejected_chunks = rejected_chunks + 1 where id = doc_id;
end;
$$;

create or replace function decrement_approved_chunks(doc_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if (auth.jwt() ->> 'client_id') is not null then
    raise exception 'OAuth client tokens are read-only' using errcode = '42501';
  end if;
  update documents set approved_chunks = greatest(approved_chunks - 1, 0) where id = doc_id;
end;
$$;

-- ============================================================================
-- 20261006100001_ai_provider_self_hosted.sql
-- ============================================================================

-- Sandz-hosted AI for Live client Projects (Builder mode).
--
-- Marks a provider as running on Sandz infrastructure (for example the vLLM
-- server on the Zadara GPU VM, docs/guides/ember-self-hosted-llm-integration.md).
-- In Builder mode, a contracted client Project -- one with a
-- client_project_fees row, created when an accepted proposal is promoted --
-- may use only these providers for content calls once it is Live
-- (src/lib/ai/hosting-policy.ts). Presales work, pre-live client Projects
-- and internal/foundation Projects are unrestricted.
--
-- Default false: a provider is external until an admin says otherwise. Set
-- from Admin -> AI Config; existing ai_providers RLS (admin-only writes,
-- read by any active non-anonymous session) already covers the column.
alter table ai_providers add column if not exists is_self_hosted boolean not null default false;

comment on column ai_providers.is_self_hosted is
  'Runs on Sandz infrastructure. Live client Projects in Builder mode may use only these providers for content AI calls.';

-- ============================================================================
-- 20261007100001_agency_scoped_builder_budgets.sql
-- ============================================================================

-- Agencies see and control their own builders' AI budgets (2026-10-04,
-- Mike). With the Builder/Enterprise modes merged, an enterprise running its
-- own Ember is the agency and wants the same control over its employees'
-- AI spend that a builder agency has over its builders.
--
-- Until now any curator could read or change any builder's allowance,
-- credit grants and BYOLLM credential (is_curator_or_admin), so on a
-- deployment shared by several agencies one agency could manage another's
-- builders. Scope all three to the builder themselves, their own agency
-- (agency_builders, via is_builder_agency) and the platform admin. A
-- builder on no agency's roster is managed by the admin alone -- same set
-- the agency dashboard (/agency) shows each viewer.
create or replace function can_manage_builder_budget(builder uuid, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin(uid) or is_builder_agency(builder, uid);
$$;

drop policy if exists "builder_ai_allowances_select_own_or_operator" on builder_ai_allowances;
drop policy if exists "builder_ai_allowances_select_own_agency_or_admin" on builder_ai_allowances;
create policy "builder_ai_allowances_select_own_agency_or_admin" on builder_ai_allowances
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

-- A builder still cannot raise their own cap.
drop policy if exists "builder_ai_allowances_manage_staff" on builder_ai_allowances;
drop policy if exists "builder_ai_allowances_manage_agency_or_admin" on builder_ai_allowances;
create policy "builder_ai_allowances_manage_agency_or_admin" on builder_ai_allowances
  for all
  using (can_manage_builder_budget(builder_id, auth.uid()))
  with check (can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_credit_grants_select_own_or_operator" on builder_credit_grants;
drop policy if exists "builder_credit_grants_select_own_agency_or_admin" on builder_credit_grants;
create policy "builder_credit_grants_select_own_agency_or_admin" on builder_credit_grants
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_credit_grants_insert_staff" on builder_credit_grants;
drop policy if exists "builder_credit_grants_insert_agency_or_admin" on builder_credit_grants;
create policy "builder_credit_grants_insert_agency_or_admin" on builder_credit_grants
  for insert to authenticated
  with check (granted_by = auth.uid() and can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_llm_credentials_select_own_or_operator" on builder_llm_credentials;
drop policy if exists "builder_llm_credentials_select_own_agency_or_admin" on builder_llm_credentials;
create policy "builder_llm_credentials_select_own_agency_or_admin" on builder_llm_credentials
  for select using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

drop policy if exists "builder_llm_credentials_manage_own_or_staff" on builder_llm_credentials;
drop policy if exists "builder_llm_credentials_manage_own_agency_or_admin" on builder_llm_credentials;
create policy "builder_llm_credentials_manage_own_agency_or_admin" on builder_llm_credentials
  for all
  using (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()))
  with check (builder_id = auth.uid() or can_manage_builder_budget(builder_id, auth.uid()));

-- ============================================================================
-- 20261008100001_live_handover_and_builder_share.sql
-- ============================================================================

-- Live hand-over and the builder's share of client fees (2026-10-04, Mike).
--
-- When a builder's Project goes Live, the agency takes ownership: Ember is
-- then used for maintenance and feature requests, and the agency protects
-- the client relationship even for a solo builder. The builder stays on
-- the Project as curator and keeps working on it
-- (src/lib/workbench/projects.ts, handOverLiveProjectToAgency).
--
-- projects.builder_id records the builder of record -- the builder who
-- built it -- so the hand-over doesn't lose who earns the maintenance
-- bonus, whose AI budget their work counts against, or which builder card
-- the agency dashboard shows the Project on. Set only by the service layer
-- (promotion, hand-over) or a platform admin.
--
-- client_project_fees.builder_share_pct is the builder's share of the
-- maintenance fee -- for an employee, a bonus on top of salary (10% by
-- default, settings.builder_billing.builderSharePct). Recorded per fee like
-- platform_rate_pct, so changing the default never rewrites an agreed fee;
-- the agency or admin can adjust it per Project.

alter table projects add column if not exists builder_id uuid references profiles(id) on delete set null;
create index if not exists projects_builder_id_idx on projects(builder_id) where builder_id is not null;

-- Every existing client Project is still owned by its builder.
update projects p set builder_id = p.owner_id
where p.builder_id is null and exists (select 1 from client_project_fees f where f.project_id = p.id);

create or replace function enforce_project_builder_id()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_admin(auth.uid()) and (
    (tg_op = 'INSERT' and new.builder_id is not null)
    or (tg_op = 'UPDATE' and new.builder_id is distinct from old.builder_id)
  ) then
    raise exception 'Only a platform admin can change a project''s builder of record';
  end if;
  return new;
end;
$$;

drop trigger if exists projects_enforce_builder_id on projects;
create trigger projects_enforce_builder_id
  before insert or update on projects
  for each row execute function enforce_project_builder_id();

alter table client_project_fees
  add column if not exists builder_share_pct numeric(5, 2) not null default 0
    check (builder_share_pct >= 0 and builder_share_pct <= 100);

-- The builder of record sees their own fee and share; their agency (by the
-- builder, whoever owns the Project now) and the admin see and set it.
drop policy if exists "client_project_fees_select_owner_agency_or_admin" on client_project_fees;
drop policy if exists "client_project_fees_select_builder_agency_or_admin" on client_project_fees;
create policy "client_project_fees_select_builder_agency_or_admin" on client_project_fees
  for select using (
    is_admin(auth.uid())
    or exists (
      select 1 from projects p
      where p.id = project_id
        and (
          p.owner_id = auth.uid()
          or p.builder_id = auth.uid()
          or is_builder_agency(p.owner_id, auth.uid())
          or is_builder_agency(p.builder_id, auth.uid())
        )
    )
  );

drop policy if exists "client_project_fees_write_agency_or_admin" on client_project_fees;
create policy "client_project_fees_write_agency_or_admin" on client_project_fees
  for all
  using (
    is_admin(auth.uid())
    or exists (
      select 1 from projects p
      where p.id = project_id and (is_builder_agency(p.owner_id, auth.uid()) or is_builder_agency(p.builder_id, auth.uid()))
    )
  )
  with check (
    is_admin(auth.uid())
    or exists (
      select 1 from projects p
      where p.id = project_id and (is_builder_agency(p.owner_id, auth.uid()) or is_builder_agency(p.builder_id, auth.uid()))
    )
  );

-- After the hand-over the builder is no longer the owner, but still shares
-- progress updates on the Project they maintain.
drop policy if exists "builder_progress_updates_insert_owner" on builder_progress_updates;
drop policy if exists "builder_progress_updates_insert_owner_or_builder" on builder_progress_updates;
create policy "builder_progress_updates_insert_owner_or_builder" on builder_progress_updates
  for insert to authenticated
  with check (
    submitted_by = auth.uid()
    and exists (
      select 1 from project_workstreams w join projects p on p.id = w.project_id
      where w.id = workstream_id and (can_manage_project(w.project_id, auth.uid()) or p.builder_id = auth.uid())
    )
  );

drop policy if exists "builder_progress_updates_update_owner" on builder_progress_updates;
drop policy if exists "builder_progress_updates_update_owner_or_builder" on builder_progress_updates;
create policy "builder_progress_updates_update_owner_or_builder" on builder_progress_updates
  for update
  using (
    exists (
      select 1 from project_workstreams w join projects p on p.id = w.project_id
      where w.id = workstream_id and (can_manage_project(w.project_id, auth.uid()) or p.builder_id = auth.uid())
    )
  )
  with check (
    exists (
      select 1 from project_workstreams w join projects p on p.id = w.project_id
      where w.id = workstream_id and (can_manage_project(w.project_id, auth.uid()) or p.builder_id = auth.uid())
    )
  );

-- ============================================================================
-- 20261009100001_disable_self_registration.sql
-- ============================================================================

-- Self-registration off (2026-10-04, Mike). /register already redirects to
-- /login and accounts are created by an admin (createUserAction), which
-- writes the profile itself. But a sign-up made straight against Supabase
-- Auth (the anon key is public) could still give itself a consultant
-- profile on first login through this policy -- a builder account with
-- Ember access nobody approved. Drop it, so the only way to a non-anonymous
-- profile is the service role. Re-add a reviewed path when self-registration
-- is ready (e.g. as 'member', pending an agency's acceptance).
--
-- profiles_insert_self_anonymous stays: it only ever yields the dormant
-- 'anonymous' role.
drop policy if exists "profiles_insert_self_consultant" on profiles;

-- ============================================================================
-- 20261010100001_ai_operation_logs_task.sql
-- ============================================================================

-- Cost per task (2026-10-04, Mike). Every AI call records what it was for
-- (src/lib/ai/tasks.ts) and how much of its input the provider served from
-- its prompt cache. Groundwork for an admin cost report by task and for
-- choosing a model per task.
--
-- task is text, not a check constraint: the list lives in code and grows
-- with new features. Rows logged before this migration stay null and read
-- as "unattributed".
--
-- cached_input_tokens is the part of input_tokens served from the
-- provider's prompt cache (OpenAI/Groq/xAI prompt_tokens_details.
-- cached_tokens, DeepSeek prompt_cache_hit_tokens, Gemini
-- cachedContentTokenCount); null when the provider doesn't report it.
alter table ai_operation_logs add column if not exists task text;
alter table ai_operation_logs add column if not exists cached_input_tokens integer
  check (cached_input_tokens is null or cached_input_tokens >= 0);

create index if not exists ai_operation_logs_task_created_at_idx on ai_operation_logs(task, created_at desc);

-- ============================================================================
-- 20261011100001_ai_cost_report.sql
-- ============================================================================

-- AI cost report and cached-token pricing (2026-10-04, Mike).
--
-- ai_models.cached_input_cost_per_million: what the provider charges for
-- input tokens served from its prompt cache (OpenAI, Gemini and DeepSeek
-- all discount them). Null means "not set": cached tokens are then charged
-- at the full input price, so cost is never understated
-- (src/lib/ai/metering.ts computeCost).
alter table ai_models add column if not exists cached_input_cost_per_million numeric
  check (cached_input_cost_per_million is null or cached_input_cost_per_million >= 0);

-- Daily totals per task, provider, model and kind of call, for the admin
-- cost report (src/lib/workbench/ai-cost-report.ts). security_invoker, so
-- ai_operation_logs' own RLS (admin-only select) applies to whoever reads it.
-- Calls logged before 20261010100001 have no task and read as
-- 'unattributed'.
create or replace view ai_cost_daily with (security_invoker = true) as
select
  (created_at at time zone 'utc')::date as day,
  coalesce(task, 'unattributed') as task,
  provider,
  model,
  operation,
  count(*)::integer as calls,
  (count(*) filter (where not success))::integer as failed_calls,
  -- Succeeded, not the builder's own LLM, and no price configured.
  (count(*) filter (where success and not is_byo_llm and estimated_cost_usd is null))::integer as unpriced_calls,
  (count(*) filter (where is_byo_llm))::integer as byo_llm_calls,
  coalesce(sum(input_tokens), 0)::bigint as input_tokens,
  coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
  -- Input tokens on calls whose provider reported a cache figure, so the
  -- cached share isn't diluted by providers that report none.
  coalesce(sum(input_tokens) filter (where cached_input_tokens is not null), 0)::bigint as cache_reported_input_tokens,
  coalesce(sum(output_tokens), 0)::bigint as output_tokens,
  coalesce(sum(estimated_cost_usd), 0)::numeric as cost_usd
from ai_operation_logs
group by 1, 2, 3, 4, 5;

grant select on ai_cost_daily to authenticated;

commit;
