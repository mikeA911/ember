import Link from 'next/link'
import type { EmberReadinessOverview } from '@/lib/eval/readiness-overview'

const DATASET_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  active: 'bg-green-100 text-green-800',
  archived: 'bg-zinc-200 text-zinc-500',
}

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

function score(v: number | null) {
  return v === null ? '—' : v.toFixed(2)
}

function date(v: string | null) {
  return v ? new Date(v).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}

// Admin -> Ember readiness. AI evaluation is evidence that Ember understands
// a Project's context before it suggests anything; running, baselining and
// reviewing it is platform-admin work (Ember Readiness, Stage 1). Curators
// author each dataset's test questions from their Project.
export function EmberReadinessAdmin({ overview }: { overview: EmberReadinessOverview }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h2 className="text-base font-semibold">Ember readiness</h2>
          <p className="mt-1 text-sm text-zinc-600">
            Each dataset holds test questions with known answers and sources. Running it shows whether Ember finds the right evidence and
            answers correctly for that Project. Curators write the questions; running, baselines and review happen here.
          </p>
        </div>
        <div className="flex shrink-0 gap-2 text-sm">
          <Link href="/evals" className="rounded border border-zinc-300 px-3 py-1.5 font-medium">
            All datasets and runs
          </Link>
          <Link href="/evals/runs/new" className="rounded bg-zinc-900 px-3 py-1.5 font-medium text-white">
            Run evaluation
          </Link>
        </div>
      </div>

      {(overview.failedRunCount > 0 || overview.runsNeedingReview > 0) && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {overview.failedRunCount > 0 && `${overview.failedRunCount} failed run${overview.failedRunCount === 1 ? '' : 's'}. `}
          {overview.runsNeedingReview > 0 &&
            `${overview.runsNeedingReview} completed run${overview.runsNeedingReview === 1 ? '' : 's'} with results awaiting human review.`}
        </p>
      )}

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full min-w-[44rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Dataset</th>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 text-right font-medium">Questions</th>
              <th className="px-3 py-2 font-medium">Latest run</th>
              <th className="px-3 py-2 text-right font-medium" title="Share of questions where the expected evidence was retrieved">
                Hit@K
              </th>
              <th className="px-3 py-2 text-right font-medium" title="Average outcome score from the LLM judge, where one ran">
                Outcome
              </th>
              <th className="px-3 py-2 text-right font-medium">To review</th>
              <th className="px-3 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {overview.datasets.map((d) => (
              <tr key={d.datasetId}>
                <td className="px-3 py-2">
                  <Link href={`/evals/datasets/${d.datasetId}`} className="font-medium underline">
                    {d.name}
                  </Link>
                  <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-medium ${DATASET_STATUS_STYLES[d.status]}`}>{d.status}</span>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  {d.projectId ? (
                    <Link href={`/projects/${d.projectId}`} className="underline">
                      {d.projectName ?? 'Project'}
                    </Link>
                  ) : (
                    'Platform-wide'
                  )}
                </td>
                <td className="px-3 py-2 text-right">{d.caseCount}</td>
                <td className="px-3 py-2 text-zinc-600">
                  {d.latestRun ? (
                    <Link href={`/evals/runs/${d.latestRun.id}`} className="underline">
                      {date(d.latestRun.completedAt)}
                    </Link>
                  ) : (
                    'Never run'
                  )}
                  {d.latestRun?.isBaseline && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">baseline</span>}
                  {d.latestRun && d.latestRun.failedCount > 0 && (
                    <span className="ml-2 text-xs text-red-700">{d.latestRun.failedCount} failed</span>
                  )}
                </td>
                <td className="px-3 py-2 text-right">{pct(d.latestRun?.hitAtK ?? null)}</td>
                <td className="px-3 py-2 text-right">{score(d.latestRun?.avgOutcomeScore ?? null)}</td>
                <td className="px-3 py-2 text-right">{d.latestRun ? d.latestRun.unreviewedCount : '—'}</td>
                <td className="px-3 py-2 text-right">
                  {d.caseCount > 0 && (
                    <Link href={`/evals/runs/new?dataset=${d.datasetId}`} className="text-xs underline">
                      Run
                    </Link>
                  )}
                </td>
              </tr>
            ))}
            {overview.datasets.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-zinc-500">
                  No datasets yet. Create one from Evals, then attach it to its Project.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
