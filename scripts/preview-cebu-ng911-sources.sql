-- READ-ONLY preview for apply-cebu-ng911-sources.sql -- paste into Supabase
-- Dashboard -> SQL Editor and Run. Changes nothing.

-- 1. Both projects must exist exactly once (expect one row each).
select name, id, status from projects where name in ('Cebu ng911', 'cebu-ng911') order by name;

-- 2. Every source (file) in the old project's knowledge bases -- this is what
--    will appear under the new project's sources once attached.
select kb.id as knowledge_base_id, kb.name as knowledge_base, kb.visibility_scope,
       ks.title as source, ks.lifecycle_status,
       exists (
         select 1 from project_knowledge_bases n
         join projects np on np.id = n.project_id
         where np.name = 'cebu-ng911' and n.knowledge_base_id = kb.id
       ) as already_attached_to_new
from project_knowledge_bases pkb
join projects p on p.id = pkb.project_id
join knowledge_bases kb on kb.id = pkb.knowledge_base_id
left join knowledge_sources ks on ks.knowledge_base_id = kb.id
where p.name = 'Cebu ng911'
order by kb.name, ks.title;

-- 3. Old-project content that is NOT a source yet and will not move:
--    workstream artifacts and pending source submissions.
select 'artifact' as kind, w.name as workstream, a.title, a.artifact_type as detail, a.status
from workstream_artifacts a
join project_workstreams w on w.id = a.workstream_id
join projects p on p.id = w.project_id
where p.name = 'Cebu ng911'
union all
select 'pending submission', null, s.title, s.source_kind, s.status
from project_source_submissions s
join projects p on p.id = s.project_id
where p.name = 'Cebu ng911' and s.status = 'pending'
order by kind, title;
