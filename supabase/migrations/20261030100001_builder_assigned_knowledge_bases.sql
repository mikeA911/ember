-- Knowledge bases the platform admin assigns to a builder (2026-10-07,
-- Mike). profiles.assigned_kbs records the assignment; the service layer
-- (src/lib/workbench/builder-knowledge-bases.ts) attaches each one to the
-- builder's workspace with purpose 'assigned_by_platform', so every
-- existing project-membership rule (knowledge bases, sources, documents,
-- wiki articles, Ember's retrieval) lets the builder see it -- including a
-- project_private or selected_projects knowledge base they could never
-- attach themselves.
--
-- Only the platform admin removes an assigned attachment: the builder, as
-- their workspace's owner, still detaches anything they attached.
--
-- Safe to re-run.

drop policy if exists "project_knowledge_bases_delete_curator" on project_knowledge_bases;
create policy "project_knowledge_bases_delete_curator" on project_knowledge_bases
  for delete using (
    can_curate_project(project_id, auth.uid())
    and (purpose is distinct from 'assigned_by_platform' or is_admin(auth.uid()))
  );

-- Inserting an assigned attachment is the admin's (service layer's) call.
drop policy if exists "project_knowledge_bases_insert_curator" on project_knowledge_bases;
create policy "project_knowledge_bases_insert_curator" on project_knowledge_bases
  for insert with check (
    can_curate_project(project_id, auth.uid())
    and (purpose is distinct from 'assigned_by_platform' or is_admin(auth.uid()))
  );
