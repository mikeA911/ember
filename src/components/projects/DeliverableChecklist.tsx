'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toggleDeliverableAction } from '@/app/actions/workstreams'
import { useCollaboration } from '@/components/collaboration/CollaborationProvider'
import { useSharedDeliverables } from '@/components/collaboration/SharedTextField'
import { CollaborationError } from '@/lib/collaboration/errors'
import type { WorkstreamDeliverable } from '@/types/database'

export function DeliverableChecklist({
  workstreamId,
  deliverables,
  canEdit,
}: {
  workstreamId: string
  deliverables: WorkstreamDeliverable[]
  canEdit: boolean
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  // In a live session showing this workstream (Phase 2): the live list;
  // only the person in control, with the right to, ticks -- each tick saves
  // at once as "set to this value", so a retry can't flip it back.
  const collab = useCollaboration()
  const shared = useSharedDeliverables(workstreamId)
  const [sharedError, setSharedError] = useState<string | null>(null)
  const items = shared ? shared.deliverables : deliverables
  const editable = shared ? shared.canEdit : canEdit

  function handleToggle(index: number) {
    if (shared && collab) {
      if (!shared.canEdit || isPending) return
      const item = shared.deliverables[index]
      setSharedError(null)
      startTransition(async () => {
        try {
          await collab.setDeliverable(workstreamId, index, item.label, !item.completed)
          router.refresh()
        } catch (err) {
          setSharedError(err instanceof CollaborationError ? err.message : 'That didn’t save. Try again.')
        }
      })
      return
    }
    if (!canEdit || isPending) return
    startTransition(async () => {
      await toggleDeliverableAction(workstreamId, index)
      router.refresh()
    })
  }

  if (items.length === 0) {
    return <p className="text-sm text-zinc-500">No deliverables defined.</p>
  }

  return (
    <ul className="flex flex-col gap-1.5" data-shared-field={shared ? 'workstream_deliverables' : undefined}>
      {sharedError && <li className="text-sm text-red-600">{sharedError}</li>}
      {items.map((d, i) => (
        <li key={i} className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={d.completed}
            disabled={!editable || isPending}
            onChange={() => handleToggle(i)}
            className="h-4 w-4"
          />
          <span className={d.completed ? 'text-zinc-500 line-through' : 'text-zinc-700'}>{d.label}</span>
        </li>
      ))}
    </ul>
  )
}
