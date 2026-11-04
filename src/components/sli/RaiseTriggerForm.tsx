'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { raiseTriggerAction } from '@/app/actions/sli'
import type { SliDepartment, TriggerType } from '@/lib/sli/types'

const field = 'w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm'

export function RaiseTriggerForm({ types, departments }: { types: TriggerType[]; departments: SliDepartment[] }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    const text = (name: string) => String(form.get(name) ?? '')
    setError(null)
    startTransition(async () => {
      const result = await raiseTriggerAction({
        title: text('title'),
        triggerType: text('triggerType'),
        summary: text('summary'),
        eventDate: text('eventDate'),
        eventReference: text('eventReference'),
        strategicObjective: text('strategicObjective'),
        sourceDepartmentId: text('sourceDepartmentId'),
      })
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.push(`/sli/discovery/${result.code}`)
    })
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
      <div>
        <label htmlFor="title" className="mb-1 block text-sm font-medium">Title</label>
        <input id="title" name="title" required minLength={3} maxLength={200} className={field} placeholder="For example: VMware licensing changes" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="triggerType" className="mb-1 block text-sm font-medium">Type</label>
          <select id="triggerType" name="triggerType" required defaultValue="" className={field}>
            <option value="" disabled>Choose…</option>
            {types.map((t) => (
              <option key={t.code} value={t.code}>{t.label}</option>
            ))}
          </select>
        </div>
        {departments.length > 1 && (
          <div>
            <label htmlFor="sourceDepartmentId" className="mb-1 block text-sm font-medium">Raised from</label>
            <select id="sourceDepartmentId" name="sourceDepartmentId" defaultValue={departments[0]?.id} className={field}>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>
      <div>
        <label htmlFor="summary" className="mb-1 block text-sm font-medium">What happened, and why might it matter to us?</label>
        <textarea id="summary" name="summary" rows={6} maxLength={8000} className={field} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="eventDate" className="mb-1 block text-sm font-medium">Date of the event <span className="font-normal text-zinc-500">(optional)</span></label>
          <input id="eventDate" name="eventDate" type="date" className={field} />
        </div>
        <div>
          <label htmlFor="eventReference" className="mb-1 block text-sm font-medium">Link or source <span className="font-normal text-zinc-500">(optional)</span></label>
          <input id="eventReference" name="eventReference" maxLength={1000} className={field} placeholder="https://…" />
        </div>
      </div>
      <div>
        <label htmlFor="strategicObjective" className="mb-1 block text-sm font-medium">Which objective could it serve? <span className="font-normal text-zinc-500">(optional)</span></label>
        <input id="strategicObjective" name="strategicObjective" maxLength={2000} className={field} />
      </div>
      <p className="text-xs text-zinc-500">
        The Discovery team sees everything you write here. Other colleagues see only the title, type and stage. Use synthetic data only on this instance.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
        {pending ? 'Raising…' : 'Raise Trigger'}
      </button>
    </form>
  )
}
