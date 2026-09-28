'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { setDefaultModelAction, setDefaultStructuredOutputModelAction } from '@/app/actions/ai-providers'

export interface RoleOption {
  providerDbId: string
  modelDbId: string
  providerDisplayName: string
  modelDisplayName: string
}

export interface ModelAssignmentsSummaryProps {
  conversational: { current: RoleOption | null; options: RoleOption[] }
  structuredOutput: { current: RoleOption | null; options: RoleOption[] }
  embedding: { current: RoleOption | null; options: RoleOption[] }
}

type Role = 'conversational' | 'structuredOutput' | 'embedding'

const ROLE_LABEL: Record<Role, string> = {
  conversational: 'Conversational AI',
  structuredOutput: 'Structured-output',
  embedding: 'Embedding',
}

function optionKey(o: RoleOption): string {
  return `${o.providerDbId}::${o.modelDbId}`
}

function optionLabel(o: RoleOption): string {
  return `${o.providerDisplayName} · ${o.modelDisplayName}`
}

// docs/dev-request-ai-model-role-clarity.md, section 1 -- a global summary
// so an admin can see (and change) both application-wide model roles
// without opening every provider page or navigating into model management.
// The embedding role (added 2026-09-28) was previously only settable from
// the owning provider's own page.
// Rendered above AIProvidersList on /admin (AI Config tab) and above
// ProviderDetail on each provider's own page.
export function ModelAssignmentsSummary({ conversational, structuredOutput, embedding }: ModelAssignmentsSummaryProps) {
  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Model assignments</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <RoleCard
          role="conversational"
          label="Conversational AI default"
          description="Used by the Assistant unless the user chooses another model for the next message."
          current={conversational.current}
          options={conversational.options}
          whereUsed={[
            'Workbench Assistant chat -- whenever a message is sent without an explicit per-message model selection.',
          ]}
        />
        <RoleCard
          role="structuredOutput"
          label="Structured-output default"
          description="Used when a feature requires validated, schema-constrained AI output."
          current={structuredOutput.current}
          options={structuredOutput.options}
          whereUsed={[
            'Document upload & chunk enrichment (initial and re-run).',
            'AI-assisted Wiki draft creation, from approved document chunks or from a workstream artifact.',
          ]}
        />
        <RoleCard
          role="embedding"
          label="Embedding default"
          description="Turns approved chunks and search questions into vectors for knowledge retrieval."
          current={embedding.current}
          options={embedding.options}
          whereUsed={[
            'Chunk approval, including auto-approval when a project source submission is approved.',
            'Knowledge search -- the Assistant, project knowledge and evaluations embed each query with this model.',
          ]}
        />
      </div>
      <p className="text-xs text-zinc-500">
        These are application-wide assignments. Changing one here replaces the current assignment, which may belong to
        another provider. Enabling a model only makes it available; it does not assign any role.
      </p>
    </section>
  )
}

function RoleCard({
  role,
  label,
  description,
  current,
  options,
  whereUsed,
}: {
  role: Role
  label: string
  description: string
  current: RoleOption | null
  options: RoleOption[]
  whereUsed: string[]
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedKey, setSelectedKey] = useState(current ? optionKey(current) : '')
  const [error, setError] = useState<string | null>(null)

  const selected = options.find((o) => optionKey(o) === selectedKey)
  const changed = selected && (!current || optionKey(selected) !== optionKey(current))

  function handleChange() {
    if (!selected) return
    setError(null)

    const roleLabel = ROLE_LABEL[role]
    const currentLabel = current ? optionLabel(current) : 'no model currently assigned'
    const scopeExplanation =
      role === 'conversational'
        ? 'This changes the application-wide default used by the Workbench Assistant when no per-message model is selected.'
        : role === 'structuredOutput'
          ? `This changes the application-wide default used when a feature requires validated, schema-constrained AI output, and ${optionLabel(selected)} is confirmed to support structured output.`
          : 'This changes the model that embeds newly approved chunks and every search query. Chunks already approved keep their old vectors, which are not comparable with the new model -- re-approve them (or re-run their embedding) so search keeps finding them.'
    const confirmed = window.confirm(`Change the ${roleLabel} default from ${currentLabel} to ${optionLabel(selected)}? ${scopeExplanation}`)
    if (!confirmed) return

    startTransition(async () => {
      try {
        if (role === 'conversational') {
          await setDefaultModelAction(selected.modelDbId, selected.providerDbId, 'generation')
        } else if (role === 'embedding') {
          await setDefaultModelAction(selected.modelDbId, selected.providerDbId, 'embedding')
        } else {
          await setDefaultStructuredOutputModelAction(selected.modelDbId, selected.providerDbId)
        }
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to change the assignment')
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3">
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-zinc-500">{description}</p>
      </div>
      <p className="text-sm">
        Current: <span className="font-medium">{current ? optionLabel(current) : 'None assigned'}</span>
      </p>
      <div className="flex items-center gap-2">
        <select
          value={selectedKey}
          disabled={isPending || options.length === 0}
          onChange={(e) => setSelectedKey(e.target.value)}
          className="min-w-0 flex-1 rounded border border-zinc-300 px-2 py-1.5 text-sm"
        >
          {options.length === 0 && <option value="">No eligible models</option>}
          {options.map((o) => (
            <option key={optionKey(o)} value={optionKey(o)}>
              {optionLabel(o)}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={!changed || isPending}
          onClick={handleChange}
          className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
        >
          {isPending ? 'Changing…' : 'Change'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <details className="text-xs text-zinc-500">
        <summary className="cursor-pointer select-none">Where is this used?</summary>
        <ul className="mt-1 list-disc pl-4">
          {whereUsed.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </details>
    </div>
  )
}
