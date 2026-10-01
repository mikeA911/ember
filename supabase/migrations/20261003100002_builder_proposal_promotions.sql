-- Builder proposals become client Projects (2026-10-01, Mike). A builder
-- keeps one workspace Project; each client proposal is a Workstream on it.
-- Once the client accepts, the builder submits the workstream for promotion
-- with the client's email addresses, and the builder's agency (curator, via
-- agency_builders) or the platform admin approves it. Approval creates the
-- client Project, owned by the builder, with the agency as curator and the
-- client as viewers (src/lib/workbench/workstream-promotions.ts). Each
-- approved promotion (decided_at, created_project_id) is the billable
-- "client project created" event the agency dashboard counts.
alter table workstream_promotions add column client_emails text[] not null default '{}';

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

drop policy "workstream_promotions_select_own_or_curator" on workstream_promotions;
create policy "workstream_promotions_select_own_curator_or_agency" on workstream_promotions
  for select using (
    submitted_by = auth.uid()
    or exists (select 1 from project_workstreams w where w.id = workstream_id and can_curate_project(w.project_id, auth.uid()))
    or is_builder_agency(submitted_by, auth.uid())
  );

drop policy "workstream_promotions_decide_curator" on workstream_promotions;
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
