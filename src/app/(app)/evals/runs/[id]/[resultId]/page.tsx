import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { HumanReviewForm } from '@/components/eval/HumanReviewForm'
import type { RetrievedEvidenceItem } from '@/types/database'

export default async function EvalResultPage({ params }: { params: Promise<{ id: string; resultId: string }> }) {
  const { id, resultId } = await params
  const supabase = await createClient()

  // Ember Readiness, Stage 1: eval results and human review are platform-
  // admin work.
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  if (viewerProfile?.role !== 'admin') redirect('/dashboard')

  const { data: result } = await supabase.from('eval_results').select('*').eq('id', resultId).eq('eval_run_id', id).single()
  if (!result) notFound()

  const { data: evalCase } = await supabase.from('eval_cases').select('*').eq('id', result.eval_case_id).single()

  const [{ data: graphRun }, { data: graphSteps }] = result.graph_run_id
    ? await Promise.all([
        supabase.from('graph_runs').select('*').eq('id', result.graph_run_id).single(),
        supabase.from('graph_steps').select('*').eq('graph_run_id', result.graph_run_id).order('sequence_number', { ascending: true }),
      ])
    : [{ data: null }, { data: null }]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/evals/runs/${id}`} className="text-sm underline">
          ← Back to run
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{evalCase?.question}</h1>
      </div>

      {result.status === 'failed' && (
        <div className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <p className="font-medium">Failed at: {result.error?.stage}</p>
          <p className="mt-1">{result.error?.message}</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Expected</h2>
          {evalCase?.expected_answer && <p className="text-sm text-zinc-700">{evalCase.expected_answer}</p>}
          {!!evalCase?.expected_concepts?.length && (
            <p className="mt-2 text-sm text-zinc-700">
              <span className="font-medium">Concepts:</span> {evalCase.expected_concepts.join(', ')}
            </p>
          )}
          <p className="mt-2 text-xs text-zinc-500">
            {(evalCase?.expected_article_ids?.length ?? 0) + (evalCase?.expected_chunk_ids?.length ?? 0)} expected evidence item(s)
          </p>
        </div>

        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Retrieved</h2>
          {result.retrieved_evidence?.length ? (
            <ol className="flex flex-col gap-1 text-sm text-zinc-700">
              {result.retrieved_evidence.map((item: RetrievedEvidenceItem) => (
                <li key={`${item.type}-${item.id}`}>
                  {item.rank}. [{item.type}] {item.title} <span className="text-zinc-400">({item.similarity.toFixed(3)})</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-zinc-500">No evidence retrieved.</p>
          )}
        </div>
      </div>

      {result.generated_answer && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Answer</h2>
          <p className="whitespace-pre-wrap text-sm text-zinc-700">{result.generated_answer}</p>
        </div>
      )}

      <div className="rounded border border-zinc-200 bg-white p-4">
        <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Scores</h2>
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          <div>
            Retrieval:{' '}
            {result.retrieval_hit === null ? '—' : result.retrieval_hit ? <span className="text-green-700">HIT</span> : <span className="text-red-600">FAIL</span>}
          </div>
          <div>Recall: {result.retrieval_recall?.toFixed(2) ?? '—'}</div>
          <div>MRR: {result.retrieval_mrr?.toFixed(2) ?? '—'}</div>
          <div>Generation: {result.generation_score?.toFixed(2) ?? '—'}</div>
          <div>Grounding: {result.grounding_score?.toFixed(2) ?? '—'}</div>
          <div>Outcome: {result.outcome_score?.toFixed(2) ?? '—'}</div>
          <div>Latency: {result.latency_ms ? `${(result.latency_ms / 1000).toFixed(1)}s` : '—'}</div>
          <div>Failure: {result.failure_classification ?? '—'}</div>
        </div>
        {result.evaluator_details && (
          <div className="mt-3 border-t border-zinc-100 pt-3 text-sm text-zinc-700">
            <p>
              <span className="font-medium">Judge reasoning:</span> {result.evaluator_details.reasoning}
            </p>
            {!!result.evaluator_details.missing_concepts.length && (
              <p className="mt-1">
                <span className="font-medium">Missing concepts:</span> {result.evaluator_details.missing_concepts.join(', ')}
              </p>
            )}
            {!!result.evaluator_details.unsupported_claims.length && (
              <p className="mt-1">
                <span className="font-medium">Unsupported claims:</span> {result.evaluator_details.unsupported_claims.join(', ')}
              </p>
            )}
          </div>
        )}
      </div>

      {graphRun && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-zinc-500">Graph trace</h2>
          <p className="mb-3 text-xs text-zinc-500">
            {graphRun.iteration_count + 1} attempt{graphRun.iteration_count > 0 ? 's' : ''} · status: {graphRun.status}
            {graphRun.termination_reason && <> · terminated: {graphRun.termination_reason}</>}
          </p>
          <ol className="flex flex-col gap-2">
            {(graphSteps ?? []).map((step) => (
              <li
                key={step.id}
                className={`rounded border px-3 py-2 text-sm ${step.status === 'failed' ? 'border-red-200 bg-red-50' : 'border-zinc-100'}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">
                    {step.sequence_number}. {step.node_name}{' '}
                    <span className="font-normal text-zinc-400">(iteration {step.iteration})</span>
                  </span>
                  <span className="text-xs text-zinc-500">{step.latency_ms !== null ? `${step.latency_ms}ms` : '—'}</span>
                </div>
                {step.status === 'failed' && (
                  <p className="mt-1 text-xs text-red-700">
                    {step.error_code}: {step.error_message}
                  </p>
                )}
              </li>
            ))}
            {(graphSteps ?? []).length === 0 && <li className="text-sm text-zinc-500">No steps recorded.</li>}
          </ol>
        </div>
      )}

      <HumanReviewForm result={result} runId={id} />
    </div>
  )
}
