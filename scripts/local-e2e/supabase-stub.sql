-- Minimal stand-in for what a hosted Supabase project provides before the
-- migrations run: API roles, the auth and storage schemas, and auth.uid() /
-- auth.jwt() reading the claims PostgREST sets. For local, disposable
-- databases only (scripts/local-e2e/README.md).
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create role supabase_auth_admin nologin; create role authenticator noinherit login;
    grant anon, authenticated, service_role to authenticator;
  end if; end $$;
create schema auth; create schema storage; create schema extensions;
grant usage on schema auth, storage, extensions, public to anon, authenticated, service_role;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), email_confirmed_at timestamptz, last_sign_in_at timestamptz, is_anonymous boolean default false, encrypted_password text, phone text, updated_at timestamptz default now());
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')) $$;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.email() returns text language sql stable as $$ select auth.jwt()->>'email' $$;
create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now(), updated_at timestamptz default now(), owner uuid);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now(), last_accessed_at timestamptz);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'),1)-1] $$;
create function storage.filename(name text) returns text language sql immutable as $$ select (string_to_array(name, '/'))[array_length(string_to_array(name, '/'),1)] $$;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
