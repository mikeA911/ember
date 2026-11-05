-- The calm workspace's view, kept with the person's account instead of on
-- one device (docs/design-notes/ember-sli-calm-workspace.md §6): the scene,
-- dim and soften, and the path of their own photo in the private
-- view-photos bucket (20261112100002_view_photos_storage.sql). Only the
-- person can read or change their own row, through the functions below.

create table if not exists user_view_settings (
  user_id uuid primary key references profiles(id) on delete cascade,
  scene text not null default 'ember' check (scene in ('ember', 'dusk', 'mist', 'plain', 'photo')),
  dim integer not null default 15 check (dim between 0 and 70),
  soften integer not null default 0 check (soften between 0 and 16),
  photo_path text,
  updated_at timestamptz not null default now()
);

alter table user_view_settings enable row level security;
revoke all on user_view_settings from anon, authenticated;

create or replace function view_settings_caller(p_write boolean)
returns uuid
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null or not exists (select 1 from profiles where id = v_user and is_active) then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if p_write and (auth.jwt() ->> 'client_id') is not null then
    raise exception 'An external client cannot change the view' using errcode = '42501';
  end if;
  return v_user;
end;
$$;
revoke all on function view_settings_caller(boolean) from public, anon, authenticated;

create or replace function view_settings_get()
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_user uuid := view_settings_caller(false);
begin
  return (
    select jsonb_build_object('scene', scene, 'dim', dim, 'soften', soften, 'photoPath', photo_path)
    from user_view_settings where user_id = v_user
  );
end;
$$;

create or replace function view_settings_save(p_scene text, p_dim integer, p_soften integer)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := view_settings_caller(true);
begin
  if p_scene = 'photo' and not exists (select 1 from user_view_settings where user_id = v_user and photo_path is not null) then
    raise exception 'Choose a photo first' using errcode = 'EC101';
  end if;
  insert into user_view_settings (user_id, scene, dim, soften) values (v_user, p_scene, p_dim, p_soften)
  on conflict (user_id) do update set scene = excluded.scene, dim = excluded.dim, soften = excluded.soften, updated_at = now();
end;
$$;

-- Records the person's new photo (already uploaded under their own folder)
-- and shows it, or forgets it (null). Returns the previous path, for the
-- caller to delete from storage.
create or replace function view_settings_set_photo(p_path text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_user uuid := view_settings_caller(true);
  v_old text;
begin
  if p_path is not null and (p_path not like v_user::text || '/%' or p_path like '%..%') then
    raise exception 'That photo isn''t yours' using errcode = '42501';
  end if;
  select photo_path into v_old from user_view_settings where user_id = v_user;
  insert into user_view_settings (user_id, scene, photo_path) values (v_user, case when p_path is null then 'ember' else 'photo' end, p_path)
  on conflict (user_id) do update set
    photo_path = excluded.photo_path,
    scene = case when p_path is not null then 'photo' when user_view_settings.scene = 'photo' then 'ember' else user_view_settings.scene end,
    updated_at = now();
  return case when v_old is distinct from p_path then v_old end;
end;
$$;

revoke all on function view_settings_get() from public, anon;
revoke all on function view_settings_save(text, integer, integer) from public, anon;
revoke all on function view_settings_set_photo(text) from public, anon;
grant execute on function view_settings_get() to authenticated;
grant execute on function view_settings_save(text, integer, integer) to authenticated;
grant execute on function view_settings_set_photo(text) to authenticated;

-- External MCP read-only guarantee, guarded as in the SLI migrations.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
