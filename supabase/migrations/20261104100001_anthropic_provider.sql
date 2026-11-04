-- Claude (Anthropic) as an AI provider, through Anthropic's own SDK
-- (src/lib/ai/anthropic-provider.ts) -- a new provider_type, since the
-- Messages API is not OpenAI-compatible.
--
-- Added switched OFF: an admin sets ANTHROPIC_API_KEY on the deployment,
-- then turns the provider on under Admin > AI providers > Claude (and, for
-- confidential work such as Ember SLI research, raises its sensitivity
-- ceiling there). Claude is generation only; embeddings stay with the
-- existing embedding default.
--
-- Prices are Anthropic's first-party list prices (USD per million tokens)
-- as of November 2026; Haiku's apply to prompts up to 100K tokens.
-- Safe to re-run.

alter table ai_providers drop constraint if exists ai_providers_provider_type_check;
alter table ai_providers add constraint ai_providers_provider_type_check
  check (provider_type in ('openai', 'gemini', 'groq', 'openai_compatible', 'anthropic'));

insert into ai_providers (name, provider_type, display_name, base_url, api_key_env_var, enabled, supports_model_discovery)
values ('anthropic', 'anthropic', 'Claude (Anthropic)', null, 'ANTHROPIC_API_KEY', false, false)
on conflict (name) do nothing;

insert into ai_models (
  provider_id, model_id, display_name, model_type, is_default, context_window, max_output_tokens,
  input_cost_per_million, output_cost_per_million,
  supports_structured_output, supports_tools, supports_reasoning, supports_vision, notes
)
select p.id, m.model_id, m.display_name, 'generation', false, 1000000, 128000, m.input_cost, m.output_cost, true, true, true, true, m.notes
from ai_providers p
cross join (values
  ('claude-opus-5-5', 'Claude Opus 5.5', 4.00, 20.00, 'Most capable everyday Claude model; best for research, fit checks and long tool use.'),
  ('claude-sonnet-5-5', 'Claude Sonnet 5.5', 2.00, 10.00, 'Faster and cheaper; good for everyday chat and drafting.'),
  ('claude-haiku-5-5', 'Claude Haiku 5.5', 0.10, 0.50, 'Fastest and cheapest; for simple, high-volume tasks. Prices apply to prompts up to 100K tokens.')
) as m(model_id, display_name, input_cost, output_cost, notes)
where p.name = 'anthropic'
on conflict (provider_id, model_id) do nothing;
