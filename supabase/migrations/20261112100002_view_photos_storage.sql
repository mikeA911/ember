-- Private bucket for the photo a person puts behind their calm workspace
-- (20261112100001_view_settings.sql). Each person has a folder named after
-- their user id; they alone can read, add, replace or delete what is in it.
-- The browser resizes the photo to a JPEG first (src/components/sli/CalmView.tsx),
-- and the app shows it through a short-lived signed URL.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('view-photos', 'view-photos', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists "view_photos_own_select" on storage.objects;
drop policy if exists "view_photos_own_insert" on storage.objects;
drop policy if exists "view_photos_own_update" on storage.objects;
drop policy if exists "view_photos_own_delete" on storage.objects;

create policy "view_photos_own_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'view-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "view_photos_own_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'view-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "view_photos_own_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'view-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "view_photos_own_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'view-photos' and (storage.foldername(name))[1] = auth.uid()::text);
