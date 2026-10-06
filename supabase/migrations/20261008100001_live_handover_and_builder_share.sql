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
