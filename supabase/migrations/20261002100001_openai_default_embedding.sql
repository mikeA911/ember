-- Default embedding model: OpenAI text-embedding-3-small (1536 dimensions,
-- same as every vector(1536) column). Replaces the seed's gemini-embedding-001
-- default (20260810110002_seed_ai_providers.sql), and the RAG Answer agent
-- template's pinned embedding default (20260811100003_agent_framework.sql), so
-- knowledge vectors and the queries searched against them come from the same
-- model. The embedding default stays admin-changeable from the "Model
-- assignments" summary on the AI Config tab.
--
-- Vectors from different embedding models are not comparable, so this only
-- switches while no kb_vectors/wiki_vectors row was embedded by another model
-- -- an environment already running on a different embedding model keeps it
-- until an admin changes it deliberately (and re-embeds).
do $$
declare
  v_provider uuid;
  v_model uuid;
begin
  select m.provider_id, m.id into v_provider, v_model
  from ai_models m
  join ai_providers p on p.id = m.provider_id
  where p.name = 'openai' and m.model_id = 'text-embedding-3-small' and m.model_type = 'embedding';

  if v_model is null then
    return;
  end if;
  -- Re-run safe: only replace the original seed default (or no default),
  -- never an embedding model an admin has chosen since.
  if exists (
    select 1 from ai_models m
    where m.model_type = 'embedding' and m.is_default and m.id <> v_model and m.model_id <> 'gemini-embedding-001'
  ) then
    return;
  end if;
  if exists (select 1 from kb_vectors where embedding_model is distinct from 'text-embedding-3-small')
     or exists (select 1 from wiki_vectors where embedding_model is distinct from 'text-embedding-3-small') then
    return;
  end if;

  update ai_models set is_default = false where model_type = 'embedding' and is_default and id <> v_model;
  update ai_models set is_default = true, enabled = true where id = v_model;

  update agent_templates
  set default_embedding_provider_id = v_provider, default_embedding_model_id = v_model
  where default_embedding_model_id is not null and default_embedding_model_id <> v_model;
end $$;
