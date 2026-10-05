import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { RunConfigForm } from '@/components/eval/RunConfigForm'
import { listProviders, listModels } from '@/lib/ai'
import { listActiveGraphs } from '@/lib/graph/queries'
import { getAgentBySlug, getAgentVersion } from '@/lib/agent/queries'

// executeEvalRun runs every case in a dataset sequentially (retrieve ->
// generate -> optional LLM judge = up to 3 AI calls per case), inside the
// same request that creates the run -- fine for the 10-15 case datasets
// this milestone targets, but easily exceeds Vercel's default serverless
// timeout. Raise the ceiling here rather than building a job queue (that's
// a later-milestone change); a much larger dataset would need one.
export const maxDuration = 60

export default async function NewEvalRunPage({
  searchParams,
}: {
  searchParams: Promise<{ dataset?: string; agent?: string }>
}) {
  const { dataset: preselectedDatasetId, agent: agentSlug } = await searchParams
  const supabase = await createClient()

  // Ember Readiness, Stage 1: running an evaluation is platform-admin work
  // (createAndRunEvalAction and RLS enforce the same rule).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  if (viewerProfile?.role !== 'admin') redirect('/dashboard')

  const [{ data: datasets }, providers, models, graphs] = await Promise.all([
    supabase.from('eval_datasets').select('id, name, status, version').order('created_at', { ascending: false }),
    listProviders(supabase, { enabledOnly: true }),
    listModels(supabase, { enabledOnly: true }),
    listActiveGraphs(supabase),
  ])

  // "Run evaluation suite" from an Agent's detail page -- reuses this exact
  // form/action rather than a separate eval-running code path. Milestone
  // 5B: agentId/agentVersionId just ride along on the existing graph-mode
  // config so graph_runs records which Agent produced the run.
  let preselectedAgent: { id: string; versionId: string; graphId: string; name: string } | null = null
  if (agentSlug) {
    const agent = await getAgentBySlug(supabase, agentSlug)
    if (agent?.active_version_id) {
      const version = await getAgentVersion(supabase, agent.active_version_id)
      const graph = graphs.find((g) => g.active_version_id !== null && version?.graph_version_id && g.active_version_id === version.graph_version_id)
      if (version && graph) {
        preselectedAgent = { id: agent.id, versionId: version.id, graphId: graph.id, name: agent.name }
      }
    }
  }

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <h1 className="text-xl font-semibold">Run evaluation</h1>
      <RunConfigForm
        datasets={datasets ?? []}
        preselectedDatasetId={preselectedDatasetId}
        providers={providers}
        models={models}
        graphs={graphs}
        preselectedAgent={preselectedAgent}
      />
    </div>
  )
}
