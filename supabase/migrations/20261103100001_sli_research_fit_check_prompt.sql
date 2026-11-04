-- Ember SLI, S2 stage 3, part 2: the fit check as the research space's
-- starter prompt (docs/dev-request-sandz-sli-discovery-and-triggers.md §5,
-- "Fit check").
--
-- A Trigger's research is an Ember conversation bound to its Project. The
-- Project's starter_prompt is offered as a one-click suggestion in that
-- conversation, so the first thing a sponsor sees is the fit check: five
-- headings, every point sourced, web results treated as leads, a list of
-- what Ember could not find, and the result saved as a Findings artifact in
-- the Research Workstream (attach_workstream_artifact).
--
-- Safe to re-run.

create or replace function sli_fit_check_prompt()
returns text
language sql immutable as $$
  select 'Run a fit check on this Trigger. Use Sandz''s own knowledge first, then web research. '
    || 'Assess it under five headings: Strategic fit (does it match Sandz''s direction and partners?), '
    || 'Capability fit (can Sandz and its partners deliver it today, and what is missing?), '
    || 'Market attractiveness (how many companies in the Philippines are affected, and how urgently?), '
    || 'Competition (who else offers this, and how is Sandz different?), and Risks and unknowns. '
    || 'Give each heading a short verdict and cite the source of every point. Treat web results as leads, not facts. '
    || 'End with a list of what you could not find. '
    || 'Then save the result as a Findings artifact titled "Fit check" in the Research workstream.'
$$;

create or replace function sli_provision_trigger_research(p_trigger uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trigger sli_triggers;
  v_project uuid;
  v_workstream uuid;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found then
    return;
  end if;

  if v_trigger.project_id is null then
    v_project := gen_random_uuid();
    insert into sli_project_reservations (project_id, organization_id, trigger_id)
    values (v_project, v_trigger.organization_id, v_trigger.id);

    insert into projects (
      id, name, project_type, objective, status, owner_id, visibility, discoverability,
      information_sensitivity, portfolio_category, details, starter_prompt
    ) values (
      v_project,
      left(v_trigger.code || ' · ' || v_trigger.title, 200),
      'experiment',
      nullif(left(v_trigger.summary, 2000), ''),
      'active',
      v_trigger.sponsor_id,
      'private',
      'members_only',
      v_trigger.information_sensitivity,
      'sandz',
      jsonb_build_object('sli_trigger_id', v_trigger.id, 'sli_trigger_code', v_trigger.code, 'sli_organization_id', v_trigger.organization_id),
      sli_fit_check_prompt()
    );

    update sli_triggers set project_id = v_project where id = v_trigger.id;
  else
    v_project := v_trigger.project_id;
  end if;

  if v_trigger.workstream_id is null then
    insert into project_workstreams (project_id, name, slug, status, goal, created_by)
    values (v_project, 'Research', 'research', 'active',
      'Research ' || v_trigger.code || ': ' || v_trigger.title || '. Is it worth pursuing, and does it suit Sandz?',
      v_trigger.sponsor_id)
    on conflict (project_id, slug) do nothing
    returning id into v_workstream;
    if v_workstream is null then
      select id into v_workstream from project_workstreams where project_id = v_project and slug = 'research';
    end if;
    update sli_triggers set workstream_id = v_workstream where id = v_trigger.id;
  end if;

  perform sli_sync_trigger_project_members(v_trigger.id);
end;
$$;

revoke all on function sli_provision_trigger_research(uuid) from public, anon, authenticated;

-- Research spaces created before this migration get the prompt too, unless
-- someone already set one.
update projects p
set starter_prompt = sli_fit_check_prompt()
from sli_triggers t
where t.project_id = p.id and p.starter_prompt is null;
