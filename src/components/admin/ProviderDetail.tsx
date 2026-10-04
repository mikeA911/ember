'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { AIModelRow, AIModelStatus, AIProviderRow, InformationSensitivity } from '@/types/database'
import {
  discoverModelsAction,
  setDefaultModelAction,
  setDefaultStructuredOutputModelAction,
  updateModelEnabledAction,
  updateModelStatusAction,
  updateProviderEnabledAction,
  setProviderMaxSensitivityAction,
  setProviderSelfHostedAction,
} from '@/app/actions/ai-providers'
import { AddModelForm } from './AddModelForm'
import { ModelPricingEditor } from './ModelPricingEditor'
import type { RoleOption } from './ModelAssignmentsSummary'

const STATUS_OPTIONS: AIModelStatus[] = ['active', 'deprecated', 'disabled', 'unavailable']
const SENSITIVITY_OPTIONS: InformationSensitivity[] = ['public', 'internal', 'confidential', 'restricted']
const SENSITIVITY_LABELS: Record<InformationSensitivity, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
  restricted: 'Restricted',
}

function roleOptionLabel(o: RoleOption): string {
  return `${o.providerDisplayName} · ${o.modelDisplayName}`
}

export function ProviderDetail({
  provider,
  models,
  configured,
  currentConversational,
  currentStructuredOutput,
  maxSensitivity,
}: {
  provider: AIProviderRow
  models: AIModelRow[]
  configured: boolean
  currentConversational: RoleOption | null
  currentStructuredOutput: RoleOption | null
  // Information Sensitivity Classification (Shadow AI blog, 2026-08-28) --
  // null = no ai_provider_sensitivity_eligibility row yet, which the
  // enforcement side (src/lib/ai/sensitivity.ts) treats as 'internal'-only.
  maxSensitivity: InformationSensitivity | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [discovered, setDiscovered] = useState<{ id: string }[] | null>(null)
  const [discoverError, setDiscoverError] = useState<string | null>(null)
  const [discovering, setDiscovering] = useState(false)

  function run(action: () => Promise<void>) {
    startTransition(async () => {
      await action()
      router.refresh()
    })
  }

  // Same confirmation wording/behavior as ModelAssignmentsSummary, so
  // changing a role assignment from a provider's own page carries the same
  // "this is application-wide, here's what's being replaced" guardrail as
  // changing it from the cross-provider summary.
  function confirmAndRun(message: string, action: () => Promise<void>) {
    if (!window.confirm(message)) return
    run(action)
  }

  async function handleRefreshModels() {
    setDiscovering(true)
    setDiscoverError(null)
    try {
      const result = await discoverModelsAction(provider.id)
      setDiscovered(result)
    } catch (err) {
      setDiscoverError(err instanceof Error ? err.message : 'Discovery failed')
    } finally {
      setDiscovering(false)
    }
  }

  const knownModelIds = new Set(models.map((m) => m.model_id))

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-xl font-semibold">Provider: {provider.display_name}</h1>
        <div className="mt-3 flex flex-col gap-2 rounded border border-zinc-200 bg-white p-4 text-sm">
          <div className="flex justify-between">
            <span className="text-zinc-500">Status</span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={provider.enabled}
                disabled={isPending}
                onChange={(e) => run(() => updateProviderEnabledAction(provider.id, e.target.checked))}
              />
              {provider.enabled ? 'Enabled' : 'Disabled'}
            </label>
          </div>
          {provider.base_url && (
            <div className="flex justify-between">
              <span className="text-zinc-500">Base URL</span>
              <span className="font-mono text-xs">{provider.base_url}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-zinc-500">Credentials</span>
            <span>{configured ? 'Configured ✓' : `Missing (set ${provider.api_key_env_var})`}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500" title="A Live client Project may use only Sandz-hosted providers for chat, summaries, Wiki drafts and presentations.">
              Sandz-hosted
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={provider.is_self_hosted}
                disabled={isPending}
                onChange={(e) => run(() => setProviderSelfHostedAction(provider.id, e.target.checked))}
              />
              {provider.is_self_hosted ? 'Yes: allowed for Live client Projects' : 'No (external)'}
            </label>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-zinc-500">Max AI sensitivity approved to receive</span>
            <select
              value={maxSensitivity ?? ''}
              disabled={isPending}
              onChange={(e) => run(() => setProviderMaxSensitivityAction(provider.id, e.target.value as InformationSensitivity))}
              className="rounded border border-zinc-300 px-2 py-1 text-sm"
            >
              <option value="" disabled>
                Unset (treated as Internal-only)
              </option>
              {SENSITIVITY_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {SENSITIVITY_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {provider.supports_model_discovery && (
        <div className="flex flex-col gap-2">
          <button
            onClick={handleRefreshModels}
            disabled={discovering}
            className="self-start rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
          >
            {discovering ? 'Refreshing…' : 'Refresh Models'}
          </button>
          {discoverError && <p className="text-sm text-red-600">{discoverError}</p>}
          {discovered && (
            <div className="rounded border border-zinc-200 bg-white p-4">
              <p className="mb-2 text-sm text-zinc-600">
                Discovered {discovered.length} model{discovered.length === 1 ? '' : 's'}. Adding a model does not enable it automatically
                for anything -- use Add Model below to register any you want available.
              </p>
              <ul className="flex flex-wrap gap-2 text-xs">
                {discovered.map((m) => (
                  <li key={m.id} className={`rounded px-2 py-1 ${knownModelIds.has(m.id) ? 'bg-zinc-100 text-zinc-400' : 'bg-zinc-100'}`}>
                    {m.id} {knownModelIds.has(m.id) && '(already registered)'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Models</h2>
        <div className="flex flex-col gap-2">
          {models.map((m) => (
            <div key={m.id} className="rounded border border-zinc-200 bg-white p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 font-medium">
                    {m.display_name}
                    {m.model_type === 'generation' && m.is_default && (
                      <span
                        title="Used by the Assistant unless the user chooses another model for the next message."
                        className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800"
                      >
                        Conversational default
                      </span>
                    )}
                    {/* is_default is scoped per model_type (a partial unique
                        index enforces one default per type -- see
                        src/lib/ai/rls.test.ts), so an embedding model can be
                        "the" embedding default independently of, and at the
                        same time as, a generation model being the
                        conversational default. Label it distinctly rather
                        than reusing "Conversational default" for a model
                        that was never eligible for that role. */}
                    {m.model_type === 'embedding' && m.is_default && (
                      <span
                        title="Used for embedding text into vectors -- unrelated to the conversational or structured-output defaults."
                        className="rounded-full bg-teal-100 px-2 py-0.5 text-xs text-teal-800"
                      >
                        Embedding default
                      </span>
                    )}
                    {m.is_default_structured_output && (
                      <span
                        title="Used when a feature requires validated, schema-constrained AI output."
                        className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs text-indigo-800"
                      >
                        Structured-output default
                      </span>
                    )}
                    {m.status === 'deprecated' && (
                      <span className="rounded-full bg-orange-100 px-2 py-0.5 text-xs text-orange-800">
                        deprecated{m.deprecation_date ? ` (${m.deprecation_date})` : ''}
                      </span>
                    )}
                    {(m.status === 'disabled' || m.status === 'unavailable') && (
                      <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">{m.status}</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500">
                    {m.model_id} · {m.model_type}
                    {m.context_window ? ` · ${m.context_window.toLocaleString()} ctx` : ''}
                    {m.embedding_dimensions ? ` · ${m.embedding_dimensions} dims` : ''}
                  </p>
                  {/* Capabilities, kept visually distinct from availability/status badges above and
                      assignment actions to the right -- only flags actually recorded on this row are
                      shown, never inferred from provider discovery. */}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.supports_tools && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">Tools</span>}
                    {m.supports_structured_output && (
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">Structured output</span>
                    )}
                    {m.supports_embeddings && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">Embeddings</span>}
                    {m.supports_reasoning && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">Reasoning</span>}
                    {m.supports_vision && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">Vision</span>}
                  </div>
                  <ModelPricingEditor
                    modelId={m.id}
                    providerId={provider.id}
                    input={m.input_cost_per_million}
                    cachedInput={m.cached_input_cost_per_million}
                    output={m.output_cost_per_million}
                  />
                </div>
                <div className="flex shrink-0 items-center gap-2 text-xs">
                  <label className="flex items-center gap-1.5">
                    <input
                      type="checkbox"
                      checked={m.enabled}
                      disabled={isPending}
                      onChange={(e) => run(() => updateModelEnabledAction(m.id, provider.id, e.target.checked))}
                    />
                    Enabled
                  </label>
                  {/* Only offered when the model actually supports tool calling -- the Assistant
                      requires it (assertModelCapability(model, 'tools')), so offering this for
                      every model regardless would let an admin silently break it at runtime. */}
                  {m.model_type === 'generation' && !m.is_default && m.supports_tools && (
                    <button
                      disabled={isPending}
                      onClick={() =>
                        confirmAndRun(
                          `Change the Conversational AI default from ${currentConversational ? roleOptionLabel(currentConversational) : 'no model currently assigned'} to ${provider.display_name} / ${m.display_name}? This changes the application-wide default used by the Workbench Assistant when no per-message model is selected.`,
                          () => setDefaultModelAction(m.id, provider.id, m.model_type)
                        )
                      }
                      className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
                    >
                      Use for conversational AI
                    </button>
                  )}
                  {m.supports_structured_output && !m.is_default_structured_output && (
                    <button
                      disabled={isPending}
                      onClick={() =>
                        confirmAndRun(
                          `Change the Structured-output default from ${currentStructuredOutput ? roleOptionLabel(currentStructuredOutput) : 'no model currently assigned'} to ${provider.display_name} / ${m.display_name}? This changes the application-wide default used when a feature requires validated, schema-constrained AI output, and ${m.display_name} is confirmed to support structured output.`,
                          () => setDefaultStructuredOutputModelAction(m.id, provider.id)
                        )
                      }
                      className="rounded border border-zinc-300 px-2 py-1 disabled:opacity-50"
                    >
                      Use for structured output
                    </button>
                  )}
                  <select
                    value={m.status}
                    disabled={isPending}
                    onChange={(e) =>
                      run(() =>
                        updateModelStatusAction(m.id, provider.id, e.target.value as AIModelStatus, m.deprecation_date)
                      )
                    }
                    className="rounded border border-zinc-300 px-1.5 py-1"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>
          ))}
          {models.length === 0 && <p className="text-sm text-zinc-500">No models registered for this provider yet.</p>}
        </div>
      </section>

      <AddModelForm providerId={provider.id} />
    </div>
  )
}
