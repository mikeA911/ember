'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateModelPricingAction } from '@/app/actions/ai-providers'

function formatPrice(value: number | null) {
  return value === null ? '—' : `$${value}`
}

function parsePrice(value: string): number | null | 'invalid' {
  const trimmed = value.trim()
  if (!trimmed) return null
  const n = Number(trimmed)
  return Number.isFinite(n) && n >= 0 ? n : 'invalid'
}

// USD per million tokens. Without input and output prices the model's calls
// are reported as unpriced; without a cached price, cached input is charged
// at the input price. Applies to calls from now on.
export function ModelPricingEditor({
  modelId,
  providerId,
  input,
  cachedInput,
  output,
}: {
  modelId: string
  providerId: string
  input: number | null
  cachedInput: number | null
  output: number | null
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [values, setValues] = useState({
    input: input === null ? '' : String(input),
    cachedInput: cachedInput === null ? '' : String(cachedInput),
    output: output === null ? '' : String(output),
  })

  function save() {
    setError(null)
    const parsed = { input: parsePrice(values.input), cachedInput: parsePrice(values.cachedInput), output: parsePrice(values.output) }
    if (Object.values(parsed).includes('invalid')) {
      setError('Prices must be numbers of zero or more')
      return
    }
    startTransition(async () => {
      try {
        await updateModelPricingAction(modelId, providerId, {
          inputCostPerMillion: parsed.input as number | null,
          cachedInputCostPerMillion: parsed.cachedInput as number | null,
          outputCostPerMillion: parsed.output as number | null,
        })
        setEditing(false)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save prices')
      }
    })
  }

  if (!editing) {
    return (
      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
        {input === null || output === null ? (
          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800">No price set -- calls are reported as unpriced</span>
        ) : (
          <span>
            Per 1M tokens: input {formatPrice(input)} · cached input {cachedInput === null ? `${formatPrice(input)} (input price)` : formatPrice(cachedInput)} ·
            output {formatPrice(output)}
          </span>
        )}
        <button type="button" onClick={() => setEditing(true)} className="underline">
          Edit prices
        </button>
      </div>
    )
  }

  const field = (key: keyof typeof values, label: string, placeholder?: string) => (
    <label className="flex items-center gap-1">
      {label} $
      <input
        aria-label={`${label} per million tokens`}
        inputMode="decimal"
        value={values[key]}
        placeholder={placeholder}
        onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
        className="w-20 rounded border border-zinc-300 px-1.5 py-0.5 text-right"
      />
    </label>
  )

  return (
    <div className="mt-1 flex flex-col gap-1 text-xs text-zinc-600">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-zinc-500">Per 1M tokens:</span>
        {field('input', 'Input')}
        {field('cachedInput', 'Cached input', 'input price')}
        {field('output', 'Output')}
      </div>
      <div className="flex gap-2">
        <button type="button" disabled={isPending} onClick={save} className="rounded bg-zinc-900 px-2 py-0.5 font-medium text-white disabled:opacity-50">
          Save
        </button>
        <button type="button" disabled={isPending} onClick={() => setEditing(false)} className="underline">
          Cancel
        </button>
        <span className="text-zinc-400">Applies to calls from now on.</span>
      </div>
      {error && <span className="text-red-700">{error}</span>}
    </div>
  )
}
