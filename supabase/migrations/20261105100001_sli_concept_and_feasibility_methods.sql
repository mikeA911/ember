-- Ember SLI, S2 stage 4: Concept development and Feasibility assessment
-- (docs/dev-request-sandz-sli-discovery-and-triggers.md §5, DISC-03).
--
-- Two published Methods hold the structure and rules of a concept paper
-- and a feasibility assessment. When a Trigger enters Concept or
-- Feasibility, sli_apply_research_stage() creates that stage's Workstream
-- in the Trigger's research Project from its Method (the Method's
-- guardrails become the Workstream's guidance, which Ember reads through
-- list_workstreams) and switches the research conversation's one-click
-- starter prompt to that stage's task. Moving back to Researching restores
-- the fit check. The papers are saved as artifacts in their Workstreams.
--
-- The Methods are ordinary published Methods (any curator can refine them
-- in Ember); SLI finds them by slug. Safe to re-run.

insert into methods (name, slug, description, requirements, evidence, deliverables, guardrails, review_points, status, published_at)
values
(
  'Concept development',
  'sli-concept-development',
  'Turn a researched Trigger into a short concept paper: the opportunity, the proposed solution, who it is for, how Sandz would earn from it, and what feasibility must check.',
  'A Trigger accepted into research, with its fit check and research notes saved.',
  'The fit check, research findings and sources saved to the Trigger''s Research workstream; Sandz knowledge on partner products and capabilities.',
  'A concept paper of about two pages, saved as an artifact titled "Concept paper" in the Concept workstream.',
  'Write the concept paper with these sections:
1. The opportunity: what happened or what customers need, who is affected, and why now.
2. Proposed solution: what Sandz would offer, with tiers or options where useful.
3. Target market: industries, company profile and buyer roles, in the Philippines first.
4. Business model: how Sandz earns (one-off services, recurring managed services, resale).
5. Partners and dependencies: which partner products it relies on, and what Sandz must build, learn or source.
6. Differentiation: why customers would choose Sandz over the alternatives.
7. Questions for feasibility: what must be checked before management decides.
Rules: build on the saved fit check and research; cite the source of every fact; label assumptions as assumptions; quote no prices or commitments to customers; keep it to about two pages.',
  'Is the opportunity specific? Is the target market narrow enough to act on? Are the open questions the ones feasibility can answer?',
  'published',
  now()
),
(
  'Feasibility assessment',
  'sli-feasibility-assessment',
  'Test a concept before management decides: can Sandz deliver it, can it make money, what could go wrong, and what must be true for it to succeed.',
  'A concept paper saved in the Trigger''s Concept workstream.',
  'The concept paper, the fit check, partner product material, Presales and Engineering input, and costed estimates with their basis.',
  'A feasibility assessment saved as an artifact titled "Feasibility assessment" in the Feasibility workstream, ending in a recommendation for management.',
  'Write the feasibility assessment with these sections:
1. Technical feasibility: can it be delivered with Sandz''s and its partners'' products; gaps and workarounds.
2. Capacity and delivery: people, skills, partner capacity and realistic timelines.
3. Commercial feasibility: indicative costs, the pricing approach compared with the alternatives customers have, and what drives the margin. Label every estimate with its basis.
4. Risks: technical, commercial, delivery and regulatory (including the Data Privacy Act), each with likelihood, impact and mitigation.
5. Conditions for success: what must be true, stated so it can be measured (for example a prototype accuracy target).
6. Recommendation: approve, revise, defer or reject, with the reasons, for management''s decision.
Rules: build on the concept paper; cite the source of every fact; keep facts and estimates apart; list what could not be verified.',
  'Are the estimates traceable to a basis? Are the conditions measurable? Does the recommendation follow from the findings?',
  'published',
  now()
)
on conflict (slug) do nothing;

-- The research conversation's starter prompt for each stage.
create or replace function sli_stage_prompt(p_stage text)
returns text
language sql immutable as $$
  select case p_stage
    when 'concept' then
      'Draft the concept paper for this Trigger. First call list_workstreams and follow the guidance of the Concept workstream (the Concept development method). '
      || 'Build on the saved fit check and research, cite your sources and label assumptions. '
      || 'Then save the paper as an artifact titled "Concept paper" in the Concept workstream.'
    when 'feasibility' then
      'Draft the feasibility assessment for this Trigger. First call list_workstreams and follow the guidance of the Feasibility workstream (the Feasibility assessment method). '
      || 'Build on the concept paper, keep facts and estimates apart, and end with a recommendation for management. '
      || 'Then save it as an artifact titled "Feasibility assessment" in the Feasibility workstream.'
    else sli_fit_check_prompt()
  end
$$;

-- Creates the stage's Workstream from its Method (once) and sets the
-- starter prompt. Researching (and anything else) restores the fit check.
create or replace function sli_apply_research_stage(p_trigger uuid, p_stage text)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_trigger sli_triggers;
  v_method methods;
  v_slug text;
  v_name text;
  v_deliverable text;
begin
  select * into v_trigger from sli_triggers where id = p_trigger;
  if not found or v_trigger.project_id is null then
    return;
  end if;

  if p_stage in ('concept', 'feasibility') then
    v_slug := p_stage;
    v_name := case p_stage when 'concept' then 'Concept' else 'Feasibility' end;
    v_deliverable := case p_stage when 'concept' then 'Concept paper' else 'Feasibility assessment' end;
    select * into v_method from methods
    where slug = case p_stage when 'concept' then 'sli-concept-development' else 'sli-feasibility-assessment' end
      and status = 'published';

    insert into project_workstreams (project_id, name, slug, status, goal, guardrail, deliverables, derived_from_method_id, created_by)
    values (
      v_trigger.project_id, v_name, v_slug, 'active',
      v_deliverable || ' for ' || v_trigger.code || ': ' || v_trigger.title,
      v_method.guardrails,
      jsonb_build_array(jsonb_build_object('label', v_deliverable, 'completed', false)),
      v_method.id,
      v_trigger.sponsor_id
    )
    on conflict (project_id, slug) do nothing;
  end if;

  update projects set starter_prompt = sli_stage_prompt(p_stage) where id = v_trigger.project_id;
end;
$$;

revoke all on function sli_apply_research_stage(uuid, text) from public, anon, authenticated;

create or replace function sli_transition_trigger(p_trigger uuid, p_to_stage text, p_reason text default null)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_trigger sli_triggers;
  v_rule record;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
  v_allowed boolean;
  v_from text;
begin
  select * into v_trigger from sli_triggers where id = p_trigger for update;
  if not found or sli_trigger_access(v_trigger, v_actor) is null then
    raise exception 'Trigger not found' using errcode = '42501';
  end if;
  if v_trigger.archived_at is not null then
    raise exception 'This Trigger is archived. Unarchive it first.' using errcode = 'EC101';
  end if;

  select * into v_rule from sli_trigger_transition(v_trigger.stage, p_to_stage);
  if not found then
    if v_trigger.stage = 'under_review' then
      raise exception 'A Trigger under review moves on only with a management decision' using errcode = 'EC101';
    end if;
    raise exception 'A Trigger can''t move from % to %', v_trigger.stage, p_to_stage using errcode = 'EC101';
  end if;

  v_allowed := is_admin(v_actor) or case v_rule.actor
    when 'sponsor_pool' then sli_can_sponsor(v_trigger.organization_id, v_actor)
    when 'sponsor' then v_trigger.sponsor_id = v_actor and sli_is_org_member(v_trigger.organization_id, v_actor)
    when 'discovery' then sli_is_discovery_member(v_trigger.organization_id, v_actor)
    else false
  end;
  if not v_allowed then
    raise exception '%', case v_rule.actor
      when 'sponsor_pool' then 'Only a Discovery team sponsor can accept or decline a Trigger'
      when 'sponsor' then 'Only the Trigger''s sponsor can do that'
      else 'Only the Discovery team can do that'
    end using errcode = '42501';
  end if;
  if v_rule.reason_required and v_reason is null then
    raise exception 'Give a reason' using errcode = 'EC101';
  end if;

  v_from := v_trigger.stage;
  update sli_triggers
  set stage = p_to_stage,
      sponsor_id = case when v_rule.action = 'accept' then coalesce(sponsor_id, v_actor) else sponsor_id end
  where id = v_trigger.id
  returning * into v_trigger;

  insert into sli_trigger_stage_history (organization_id, trigger_id, event, from_stage, to_stage, reason, changed_by)
  values (v_trigger.organization_id, v_trigger.id, 'stage_change', v_from, p_to_stage, v_reason, v_actor);

  -- Accepted into research: the Trigger gets its private research space,
  -- and the stage's Workstream and starter prompt (Concept, Feasibility).
  if p_to_stage in ('researching', 'concept', 'feasibility') then
    perform sli_provision_trigger_research(v_trigger.id);
    perform sli_apply_research_stage(v_trigger.id, p_to_stage);
  end if;

  return jsonb_build_object('id', v_trigger.id, 'code', v_trigger.code, 'stage', v_trigger.stage);
end;
$$;

-- Triggers already in Concept or Feasibility get their stage Workstreams.
do $$
declare
  t record;
begin
  for t in select id, stage from sli_triggers where project_id is not null and stage in ('concept', 'feasibility') loop
    perform sli_apply_research_stage(t.id, 'concept');
    if t.stage = 'feasibility' then
      perform sli_apply_research_stage(t.id, 'feasibility');
    end if;
  end loop;
end;
$$;
