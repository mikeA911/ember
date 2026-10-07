-- Methods outlive the workstream they came from (2026-10-07, Mike).
-- methods.derived_from_workstream_id was required and cascaded, so deleting
-- the source workstream (or its Project) deleted the Method -- even a
-- published one other builders were using. Now the link is cleared
-- instead, and the Method stays.
--
-- Draft access used to be worked out only through that workstream (whoever
-- can curate its Project). The Method's creator now keeps their own draft
-- too, so it isn't orphaned when the workstream goes. Published Methods are
-- unchanged: visible to everyone, published only by platform staff. Only a
-- draft can be edited this way -- before, the originator could edit a
-- published Method by setting it back to draft, unpublishing it for
-- everyone.
--
-- Safe to re-run.

alter table methods alter column derived_from_workstream_id drop not null;

do $$
declare
  v_constraint text;
begin
  select con.conname into v_constraint
  from pg_constraint con
  join pg_attribute att on att.attrelid = con.conrelid and att.attnum = any (con.conkey)
  where con.conrelid = 'public.methods'::regclass
    and con.contype = 'f'
    and att.attname = 'derived_from_workstream_id';
  if v_constraint is not null then
    execute format('alter table methods drop constraint %I', v_constraint);
  end if;
end;
$$;

alter table methods
  add constraint methods_derived_from_workstream_id_fkey
  foreign key (derived_from_workstream_id) references project_workstreams(id) on delete set null;

drop policy if exists "methods_select_published_or_own_draft" on methods;
create policy "methods_select_published_or_own_draft" on methods
  for select using (
    status = 'published'
    or is_curator_or_admin(auth.uid())
    or created_by = auth.uid()
    or exists (
      select 1 from project_workstreams w
      where w.id = derived_from_workstream_id and can_curate_project(w.project_id, auth.uid())
    )
  );

drop policy if exists "methods_manage_own_draft" on methods;
create policy "methods_manage_own_draft" on methods
  for update
  using (
    status = 'draft'
    and (
      created_by = auth.uid()
      or exists (
        select 1 from project_workstreams w
        where w.id = derived_from_workstream_id and can_curate_project(w.project_id, auth.uid())
      )
    )
  )
  with check (
    status = 'draft'
    and (
      created_by = auth.uid()
      or exists (
        select 1 from project_workstreams w
        where w.id = derived_from_workstream_id and can_curate_project(w.project_id, auth.uid())
      )
    )
  );
