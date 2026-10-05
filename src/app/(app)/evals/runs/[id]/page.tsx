import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { summarizeResults } from '@/lib/eval/scoring'
import { BaselineButton } from '@/components/eval/BaselineButton'

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-zinc-200 text-zinc-500',
}

function fmtPct(v: number | null) {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`
}
function fmtScore(v: number | null) {
  return v === null ? '—' : v.toFixed(2)
}

export default async function EvalRunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  // Ember Readiness, Stage 1: eval runs are platform-admin work.
  if (viewerProfile?.role !== 'admin') redirect('/dashboard')

  const { data: run } = await supabase.from('eval_runs').select('*').eq('id', id).single()
  if (!run) notFound()

  const { data: dataset } = await supabase.from('eval_datasets').select('name, project_id').eq('id', run.dataset_id).single()

  const [{ data: results }, { data: cases }, { data: baselineRun }] = await Promise.all([
    supabase.from('eval_results').select('*').eq('eval_run_id', id),
    supabase.from('eval_cases').select('id, question').eq('dataset_id', run.dataset_id),
    supabase
      .from('eval_runs')
      .select('id, name')
      .eq('dataset_id', run.dataset_id)
      .eq('is_baseline', true)
      .neq('id', id)
      .maybeSingle(),
  ])

  const questionById = new Map((cases ?? []).map((c) => [c.id, c.question]))
  const summary = summarizeResults(results ?? [])

  let baselineSummary = null
  if (baselineRun) {
    const { data: baselineResults } = await supabase.from('eval_results').select('*').eq('eval_run_id', baselineRun.id)
    baselineSummary = summarizeResults(baselineResults ?? [])
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{run.name || `Run ${run.id.slice(0, 8)}`}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            <Link href={`/evals/datasets/${run.dataset_id}`} className="underline">
              {dataset?.name}
            </Link>{' '}
            · dataset v{run.dataset_version} ·{' '}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[run.status]}`}>{run.status}</span>
            {run.is_baseline && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">baseline</span>}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {run.config.generation.provider} · {run.config.retrieval.evidence_source} · top-{run.config.retrieval.top_k} · evaluator:{' '}
            {run.config.evaluator.type} · mode: {run.config.execution?.mode ?? 'single_pass'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {dataset?.project_id && (
            <Link
              href={`/projects/${dataset.project_id}/notes?contextType=eval_run&contextId=${run.id}`}
              className="text-sm underline"
            >
              + Note about this run
            </Link>
          )}
          {run.status === 'completed' && !run.is_baseline && <BaselineButton runId={run.id} datasetId={run.dataset_id} />}
        </div>
      </div>

      {run.error_message && <p className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{run.error_message}</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Metric label="Cases" value={String(summary.caseCount)} />
        <Metric label="Hit@K" value={fmtPct(summary.hitAtK)} baseline={baselineSummary ? fmtPct(baselineSummary.hitAtK) : undefined} />
        <Metric label="Recall@K" value={fmtPct(summary.recallAtK)} baseline={baselineSummary ? fmtPct(baselineSummary.recallAtK) : undefined} />
        <Metric label="MRR" value={fmtScore(summary.meanReciprocalRank)} baseline={baselineSummary ? fmtScore(baselineSummary.meanReciprocalRank) : undefined} />
        <Metric label="Generation" value={fmtScore(summary.avgGenerationScore)} baseline={baselineSummary ? fmtScore(baselineSummary.avgGenerationScore) : undefined} />
        <Metric label="Grounding" value={fmtScore(summary.avgGroundingScore)} baseline={baselineSummary ? fmtScore(baselineSummary.avgGroundingScore) : undefined} />
        <Metric label="Outcome" value={fmtScore(summary.avgOutcomeScore)} baseline={baselineSummary ? fmtScore(baselineSummary.avgOutcomeScore) : undefined} />
        <Metric
          label="Avg latency"
          value={summary.avgLatencyMs === null ? '—' : `${(summary.avgLatencyMs / 1000).toFixed(1)}s`}
          baseline={baselineSummary?.avgLatencyMs != null ? `${(baselineSummary.avgLatencyMs / 1000).toFixed(1)}s` : undefined}
        />
        {summary.avgIterations !== null && (
          <Metric
            label="Avg iterations"
            value={summary.avgIterations.toFixed(1)}
            baseline={baselineSummary?.avgIterations != null ? baselineSummary.avgIterations.toFixed(1) : undefined}
          />
        )}
      </div>
      {baselineRun && (
        <p className="text-xs text-zinc-500">
          Compared against baseline{' '}
          <Link href={`/evals/runs/${baselineRun.id}`} className="underline">
            {baselineRun.name || baselineRun.id.slice(0, 8)}
          </Link>
        </p>
      )}

      <div className="rounded border border-zinc-200 bg-white">
        <table className="w-full text-sm">
          <thead className="border-b border-zinc-200 text-left text-zinc-500">
            <tr>
              <th className="px-4 py-2 font-medium">Question</th>
              <th className="px-4 py-2 font-medium">Retrieval</th>
              <th className="px-4 py-2 font-medium">Outcome</th>
              <th className="px-4 py-2 font-medium">Failure</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {(results ?? []).map((r) => (
              <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                <td className="max-w-sm px-4 py-3">{questionById.get(r.eval_case_id) ?? r.eval_case_id}</td>
                <td className="px-4 py-3">
                  {r.status === 'failed' ? (
                    <span className="text-red-600">error</span>
                  ) : r.retrieval_hit === null ? (
                    '—'
                  ) : r.retrieval_hit ? (
                    <span className="text-green-700">hit</span>
                  ) : (
                    <span className="text-red-600">miss</span>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-600">{fmtScore(r.human_outcome_score ?? r.outcome_score)}</td>
                <td className="px-4 py-3 text-zinc-600">{r.human_failure_classification ?? r.failure_classification ?? '—'}</td>
                <td className="px-4 py-3 text-right">
                  <Link href={`/evals/runs/${run.id}/${r.id}`} className="text-xs underline">
                    Inspect
                  </Link>
                </td>
              </tr>
            ))}
            {(results ?? []).length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-zinc-500">
                  {run.status === 'running' ? 'Run in progress…' : 'No results.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Metric({ label, value, baseline }: { label: string; value: string; baseline?: string }) {
  return (
    <div className="rounded border border-zinc-200 bg-white p-4">
      <div className="text-2xl font-semibold">{value}</div>
      <div className="text-xs uppercase tracking-wide text-zinc-500">{label}</div>
      {baseline !== undefined && <div className="mt-1 text-xs text-zinc-400">baseline: {baseline}</div>}
    </div>
  )
}
