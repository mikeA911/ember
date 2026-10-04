-- AI cost report and cached-token pricing (2026-10-04, Mike).
--
-- ai_models.cached_input_cost_per_million: what the provider charges for
-- input tokens served from its prompt cache (OpenAI, Gemini and DeepSeek
-- all discount them). Null means "not set": cached tokens are then charged
-- at the full input price, so cost is never understated
-- (src/lib/ai/metering.ts computeCost).
alter table ai_models add column if not exists cached_input_cost_per_million numeric
  check (cached_input_cost_per_million is null or cached_input_cost_per_million >= 0);

-- Daily totals per task, provider, model and kind of call, for the admin
-- cost report (src/lib/workbench/ai-cost-report.ts). security_invoker, so
-- ai_operation_logs' own RLS (admin-only select) applies to whoever reads it.
-- Calls logged before 20261010100001 have no task and read as
-- 'unattributed'.
create or replace view ai_cost_daily with (security_invoker = true) as
select
  (created_at at time zone 'utc')::date as day,
  coalesce(task, 'unattributed') as task,
  provider,
  model,
  operation,
  count(*)::integer as calls,
  (count(*) filter (where not success))::integer as failed_calls,
  -- Succeeded, not the builder's own LLM, and no price configured.
  (count(*) filter (where success and not is_byo_llm and estimated_cost_usd is null))::integer as unpriced_calls,
  (count(*) filter (where is_byo_llm))::integer as byo_llm_calls,
  coalesce(sum(input_tokens), 0)::bigint as input_tokens,
  coalesce(sum(cached_input_tokens), 0)::bigint as cached_input_tokens,
  -- Input tokens on calls whose provider reported a cache figure, so the
  -- cached share isn't diluted by providers that report none.
  coalesce(sum(input_tokens) filter (where cached_input_tokens is not null), 0)::bigint as cache_reported_input_tokens,
  coalesce(sum(output_tokens), 0)::bigint as output_tokens,
  coalesce(sum(estimated_cost_usd), 0)::numeric as cost_usd
from ai_operation_logs
group by 1, 2, 3, 4, 5;

grant select on ai_cost_daily to authenticated;
