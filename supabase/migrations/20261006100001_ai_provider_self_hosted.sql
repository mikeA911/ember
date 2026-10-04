-- Sandz-hosted AI for Live client Projects (Builder mode).
--
-- Marks a provider as running on Sandz infrastructure (for example the vLLM
-- server on the Zadara GPU VM, docs/guides/ember-self-hosted-llm-integration.md).
-- In Builder mode, a contracted client Project -- one with a
-- client_project_fees row, created when an accepted proposal is promoted --
-- may use only these providers for content calls once it is Live
-- (src/lib/ai/hosting-policy.ts). Presales work, pre-live client Projects
-- and internal/foundation Projects are unrestricted.
--
-- Default false: a provider is external until an admin says otherwise. Set
-- from Admin -> AI Config; existing ai_providers RLS (admin-only writes,
-- read by any active non-anonymous session) already covers the column.
alter table ai_providers add column if not exists is_self_hosted boolean not null default false;

comment on column ai_providers.is_self_hosted is
  'Runs on Sandz infrastructure. Live client Projects in Builder mode may use only these providers for content AI calls.';
