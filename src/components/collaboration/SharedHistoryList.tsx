'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { collaborationApi } from '@/lib/collaboration/api'
import type { SharedConversationSummary } from '@/lib/collaboration/types'
import { useCollaboration } from './CollaborationProvider'

// The "Shared" group in Ember's History list: conversations shared with
// one other Project member, the same records in both people's history.
// Refreshed each time the History dropdown opens. Nothing when the
// feature is off.
export function SharedHistoryList() {
  const collab = useCollaboration()
  const supabase = useMemo(() => createClient(), [])
  const [items, setItems] = useState<SharedConversationSummary[]>([])
  const ref = useRef<HTMLDivElement>(null)
  const enabled = !!collab

  useEffect(() => {
    if (!enabled) return
    const load = () =>
      collaborationApi
        .history(supabase)
        .then(setItems)
        .catch(() => setItems([]))
    load()
    const details = ref.current?.closest('details')
    const onToggle = () => {
      if (details?.open) load()
    }
    details?.addEventListener('toggle', onToggle)
    return () => details?.removeEventListener('toggle', onToggle)
  }, [enabled, supabase])

  if (!enabled || items.length === 0) return <div ref={ref} hidden />
  return (
    <div ref={ref} className="mb-1 border-b border-zinc-100 pb-1">
      <p className="px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-zinc-400">Shared</p>
      {items.map((c) => (
        <Link
          key={c.id}
          href={`/projects/${c.projectId}/shared/${c.id}`}
          className="block w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-zinc-100"
        >
          {c.liveSessionId && <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-red-500 align-middle" aria-label="Live now" />}
          {c.myRole === 'viewer' ? `Viewing: ${c.otherName}` : `With ${c.otherName}`} · {c.projectName}
        </Link>
      ))}
    </div>
  )
}
