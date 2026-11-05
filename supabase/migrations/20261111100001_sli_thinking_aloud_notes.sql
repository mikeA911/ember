-- Ember SLI: thinking aloud (docs/design-notes/ember-sli-calm-workspace.md
-- §4). The person talks an idea through, Ember organises the transcript
-- into notes, and proposes saving them to the Trigger's research. As with
-- every other proposal, nothing is saved until the person confirms; the
-- notes land in the Trigger's Research workstream as findings, marked as
-- created by the assistant. Audio is never stored (see
-- src/app/actions/speech.ts).

alter table sli_assistant_proposals drop constraint if exists sli_assistant_proposals_kind_check;
alter table sli_assistant_proposals add constraint sli_assistant_proposals_kind_check
  check (kind in ('raise_trigger', 'add_candidate', 'create_customer', 'record_recommendation', 'save_notes'));

-- Updated: save_notes.
create or replace function sli_create_proposal(
  p_kind text,
  p_payload jsonb,
  p_conversation uuid default null,
  p_tool_call text default null,
  p_trigger uuid default null
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_org uuid := sli_caller_org();
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb);
  v_trigger sli_triggers;
  v_summary text;
  v_label text;
  v_customer sli_customers;
  v_dup sli_customers;
  v_department sli_departments;
  v_proposal sli_assistant_proposals;
begin
  if v_org is null or not sli_is_org_member(v_org, v_actor) then
    raise exception 'Only members of the organisation can make SLI changes' using errcode = '42501';
  end if;
  if p_conversation is not null and not exists (select 1 from conversations where id = p_conversation and user_id = v_actor) then
    raise exception 'Conversation not found' using errcode = '42501';
  end if;
  if p_trigger is not null then
    select * into v_trigger from sli_triggers where id = p_trigger and organization_id = v_org;
    if not found or sli_trigger_access(v_trigger, v_actor) is distinct from 'full' then
      raise exception 'Trigger not found' using errcode = '42501';
    end if;
  end if;

  if p_kind = 'raise_trigger' then
    if not sli_is_department_member(v_org, v_actor) then
      raise exception 'Only members of an SLI department can raise a Trigger' using errcode = 'EC101';
    end if;
    if length(coalesce(sli_text(v_payload, 'title'), '')) < 3 then
      raise exception 'Give the Trigger a title of at least three characters' using errcode = 'EC101';
    end if;
    select label into v_label from sli_trigger_types where organization_id = v_org and code = v_payload ->> 'triggerType' and is_active;
    if v_label is null then
      raise exception 'Unknown Trigger type. Use one of: %',
        (select string_agg(code, ', ' order by sort_order) from sli_trigger_types where organization_id = v_org and is_active) using errcode = 'EC101';
    end if;
    if sli_text(v_payload, 'eventDate') is not null and sli_text(v_payload, 'eventDate') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'Give the event date as YYYY-MM-DD' using errcode = 'EC101';
    end if;
    v_summary := format('Raise “%s” as a new Trigger (%s)', sli_text(v_payload, 'title'), v_label);
    p_trigger := null;

  elsif p_kind in ('add_candidate', 'create_customer') then
    if p_kind = 'add_candidate' or v_payload ? 'candidate' then
      if v_trigger.id is null then
        raise exception 'Candidates are added in a Trigger’s conversation' using errcode = 'EC101';
      end if;
      if not (is_admin(v_actor) or sli_is_discovery_member(v_org, v_actor)) then
        raise exception 'Only the Discovery team can add candidate customers' using errcode = 'EC101';
      end if;
      if v_trigger.stage not in ('researching', 'concept', 'feasibility', 'under_review', 'approved', 'targeting') or v_trigger.archived_at is not null then
        raise exception 'Candidate customers are added during research and Targeting' using errcode = 'EC101';
      end if;
    end if;

    if p_kind = 'add_candidate' then
      begin
        select * into v_customer from sli_customers
        where id = (v_payload ->> 'customerId')::uuid and organization_id = v_org and archived_at is null;
      exception when invalid_text_representation then
        v_customer := null;
      end;
      if v_customer.id is null then
        raise exception 'Unknown company. Find it with sli_find_customers first, or propose adding it to the registry' using errcode = 'EC101';
      end if;
      if coalesce(v_payload ->> 'tier', '') not in ('existing_customer', 'related_company', 'new_prospect') then
        raise exception 'Choose the tier: existing_customer, related_company or new_prospect' using errcode = 'EC101';
      end if;
      if length(coalesce(sli_text(v_payload, 'fitRationale'), '')) < 3 then
        raise exception 'Say why this company is a candidate' using errcode = 'EC101';
      end if;
      v_payload := v_payload || jsonb_build_object('customerName', v_customer.name);
      v_summary := format('Add %s to %s’s candidate customers (%s)', v_customer.name, v_trigger.code, sli_tier_label(v_payload ->> 'tier'));
    else
      if not sli_can_edit_customers(v_org, v_actor) then
        raise exception 'Only Marketing, Sales and the Discovery team can add companies' using errcode = 'EC101';
      end if;
      if length(coalesce(sli_text(v_payload, 'name'), '')) < 2 then
        raise exception 'Give the company name' using errcode = 'EC101';
      end if;
      select * into v_dup from sli_customers c
      where c.organization_id = v_org and c.archived_at is null
        and sli_normalize_domain(v_payload ->> 'website') is not null and c.domain = sli_normalize_domain(v_payload ->> 'website')
      limit 1;
      if v_dup.id is not null then
        raise exception '% is already in the registry with this website (id %). Use that company instead', v_dup.name, v_dup.id using errcode = 'EC101';
      end if;
      select * into v_dup from sli_customers c
      where c.organization_id = v_org and c.archived_at is null and sli_normalize_name(c.name) = sli_normalize_name(v_payload ->> 'name')
      limit 1;
      if v_dup.id is not null then
        raise exception '% is already in the registry (id %). Use that company instead', v_dup.name, v_dup.id using errcode = 'EC101';
      end if;
      if v_payload ? 'candidate' then
        if coalesce(v_payload #>> '{candidate,tier}', '') not in ('existing_customer', 'related_company', 'new_prospect') then
          raise exception 'Choose the candidate tier: existing_customer, related_company or new_prospect' using errcode = 'EC101';
        end if;
        if length(trim(coalesce(v_payload #>> '{candidate,fitRationale}', ''))) < 3 then
          raise exception 'Say why this company is a candidate' using errcode = 'EC101';
        end if;
        v_summary := format('Add %s to the company registry and to %s’s candidate customers (%s)',
          sli_text(v_payload, 'name'), v_trigger.code, sli_tier_label(v_payload #>> '{candidate,tier}'));
      else
        v_summary := format('Add %s to the company registry', sli_text(v_payload, 'name'));
      end if;
    end if;

  elsif p_kind = 'record_recommendation' then
    if v_trigger.id is null then
      raise exception 'Recommendations are recorded in a Trigger’s conversation' using errcode = 'EC101';
    end if;
    if not sli_is_discovery_member(v_org, v_actor) then
      raise exception 'Only the Discovery team can record recommendations' using errcode = 'EC101';
    end if;
    if v_trigger.stage <> 'under_review' or v_trigger.archived_at is not null then
      raise exception 'Recommendations are recorded while a Trigger is under review' using errcode = 'EC101';
    end if;
    if sli_decision_role(v_org, v_actor) = 'authority' then
      raise exception 'The decision authority records a decision on the Trigger page, not a recommendation' using errcode = 'EC101';
    end if;
    if coalesce(v_payload ->> 'recommendation', '') not in ('approve', 'revise', 'defer', 'reject') then
      raise exception 'Choose approve, revise, defer or reject' using errcode = 'EC101';
    end if;
    if v_payload ->> 'recommendation' = 'approve' and sli_text(v_payload, 'destination') is not null then
      select * into v_department from sli_departments
      where organization_id = v_org and is_active and accepts_handoffs
        and (lower(code) = lower(sli_text(v_payload, 'destination')) or lower(name) = lower(sli_text(v_payload, 'destination')))
      limit 1;
      if v_department.id is null then
        raise exception 'Unknown destination. Use one of: %',
          (select string_agg(name, ', ' order by sort_order) from sli_departments where organization_id = v_org and is_active and accepts_handoffs)
          using errcode = 'EC101';
      end if;
      v_payload := v_payload || jsonb_build_object('destinationId', v_department.id, 'destinationName', v_department.name);
    else
      v_payload := v_payload - 'destination';
    end if;
    v_summary := format('Record your recommendation on %s: %s%s', v_trigger.code, v_payload ->> 'recommendation',
      case when v_department.id is not null then ', hand to ' || v_department.name else '' end);

  elsif p_kind = 'save_notes' then
    if v_trigger.id is null then
      raise exception 'Notes are saved in a Trigger’s conversation' using errcode = 'EC101';
    end if;
    if v_trigger.project_id is null or v_trigger.archived_at is not null then
      raise exception 'This Trigger has no research space to save to' using errcode = 'EC101';
    end if;
    if length(coalesce(sli_text(v_payload, 'title'), '')) < 3 then
      raise exception 'Give the notes a title' using errcode = 'EC101';
    end if;
    if length(coalesce(sli_text(v_payload, 'content'), '')) < 10 then
      raise exception 'There are no notes to save' using errcode = 'EC101';
    end if;
    if length(v_payload ->> 'content') > 100000 then
      raise exception 'The notes are too long to save in one go' using errcode = 'EC101';
    end if;
    v_summary := format('Save “%s” to %s’s research', sli_text(v_payload, 'title'), v_trigger.code);

  else
    raise exception 'Unknown proposal' using errcode = 'EC101';
  end if;

  insert into sli_assistant_proposals (organization_id, user_id, conversation_id, tool_call_id, trigger_id, kind, payload, summary)
  values (v_org, v_actor, p_conversation, p_tool_call, p_trigger, p_kind, v_payload, v_summary)
  returning * into v_proposal;
  return sli_proposal_dto(v_proposal);
end;
$$;

-- Updated: save_notes.
create or replace function sli_confirm_proposal(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := sli_writer();
  v_p sli_assistant_proposals;
  v_payload jsonb;
  v_result jsonb;
  v_customer uuid;
  v_message text;
  v_trigger sli_triggers;
  v_workstream uuid;
  v_artifact uuid;
begin
  select * into v_p from sli_assistant_proposals where id = p_id and user_id = v_actor for update;
  if not found then
    raise exception 'Proposal not found' using errcode = '42501';
  end if;
  if v_p.status <> 'proposed' then
    return sli_proposal_dto(v_p);
  end if;
  v_payload := v_p.payload;

  begin
    if v_p.kind = 'raise_trigger' then
      v_result := sli_raise_trigger(
        sli_text(v_payload, 'title'), v_payload ->> 'triggerType', coalesce(sli_text(v_payload, 'summary'), ''),
        sli_text(v_payload, 'eventDate')::date, sli_text(v_payload, 'eventReference'), sli_text(v_payload, 'strategicObjective'), null);

    elsif v_p.kind = 'add_candidate' then
      v_result := sli_add_candidate_customer(
        v_p.trigger_id, (v_payload ->> 'customerId')::uuid, v_payload ->> 'tier', sli_text(v_payload, 'fitRationale'),
        coalesce(sli_text(v_payload, 'solutionFit'), 'unknown'), sli_text(v_payload, 'priority'), sli_text(v_payload, 'relationshipPath'),
        sli_text(v_payload, 'targetIndustry'), sli_text(v_payload, 'knownRelationships'), sli_text(v_payload, 'evidenceReference'));
      update sli_trigger_candidate_customers set created_via = 'assistant'
      where trigger_id = v_p.trigger_id and customer_id = (v_payload ->> 'customerId')::uuid;
      v_result := v_result || jsonb_build_object('customerId', v_payload ->> 'customerId');

    elsif v_p.kind = 'create_customer' then
      v_customer := (sli_save_customer(
        null, sli_text(v_payload, 'name'), sli_text(v_payload, 'website'), sli_text(v_payload, 'mainPhone'),
        sli_text(v_payload, 'industry'), sli_text(v_payload, 'subIndustry'), sli_text(v_payload, 'region'),
        null, null, null, sli_text(v_payload, 'overrideReason')) ->> 'id')::uuid;
      v_result := jsonb_build_object('customerId', v_customer);
      if v_payload ? 'candidate' and v_p.trigger_id is not null then
        v_result := v_result || sli_add_candidate_customer(
          v_p.trigger_id, v_customer, v_payload #>> '{candidate,tier}', trim(v_payload #>> '{candidate,fitRationale}'),
          coalesce(nullif(trim(coalesce(v_payload #>> '{candidate,solutionFit}', '')), ''), 'unknown'),
          nullif(trim(coalesce(v_payload #>> '{candidate,priority}', '')), ''), null, null, null, null);
        update sli_trigger_candidate_customers set created_via = 'assistant' where trigger_id = v_p.trigger_id and customer_id = v_customer;
      end if;

    elsif v_p.kind = 'save_notes' then
      select * into v_trigger from sli_triggers where id = v_p.trigger_id;
      if sli_trigger_access(v_trigger, v_actor) is distinct from 'full' then
        raise exception 'You no longer have access to this Trigger' using errcode = '42501';
      end if;
      select id into v_workstream from project_workstreams where project_id = v_trigger.project_id and slug = 'research';
      if v_workstream is null or v_trigger.archived_at is not null then
        raise exception 'This Trigger has no research space to save to' using errcode = 'EC101';
      end if;
      insert into workstream_artifacts (workstream_id, artifact_type, title, content, notes, created_by, created_via, assistant_conversation_id)
      values (v_workstream, 'findings', sli_text(v_payload, 'title'), v_payload ->> 'content',
        'Notes Ember organised from the conversation; saved when ' || sli_display_name(v_actor) || ' confirmed them.',
        v_actor, 'assistant', v_p.conversation_id)
      returning id into v_artifact;
      v_result := jsonb_build_object('id', v_artifact, 'code', v_trigger.code);

    elsif v_p.kind = 'record_recommendation' then
      v_result := sli_record_recommendation(
        v_p.trigger_id, v_payload ->> 'recommendation', (v_payload ->> 'destinationId')::uuid, sli_text(v_payload, 'comments'));
    end if;

    update sli_assistant_proposals set status = 'confirmed', result = v_result, error = null, decided_at = now()
    where id = v_p.id returning * into v_p;
  exception
    when sqlstate 'EC101' or insufficient_privilege or check_violation or invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
      get stacked diagnostics v_message = message_text;
      update sli_assistant_proposals set status = 'failed', error = v_message, decided_at = now()
      where id = v_p.id returning * into v_p;
  end;

  perform sli_sync_proposal_message(v_p);
  return sli_proposal_dto(v_p);
end;
$$;

-- External MCP read-only guarantee, guarded as in the earlier SLI migrations.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
