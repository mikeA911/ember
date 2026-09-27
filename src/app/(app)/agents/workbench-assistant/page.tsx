import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { hasRequiredRole } from '@/lib/auth'
import { getAssistantDescriptor, getAssistantSystemPromptText } from '@/lib/workbench/assistant-descriptor'
import { AssistantFlow } from '@/components/agents/AssistantFlow'
import type { Profile } from '@/types/database'

// A static sibling of the dynamic src/app/(app)/agents/[slug]/page.tsx --
// Next resolves the literal "workbench-assistant" segment in preference to
// that dynamic route, so this never collides with it. Deliberately reads
// nothing from the agents/agent_templates/agent_versions tables: those model
// the separate Graph-Runtime "Agent Framework"; the Workbench Assistant is
// the standalone tool-calling loop in src/lib/chat/loop.ts, described here
// by src/lib/workbench/assistant-descriptor.ts instead.
export default async function WorkbenchAssistantAgentPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canSeePromptText = false
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    canSeePromptText = hasRequiredRole((profile as Pick<Profile, 'role'> | null)?.role ?? 'anonymous', 'curator')
  }

  const descriptor = getAssistantDescriptor()

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/agents" className="text-sm underline">
          &larr; Agents
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-xl font-semibold">{descriptor.name}</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{descriptor.status}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">Active version {descriptor.promptVersion}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-600">{descriptor.purpose}</p>
      </div>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">How this Assistant works</h2>
          <p className="text-sm text-zinc-700">{descriptor.plainLanguageExplanation}</p>
        </div>
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Overview</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-zinc-500">Owner</dt>
            <dd className="text-zinc-700">{descriptor.owner}</dd>
            <dt className="text-zinc-500">Model role</dt>
            <dd className="text-zinc-700">Conversational</dd>
            <dt className="text-zinc-500">Prompt version</dt>
            <dd className="text-zinc-700">{descriptor.promptVersion}</dd>
            <dt className="text-zinc-500">Max tool-loop iterations</dt>
            <dd className="text-zinc-700">{descriptor.maxToolIterations}</dd>
          </dl>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Flow</h2>
        <p className="text-sm text-zinc-500">Select any step to see its purpose, inputs/outputs, and implementation.</p>
        <AssistantFlow nodes={descriptor.nodes} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Guardrails</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {descriptor.guardrails.map((g) => (
            <li key={g.id} className="rounded border border-zinc-200 bg-white p-3">
              <p className="font-medium text-zinc-800">
                {g.label}
                {g.limit !== undefined && <span className="ml-2 text-xs text-zinc-500">limit: {g.limit}</span>}
              </p>
              <p className="mt-0.5 text-zinc-600">{g.description}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Tools</h2>
        <ul className="flex flex-col gap-2 text-sm">
          {descriptor.tools.map((t) => (
            <li key={t.name} className="rounded border border-zinc-200 bg-white p-3">
              <p className="font-medium text-zinc-800">{t.name}</p>
              <p className="mt-0.5 text-zinc-600">{t.description}</p>
              <p className="mt-0.5 text-xs text-zinc-500">Requires: {t.requiredPermission}</p>
              {canSeePromptText && (
                <>
                  <p className="mt-1 text-xs text-zinc-500">
                    Enforcement: {t.enforcement === 'kb_sandbox_enforced' ? 'Enforced by Ember' : 'Declared'} ({t.enforcedBy})
                  </p>
                  <pre className="mt-1 overflow-x-auto rounded bg-zinc-50 p-2 font-mono text-xs text-zinc-600">
                    {JSON.stringify(t.parametersSchema, null, 2)}
                  </pre>
                </>
              )}
            </li>
          ))}
        </ul>
      </section>

      {canSeePromptText && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Active system prompt</h2>
          <p className="text-xs text-zinc-500">Visible to curators and admins only.</p>
          <pre className="whitespace-pre-wrap rounded border border-zinc-200 bg-white p-3 text-xs text-zinc-700">{getAssistantSystemPromptText()}</pre>
        </section>
      )}
    </div>
  )
}
