-- Solution conformance and acceptance evaluation, Stage 1: the requirements
-- register (docs/dev-request-solution-conformance-and-acceptance-
-- evaluation.md).
--
-- A requirement is one verifiable statement the Project's delivered
-- solution must satisfy, traced to where it came from (a standard clause,
-- regulation, contract term, customer need or vendor claim), scoped to the
-- workstreams and Project objects it concerns, and given one or more
-- verification methods with explicit pass criteria. Later stages add
-- verification records, frozen baselines with conformance decisions, and
-- re-verification triggers.
--
-- Editing: a requirement and its sources, scope and methods can be changed
-- only while it is a draft. Once baselined (Stage 3) its content is fixed;
-- it can only be withdrawn or superseded by a new requirement.

create table solution_requirements (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references projects(id) on delete cascade,
  code text not null check (length(trim(code)) > 0),
  title text not null check (length(trim(title)) > 0),
  statement text not null check (length(trim(statement)) > 0),
  rationale text,
  category text not null
    check (category in ('functional', 'interface', 'performance', 'security', 'privacy', 'operational', 'regulatory', 'contractual')),
  priority text not null default 'must' check (priority in ('must', 'should', 'could')),
  applies_from text not null default 'deployment' check (applies_from in ('presales', 'deployment', 'management_maintenance')),
  status text not null default 'draft' check (status in ('draft', 'baselined', 'superseded', 'withdrawn')),
  superseded_by uuid references solution_requirements(id) on delete set null,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, code)
);

create index solution_requirements_project_idx on solution_requirements(project_id, status);

create trigger solution_requirements_set_updated_at before update on solution_requirements
  for each row execute function set_updated_at();

-- Content is fixed once a requirement leaves draft: only the status (to
-- withdrawn or superseded) and superseded_by may change.
create or replace function solution_requirements_before_update()
returns trigger
language plpgsql set search_path = public as $$
begin
  if new.project_id is distinct from old.project_id or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
    raise exception 'solution_requirements: project and author cannot change';
  end if;
  if old.status <> 'draft' and (
    new.code is distinct from old.code
    or new.title is distinct from old.title
    or new.statement is distinct from old.statement
    or new.rationale is distinct from old.rationale
    or new.category is distinct from old.category
    or new.priority is distinct from old.priority
    or new.applies_from is distinct from old.applies_from
  ) then
    raise exception 'solution_requirements: only a draft requirement can be edited -- withdraw it or supersede it with a new one';
  end if;
  if old.status in ('superseded', 'withdrawn') and new.status is distinct from old.status then
    raise exception 'solution_requirements: a superseded or withdrawn requirement cannot be reopened';
  end if;
  return new;
end;
$$;

create trigger solution_requirements_before_update before update on solution_requirements
  for each row execute function solution_requirements_before_update();

-- Whether a requirement can still be edited (draft). Used by the child
-- tables' write policies.
create or replace function solution_requirement_is_draft(p_requirement_id uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from solution_requirements r where r.id = p_requirement_id and r.status = 'draft');
$$;

-- Sources ---------------------------------------------------------------------------
create table solution_requirement_sources (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references solution_requirements(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  kind text not null check (kind in ('standard', 'regulation', 'contract', 'customer_need', 'vendor_claim')),
  -- Where it lives in the knowledge, when it does. document_version_id is
  -- the source's version at the time it was cited (set by the trigger), so
  -- a later version can mark the requirement for review (Stage 4).
  knowledge_source_id uuid references knowledge_sources(id) on delete set null,
  document_version_id uuid references documents(id) on delete set null,
  wiki_article_id uuid references wiki_articles(id) on delete set null,
  -- Human-readable clause locator: section, table, page, clause number.
  locator text,
  -- Who asked, for a customer need.
  requester text,
  note text,
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind <> 'customer_need' or length(trim(coalesce(requester, ''))) > 0)
);

create index solution_requirement_sources_requirement_idx on solution_requirement_sources(requirement_id);
create index solution_requirement_sources_knowledge_source_idx on solution_requirement_sources(knowledge_source_id);

-- Scope -----------------------------------------------------------------------------
create table solution_requirement_scope_links (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references solution_requirements(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  workstream_id uuid references project_workstreams(id) on delete cascade,
  project_object_id uuid references project_objects(id) on delete cascade,
  created_at timestamptz not null default now(),
  check ((workstream_id is null) <> (project_object_id is null))
);

create unique index solution_requirement_scope_links_workstream_uniq
  on solution_requirement_scope_links(requirement_id, workstream_id) where workstream_id is not null;
create unique index solution_requirement_scope_links_object_uniq
  on solution_requirement_scope_links(requirement_id, project_object_id) where project_object_id is not null;
create index solution_requirement_scope_links_workstream_idx on solution_requirement_scope_links(workstream_id);

-- Verification methods --------------------------------------------------------------
create table solution_verification_methods (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references solution_requirements(id) on delete cascade,
  project_id uuid not null references projects(id) on delete cascade,
  method text not null
    check (method in ('test', 'demonstration', 'inspection', 'analysis', 'vendor_evidence', 'operational_measure')),
  procedure text,
  pass_criteria text not null check (length(trim(pass_criteria)) > 0),
  -- Required for an operational measure: the threshold and the window it
  -- is measured over (e.g. ">= 90% answered within 15 s", "monthly").
  threshold text,
  measure_window text,
  performed_by text not null default 'integrator'
    check (performed_by in ('vendor', 'integrator', 'customer', 'independent_tester', 'project_team')),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (method <> 'operational_measure' or (length(trim(coalesce(threshold, ''))) > 0 and length(trim(coalesce(measure_window, ''))) > 0))
);

create index solution_verification_methods_requirement_idx on solution_verification_methods(requirement_id);

create trigger solution_verification_methods_set_updated_at before update on solution_verification_methods
  for each row execute function set_updated_at();

-- Consistency: a child row belongs to its requirement's Project; a scope link
-- points inside that Project; a cited source records its current version.
create or replace function solution_requirement_child_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_project_id uuid;
begin
  select project_id into v_project_id from solution_requirements where id = new.requirement_id;
  if v_project_id is null or new.project_id is distinct from v_project_id then
    raise exception '%: must belong to its requirement''s Project', tg_table_name;
  end if;

  if tg_table_name = 'solution_requirement_scope_links' then
    if new.workstream_id is not null and not exists (select 1 from project_workstreams w where w.id = new.workstream_id and w.project_id = v_project_id) then
      raise exception 'solution_requirement_scope_links: the workstream must be in this Project';
    end if;
    if new.project_object_id is not null and not exists (select 1 from project_objects o where o.id = new.project_object_id and o.project_id = v_project_id) then
      raise exception 'solution_requirement_scope_links: the Project object must be in this Project';
    end if;
  end if;

  -- Nested, not one "and": PL/pgSQL resolves new.<field> even when an
  -- earlier condition is false, and only the sources table has it.
  if tg_table_name = 'solution_requirement_sources' and tg_op = 'INSERT' then
    if new.knowledge_source_id is not null then
      select current_version_id into new.document_version_id from knowledge_sources where id = new.knowledge_source_id;
    end if;
  end if;
  return new;
end;
$$;

create trigger solution_requirement_sources_before_write before insert or update on solution_requirement_sources
  for each row execute function solution_requirement_child_before_write();
create trigger solution_requirement_scope_links_before_write before insert or update on solution_requirement_scope_links
  for each row execute function solution_requirement_child_before_write();
create trigger solution_verification_methods_before_write before insert or update on solution_verification_methods
  for each row execute function solution_requirement_child_before_write();

-- RLS ---------------------------------------------------------------------------------
-- Every Project member reads the register; the Project's owner/curators and
-- platform admins write it (can_curate_project). Children are writable only
-- while their requirement is a draft. A source restricted by evidence access
-- is hidden from members without a grant -- curators included, so the write
-- policies are split by command (a "for all" policy would also grant select
-- and bypass that check).

alter table solution_requirements enable row level security;
alter table solution_requirement_sources enable row level security;
alter table solution_requirement_scope_links enable row level security;
alter table solution_verification_methods enable row level security;

create policy "solution_requirements_select_member" on solution_requirements
  for select using (is_project_member(project_id, auth.uid()));
create policy "solution_requirements_insert_curator" on solution_requirements
  for insert with check (can_curate_project(project_id, auth.uid()) and created_by = auth.uid() and status = 'draft');
create policy "solution_requirements_update_curator" on solution_requirements
  for update using (can_curate_project(project_id, auth.uid())) with check (can_curate_project(project_id, auth.uid()));
create policy "solution_requirements_delete_curator_draft" on solution_requirements
  for delete using (can_curate_project(project_id, auth.uid()) and status = 'draft');

create policy "solution_requirement_sources_select_member" on solution_requirement_sources
  for select using (
    is_project_member(project_id, auth.uid())
    and (knowledge_source_id is null or has_evidence_access('knowledge_source', knowledge_source_id, auth.uid()))
    and (wiki_article_id is null or has_evidence_access('wiki_article', wiki_article_id, auth.uid()))
  );
create policy "solution_requirement_sources_insert_curator_draft" on solution_requirement_sources
  for insert with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_requirement_sources_update_curator_draft" on solution_requirement_sources
  for update using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id))
  with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_requirement_sources_delete_curator_draft" on solution_requirement_sources
  for delete using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));

create policy "solution_requirement_scope_links_select_member" on solution_requirement_scope_links
  for select using (is_project_member(project_id, auth.uid()));
create policy "solution_requirement_scope_links_insert_curator_draft" on solution_requirement_scope_links
  for insert with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_requirement_scope_links_update_curator_draft" on solution_requirement_scope_links
  for update using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id))
  with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_requirement_scope_links_delete_curator_draft" on solution_requirement_scope_links
  for delete using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));

create policy "solution_verification_methods_select_member" on solution_verification_methods
  for select using (is_project_member(project_id, auth.uid()));
create policy "solution_verification_methods_insert_curator_draft" on solution_verification_methods
  for insert with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_verification_methods_update_curator_draft" on solution_verification_methods
  for update using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id))
  with check (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));
create policy "solution_verification_methods_delete_curator_draft" on solution_verification_methods
  for delete using (can_curate_project(project_id, auth.uid()) and solution_requirement_is_draft(requirement_id));

-- External MCP read-only guarantee: an OAuth client token can never write
-- these tables (20261005100001_external_mcp_access.sql). Guarded so this
-- migration also applies to a database where that migration has not run
-- yet. When it does run, its own call covers every RLS table that exists by
-- then, these included.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
