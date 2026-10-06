-- Solution conformance and acceptance evaluation, Stage 5: Ember tools
-- (docs/dev-request-solution-conformance-and-acceptance-evaluation.md).
--
-- Ember can draft requirements (and verification methods) from the
-- Project's knowledge when a curator asks and confirms. A requirement Ember
-- drafted is marked as such and is "awaiting acceptance": it can't be added
-- to a baseline until a curator explicitly accepts it, which records who
-- accepted it and when. Ember never records results, waives, baselines or
-- approves -- none of those are reachable from its tools.
--
-- Safe to re-run.

alter table solution_requirements
  add column if not exists created_via text not null default 'ui' check (created_via in ('ui', 'assistant')),
  add column if not exists assistant_conversation_id uuid references conversations(id) on delete set null,
  add column if not exists awaiting_acceptance boolean not null default false,
  add column if not exists accepted_by uuid references profiles(id) on delete set null,
  add column if not exists accepted_at timestamptz;

alter table solution_verification_methods
  add column if not exists created_via text not null default 'ui' check (created_via in ('ui', 'assistant'));

-- An Ember draft always starts awaiting acceptance; acceptance only goes one
-- way and is stamped with the accepting user; the origin never changes.
create or replace function solution_requirements_acceptance_guard()
returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.created_via = 'assistant' then
      new.awaiting_acceptance := true;
    end if;
    new.accepted_by := null;
    new.accepted_at := null;
    return new;
  end if;
  if new.created_via is distinct from old.created_via or new.assistant_conversation_id is distinct from old.assistant_conversation_id then
    raise exception 'solution_requirements: where a requirement came from cannot change';
  end if;
  if new.awaiting_acceptance and not old.awaiting_acceptance then
    raise exception 'solution_requirements: an accepted requirement cannot go back to awaiting acceptance';
  end if;
  if old.awaiting_acceptance and not new.awaiting_acceptance then
    if old.status <> 'draft' then
      raise exception 'solution_requirements: only a draft can be accepted';
    end if;
    new.accepted_by := auth.uid();
    new.accepted_at := now();
  else
    new.accepted_by := old.accepted_by;
    new.accepted_at := old.accepted_at;
  end if;
  return new;
end;
$$;

drop trigger if exists solution_requirements_acceptance_guard on solution_requirements;
create trigger solution_requirements_acceptance_guard before insert or update on solution_requirements
  for each row execute function solution_requirements_acceptance_guard();

-- A requirement awaiting acceptance can't be baselined: the item trigger from
-- 20261020100001 gains that check (otherwise unchanged).
create or replace function solution_evaluation_baseline_items_before_write()
returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_baseline solution_evaluation_baselines%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Deleting the baseline or the Project removes items with it.
    if pg_trigger_depth() = 1 and exists (select 1 from solution_evaluation_baselines b where b.id = old.baseline_id and b.status <> 'draft') then
      raise exception 'solution_evaluation_baseline_items: an active baseline is frozen -- create a new version to change it';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'solution_evaluation_baseline_items: items are added or removed, never changed';
  end if;
  select * into v_baseline from solution_evaluation_baselines where id = new.baseline_id;
  if not found or v_baseline.project_id is distinct from new.project_id then
    raise exception 'solution_evaluation_baseline_items: must belong to its baseline''s Project';
  end if;
  if v_baseline.status <> 'draft' then
    raise exception 'solution_evaluation_baseline_items: an active baseline is frozen -- create a new version to change it';
  end if;
  if not exists (
    select 1 from solution_requirements r
    where r.id = new.requirement_id and r.project_id = v_baseline.project_id and r.status in ('draft', 'baselined')
  ) then
    raise exception 'solution_evaluation_baseline_items: only an open requirement of this Project can be baselined';
  end if;
  if exists (select 1 from solution_requirements r where r.id = new.requirement_id and r.awaiting_acceptance) then
    raise exception 'solution_evaluation_baseline_items: a requirement Ember drafted must be accepted by a curator before it can be baselined';
  end if;
  return new;
end;
$$;

-- External MCP read-only guarantee (20261005100001_external_mcp_access.sql),
-- guarded so this migration also applies before that one has run.
do $$
begin
  if to_regprocedure('public.apply_oauth_read_only_policies()') is not null then
    perform apply_oauth_read_only_policies();
  end if;
end;
$$;
