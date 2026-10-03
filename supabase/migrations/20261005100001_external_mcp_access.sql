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

create policy "mcp_access_users_select_self_or_admin" on mcp_access_users
  for select to authenticated using (user_id = auth.uid() or is_admin(auth.uid()));
create policy "mcp_access_users_admin_insert" on mcp_access_users
  for insert to authenticated with check (is_admin(auth.uid()));
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
create policy "mcp_approved_clients_select_authenticated" on mcp_approved_clients
  for select to authenticated using (true);
create policy "mcp_approved_clients_admin_insert" on mcp_approved_clients
  for insert to authenticated with check (is_admin(auth.uid()));
create policy "mcp_approved_clients_admin_update" on mcp_approved_clients
  for update to authenticated using (is_admin(auth.uid())) with check (is_admin(auth.uid()));
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

create policy "oauth_clients_no_insert" on storage.objects
  as restrictive for insert to public with check ((auth.jwt() ->> 'client_id') is null);
create policy "oauth_clients_no_update" on storage.objects
  as restrictive for update to public using ((auth.jwt() ->> 'client_id') is null) with check ((auth.jwt() ->> 'client_id') is null);
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
