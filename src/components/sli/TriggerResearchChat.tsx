'use client'

import { ChatSession } from '@/components/chat/ChatPanel'

// A Trigger's research conversation: Ember's own chat, bound to the
// Trigger's private research Project. Its starter prompt is the fit check
// (supabase/migrations/20261103100001_sli_research_fit_check_prompt.sql);
// files attached here can be saved to the Research workstream.
export function TriggerResearchChat({ projectId, projectName }: { projectId: string; projectName: string }) {
  return (
    <ChatSession
      projectId={projectId}
      projects={[{ id: projectId, name: projectName }]}
      // The conversation stays on this Trigger: switching projects happens
      // by opening another Trigger.
      onSelectProject={() => {}}
      currentPageProjectId={projectId}
      className="flex h-[70vh] w-full flex-col rounded border border-zinc-200 bg-white shadow-sm sm:h-[34rem]"
    />
  )
}
