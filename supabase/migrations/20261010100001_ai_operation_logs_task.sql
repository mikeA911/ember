-- Cost per task (2026-10-04, Mike). Every AI call records what it was for
-- (src/lib/ai/tasks.ts) and how much of its input the provider served from
-- its prompt cache. Groundwork for an admin cost report by task and for
-- choosing a model per task.
--
-- task is text, not a check constraint: the list lives in code and grows
-- with new features. Rows logged before this migration stay null and read
-- as "unattributed".
--
-- cached_input_tokens is the part of input_tokens served from the
-- provider's prompt cache (OpenAI/Groq/xAI prompt_tokens_details.
-- cached_tokens, DeepSeek prompt_cache_hit_tokens, Gemini
-- cachedContentTokenCount); null when the provider doesn't report it.
alter table ai_operation_logs add column if not exists task text;
alter table ai_operation_logs add column if not exists cached_input_tokens integer
  check (cached_input_tokens is null or cached_input_tokens >= 0);

create index if not exists ai_operation_logs_task_created_at_idx on ai_operation_logs(task, created_at desc);
