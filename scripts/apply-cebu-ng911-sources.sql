-- SQL Editor version of copy-cebu-ng911-sources.mjs --apply. Run
-- preview-cebu-ng911-sources.sql first to see what this will do.
--
-- Attaches every knowledge base of the old "Cebu ng911" Project to the new
-- "cebu-ng911" Project, so all their sources (files) appear on the new
-- Project -- same documents, versions and approval state; nothing is
-- re-uploaded or duplicated. A project_private knowledge base is re-scoped
-- to selected_projects (the scope for sharing one knowledge base across
-- Projects), which gives the new Project's members access to it.
-- Idempotent: already-attached knowledge bases are skipped. All-or-nothing:
-- any error (e.g. an inactive knowledge base, which
-- project_knowledge_bases_require_active_kb rejects) rolls the whole run back.
do $$
declare
  v_old uuid;
  v_new uuid;
  v_actor uuid;
  v_count int;
begin
  select count(*) into v_count from projects where name = 'Cebu ng911';
  if v_count <> 1 then raise exception 'Expected exactly one project named "Cebu ng911", found %', v_count; end if;
  select count(*) into v_count from projects where name = 'cebu-ng911';
  if v_count <> 1 then raise exception 'Expected exactly one project named "cebu-ng911", found % -- run apply-cebu-ng911-project.sql first', v_count; end if;

  select id into v_old from projects where name = 'Cebu ng911';
  select id into v_new from projects where name = 'cebu-ng911';
  select id into v_actor from profiles where email = 'mike.aguilar@gmail.com';
  if v_actor is null then raise exception 'mike.aguilar@gmail.com profile not found'; end if;

  -- Re-scope first (same transaction, so it rolls back with a failed attach).
  update knowledge_bases kb
  set visibility_scope = 'selected_projects'
  from project_knowledge_bases old_link
  where old_link.project_id = v_old
    and old_link.knowledge_base_id = kb.id
    and kb.visibility_scope = 'project_private'
    and not exists (
      select 1 from project_knowledge_bases n where n.project_id = v_new and n.knowledge_base_id = kb.id
    );

  insert into project_knowledge_bases (project_id, knowledge_base_id, purpose, attached_by)
  select v_new, old_link.knowledge_base_id, old_link.purpose, v_actor
  from project_knowledge_bases old_link
  where old_link.project_id = v_old
  on conflict (project_id, knowledge_base_id) do nothing;
end $$;

-- Result: the new project's knowledge bases and their sources.
select kb.name as knowledge_base, kb.visibility_scope, count(ks.id) as sources
from project_knowledge_bases pkb
join projects p on p.id = pkb.project_id
join knowledge_bases kb on kb.id = pkb.knowledge_base_id
left join knowledge_sources ks on ks.knowledge_base_id = kb.id
where p.name = 'cebu-ng911'
group by kb.name, kb.visibility_scope
order by kb.name;
