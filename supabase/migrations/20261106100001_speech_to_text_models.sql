-- Speech to text (dictation in Ember's chat): OpenAI's transcription models
-- as 'speech' models. The registry already allowed model_type 'speech' and
-- one default per type; this adds the models and, when no speech default
-- exists yet, makes GPT-4o Transcribe the default (good with English,
-- Filipino and mixed Taglish). Admins change it under Admin > AI Config >
-- Model assignments.
--
-- Prices are per minute of audio (USD), not per token, so they go in the
-- notes rather than the per-million-token columns.
-- Safe to re-run.

insert into ai_models (provider_id, model_id, display_name, model_type, is_default, notes)
select p.id, m.model_id, m.display_name, 'speech', false, m.notes
from ai_providers p
cross join (values
  ('gpt-4o-transcribe', 'GPT-4o Transcribe', 'Most accurate; about USD 0.006 per minute.'),
  ('gpt-4o-mini-transcribe', 'GPT-4o mini Transcribe', 'Cheaper; about USD 0.003 per minute.'),
  ('whisper-1', 'Whisper', 'Older model; about USD 0.006 per minute.')
) as m(model_id, display_name, notes)
where p.name = 'openai'
on conflict (provider_id, model_id) do nothing;

update ai_models set is_default = true
where model_type = 'speech' and model_id = 'gpt-4o-transcribe'
  and provider_id = (select id from ai_providers where name = 'openai')
  and not exists (select 1 from ai_models where model_type = 'speech' and is_default);
