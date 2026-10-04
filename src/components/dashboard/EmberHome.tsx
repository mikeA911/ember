'use client'

import { useState } from 'react'
import { ChatSession } from '@/components/chat/ChatPanel'
import type { MemberProjectOption } from '@/lib/projects/queries'

// Ember Role-Directed Product Experience (docs/dev-request-ember-role-
// directed-product-experience.md), Stage 1+2 -- the member/consultant
// landing surface at /dashboard (dashboard/page.tsx's isEmberFirst branch),
// also reachable by curator/admin via "Open Ember as a team member"
// (/dashboard?view=ember) so they can experience/validate the same journey
// without changing role.
//
// A thin wrapper only. The project picker, per-project History, onboarding
// greeting/starter prompts, and knowledge-scope banner all already live in
// ChatSession -- the same component the global floating widget
// (ChatPanel.tsx) uses -- so this never re-implements any of that; it just
// places ChatSession full-width/inline instead of as a floating bubble.
// This replaces the old EmberHome, which had its own separate <select>
// picker and its own separate cross-project recent-conversations list --
// exactly the kind of duplicated Ember-access logic this redesign removes.
export function EmberHome({
  projects,
}: {
  projects: MemberProjectOption[]
}) {
  const [selectedProjectId, setSelectedProjectId] = useState<string | undefined>(undefined)

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-xl font-semibold">Ember</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Discover, specify and verify what your customer needs — build it in your own tools.
        </p>
      </div>
      <ChatSession
        key={selectedProjectId ?? 'general'}
        projectId={selectedProjectId}
        projects={projects}
        onSelectProject={setSelectedProjectId}
        className="flex h-[70vh] w-full flex-col rounded border border-zinc-200 bg-white shadow sm:h-[32rem]"
      />
    </div>
  )
}
