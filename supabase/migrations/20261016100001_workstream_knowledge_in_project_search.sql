-- Workstream knowledge counts as Project knowledge, and readiness coverage
-- counts exactly what Ember searches (docs/dev-request-ember-readiness-and-
-- knowledge-gaps.md, follow-up).
--
-- 1. A knowledge base attached to one of a Project's workstreams
--    (workstream_knowledge_bases) is now readable by that Project's members
--    the same way a Project-attached one is, and Ember's Project search
--    treats its approved chunks as Project evidence. Until now the read
--    policies only recognised project_knowledge_bases, so a private
--    workstream knowledge base was invisible to Ember (and to members).
--    Curation is unchanged: only approved chunks are embedded, and
--    has_evidence_access() still restricts individual sources.
-- 2. project_ember_readiness_signals() counts sources in exactly the
--    knowledge bases Project search uses (attached to the Project or to one
--    of its workstreams) and only Wiki articles attached to the Project --
--    not the legacy knowledge_bases.project_id link or Wiki articles that
--    merely sit in a Project knowledge base, which search treats as
--    platform evidence.

-- Membership path to a non-public knowledge base: attached to a Project the
-- caller belongs to, or to a workstream of one. Strict membership (no admin
-- bypass), same as the policies it replaces inline.
create or replace function knowledge_base_readable_via_project(p_kb_id text, uid uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from project_knowledge_bases pkb
    where pkb.knowledge_base_id = p_kb_id and is_project_member_strict(pkb.project_id, uid)
  ) or exists (
    select 1 from workstream_knowledge_bases wkb
    join project_workstreams w on w.id = wkb.workstream_id
    where wkb.knowledge_base_id = p_kb_id and is_project_member_strict(w.project_id, uid)
  );
$$;

-- The three read policies from 20260825110001_project_evidence_access_
-- enforcement.sql, unchanged except that the project_knowledge_bases-only
-- check becomes knowledge_base_readable_via_project().

drop policy "knowledge_sources_select_staff_or_owner_or_project_member" on knowledge_sources;
create policy "knowledge_sources_select_staff_or_owner_or_project_member" on knowledge_sources
  for select using (
    has_evidence_access('knowledge_source', knowledge_sources.id, auth.uid())
    and (
      is_curator_or_admin(auth.uid())
      or created_by = auth.uid()
      or exists (
        select 1 from knowledge_bases kb
        where kb.id = knowledge_sources.knowledge_base_id
        and (
          kb.visibility_scope in ('platform', 'public')
          or (
            kb.visibility_scope in ('project_private', 'selected_projects')
            and knowledge_base_readable_via_project(kb.id, auth.uid())
          )
        )
      )
    )
  );

drop policy "documents_select_staff_or_owner_or_project_member" on documents;
create policy "documents_select_staff_or_owner_or_project_member" on documents
  for select using (
    has_evidence_access('knowledge_source', documents.knowledge_source_id, auth.uid())
    and (
      is_curator_or_admin(auth.uid())
      or uploaded_by = auth.uid()
      or exists (
        select 1 from knowledge_sources ks
        join knowledge_bases kb on kb.id = ks.knowledge_base_id
        where ks.id = documents.knowledge_source_id
        and (
          kb.visibility_scope in ('platform', 'public')
          or (
            kb.visibility_scope in ('project_private', 'selected_projects')
            and knowledge_base_readable_via_project(kb.id, auth.uid())
          )
        )
      )
    )
  );

drop policy "kb_vectors_select_scoped" on kb_vectors;
create policy "kb_vectors_select_scoped" on kb_vectors
  for select using (
    exists (
      select 1 from documents d
      join knowledge_sources ks on ks.current_version_id = d.id
      join knowledge_bases kb on kb.id = ks.knowledge_base_id
      where d.id = kb_vectors.document_id
      and has_evidence_access('knowledge_source', ks.id, auth.uid())
      and (
        kb.visibility_scope in ('platform', 'public')
        or (
          kb.visibility_scope in ('project_private', 'selected_projects')
          and knowledge_base_readable_via_project(kb.id, auth.uid())
        )
      )
    )
  );

-- Readiness coverage = Project search scope -----------------------------------------
-- Same return type as 20261014100001, so create or replace is enough.
create or replace function project_ember_readiness_signals(pids uuid[])
returns table (
  project_id uuid,
  measured_run_id uuid,
  measured_dataset_name text,
  measured_at timestamptz,
  measured_questions integer,
  measured_passed integer,
  source_count integer,
  searchable_source_count integer,
  wiki_article_count integer,
  last_source_added_at timestamptz,
  open_gap_count integer
)
language sql stable security definer set search_path = public as $$
  with allowed as (
    select distinct p.id from unnest(pids) as p(id) where is_project_member(p.id, auth.uid())
  ),
  project_kbs as (
    select pkb.project_id, pkb.knowledge_base_id as kb_id
    from project_knowledge_bases pkb join allowed a on a.id = pkb.project_id
    union
    select w.project_id, wkb.knowledge_base_id
    from workstream_knowledge_bases wkb
    join project_workstreams w on w.id = wkb.workstream_id
    join allowed a on a.id = w.project_id
  ),
  sources as (
    select pk.project_id, ks.id, ks.created_at, ks.current_version_id
    from project_kbs pk
    join knowledge_sources ks on ks.knowledge_base_id = pk.kb_id
    where ks.lifecycle_status = 'active'
  ),
  articles as (
    select pwa.project_id, w.id
    from project_wiki_articles pwa
    join allowed a on a.id = pwa.project_id
    join wiki_articles w on w.id = pwa.wiki_article_id
    where w.status = 'approved'
  )
  select
    a.id,
    m.run_id,
    m.dataset_name,
    m.completed_at,
    m.question_count,
    m.passed_count,
    (select count(distinct s.id) from sources s where s.project_id = a.id)::integer,
    (select count(distinct s.id) from sources s
      where s.project_id = a.id
        and exists (select 1 from document_chunks dc where dc.document_id = s.current_version_id and dc.review_status = 'approved'))::integer,
    (select count(distinct ar.id) from articles ar where ar.project_id = a.id)::integer,
    (select max(s.created_at) from sources s where s.project_id = a.id),
    (select count(*) from project_knowledge_gaps g
      where g.project_id = a.id and g.status in ('new', 'needs_source', 'wiki_needed'))::integer
  from allowed a
  left join lateral project_measured_score(a.id) m on true;
$$;

revoke execute on function project_ember_readiness_signals(uuid[]) from public, anon;
grant execute on function project_ember_readiness_signals(uuid[]) to authenticated;
