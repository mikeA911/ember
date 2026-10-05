import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getAgentBySlug, listAgentVersions } from '@/lib/agent/queries'
import { ActivateAgentVersionButton } from '@/components/agents/ActivateAgentVersionButton'

export default async function AgentDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const agent = await getAgentBySlug(supabase, slug)
  if (!agent) notFound()

  const versions = await listAgentVersions(supabase, agent.id)
  const activeVersion = versions.find((v) => v.id === agent.active_version_id)

  const { data: template } = agent.template_id
    ? await supabase.from('agent_templates').select('name, slug').eq('id', agent.template_id).single()
    : { data: null }

  let graphSlug: string | null = null
  if (activeVersion) {
    const { data: graphVersionRow } = await supabase.from('graph_versions').select('graph_id').eq('id', activeVersion.graph_version_id).single()
    if (graphVersionRow) {
      const { data: graphRow } = await supabase.from('graphs').select('slug').eq('id', graphVersionRow.graph_id).single()
      graphSlug = graphRow?.slug ?? null
    }
  }

  let modelNames: { generation: string; embedding: string; evaluator: string | null } | null = null
  if (activeVersion) {
    const providerIds = [activeVersion.generation_provider_id, activeVersion.embedding_provider_id, activeVersion.evaluator_provider_id].filter(
      (id): id is string => id !== null
    )
    const modelIds = [activeVersion.generation_model_id, activeVersion.embedding_model_id, activeVersion.evaluator_model_id].filter(
      (id): id is string => id !== null
    )
    const [{ data: providers }, { data: models }] = await Promise.all([
      supabase.from('ai_providers').select('id, display_name').in('id', providerIds),
      supabase.from('ai_models').select('id, display_name').in('id', modelIds),
    ])
    const providerName = (id: string) => providers?.find((p) => p.id === id)?.display_name ?? id
    const modelName = (id: string) => models?.find((m) => m.id === id)?.display_name ?? id
    modelNames = {
      generation: `${providerName(activeVersion.generation_provider_id)} / ${modelName(activeVersion.generation_model_id)}`,
      embedding: `${providerName(activeVersion.embedding_provider_id)} / ${modelName(activeVersion.embedding_model_id)}`,
      evaluator:
        activeVersion.evaluator_provider_id && activeVersion.evaluator_model_id
          ? `${providerName(activeVersion.evaluator_provider_id)} / ${modelName(activeVersion.evaluator_model_id)}`
          : null,
    }
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canManage = false
  // Ember Readiness, Stage 1: running an evaluation suite is platform-admin
  // work.
  let canRunEvals = false
  if (user) {
    const { data: viewerProfile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    canRunEvals = viewerProfile?.role === 'admin'
    if (viewerProfile?.role === 'admin') {
      canManage = true
    } else if (agent.project_id === null) {
      canManage = viewerProfile?.role === 'curator'
    } else {
      const { data: viewerMembership } = await supabase
        .from('project_members')
        .select('role')
        .eq('project_id', agent.project_id)
        .eq('user_id', user.id)
        .maybeSingle()
      canManage = viewerMembership?.role === 'owner'
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <Link href="/agents" className="text-sm underline">
          &larr; Agents
        </Link>
        <div className="mt-2 flex items-center gap-2">
          <h1 className="text-xl font-semibold">{agent.name}</h1>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{agent.agent_type}</span>
          <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-700">{agent.status}</span>
        </div>
        {agent.description && <p className="mt-1 text-sm text-zinc-600">{agent.description}</p>}
        {template && (
          <p className="mt-1 text-xs text-zinc-500">
            Created from template:{' '}
            <Link href="/agents/templates" className="underline">
              {template.name}
            </Link>
          </p>
        )}
      </div>

      <div className="flex gap-3 text-sm">
        <Link href={`/agents/${agent.slug}/run`} className="rounded bg-zinc-900 px-4 py-2 font-medium text-white">
          Ask a question →
        </Link>
        {canRunEvals && (
          <Link href={`/evals/runs/new?agent=${agent.slug}`} className="rounded border border-zinc-300 px-4 py-2 font-medium">
            Run evaluation suite →
          </Link>
        )}
        {graphSlug && (
          <Link href={`/graphs/${graphSlug}`} className="self-center text-xs underline text-zinc-500">
            View graph
          </Link>
        )}
      </div>

      {activeVersion && (
        <section className="grid gap-6 sm:grid-cols-2">
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Purpose</h2>
            <p className="text-sm text-zinc-700">{activeVersion.purpose}</p>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Instructions</h2>
            <p className="whitespace-pre-wrap text-sm text-zinc-700">{activeVersion.instructions}</p>
          </div>
          <div className="flex flex-col gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Models</h2>
            {modelNames && (
              <ul className="text-sm text-zinc-700">
                <li>Generation: {modelNames.generation}</li>
                <li>Embedding: {modelNames.embedding}</li>
                <li>Evaluator: {modelNames.evaluator ?? '(none)'}</li>
              </ul>
            )}
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Sources</h2>
            <p className="text-sm text-zinc-700">
              {activeVersion.source_policy.evidenceSource}, top-{activeVersion.source_policy.topK}
            </p>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Tools</h2>
            <p className="text-sm text-zinc-500">No tools granted -- this Agent has no arbitrary tool-calling.</p>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Guardrails</h2>
            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-600">{JSON.stringify(activeVersion.guardrails, null, 2)}</pre>
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Termination</h2>
            <pre className="whitespace-pre-wrap font-mono text-xs text-zinc-600">{JSON.stringify(activeVersion.termination_policy, null, 2)}</pre>
          </div>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Versions</h2>
        <div className="rounded border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-zinc-200 text-left text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Version</th>
                <th className="px-4 py-2 font-medium">Created</th>
                <th className="px-4 py-2 font-medium">Activated</th>
                <th className="px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id} className="border-b border-zinc-100 last:border-0">
                  <td className="px-4 py-3">
                    v{v.version_number}
                    {v.id === agent.active_version_id && (
                      <span className="ml-1 rounded-full bg-green-100 px-1.5 py-0.5 text-xs text-green-800">active</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{new Date(v.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-zinc-600">{v.activated_at ? new Date(v.activated_at).toLocaleDateString() : '—'}</td>
                  <td className="px-4 py-3 text-right">
                    {canManage && v.id !== agent.active_version_id && (
                      <ActivateAgentVersionButton agentId={agent.id} versionId={v.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
