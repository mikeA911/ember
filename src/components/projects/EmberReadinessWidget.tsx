import Link from 'next/link'
import type { ProjectReadiness } from '@/lib/projects/ember-readiness'
import { READINESS_VERDICT_LABELS, READINESS_VERDICT_STYLES } from './ember-readiness-labels'

// Ember Readiness, Stage 2: one row per Project the viewer belongs to, on
// the dashboard. Curator confidence and the measured score stay in separate
// columns; the full picture is the Project page's Ember readiness section.
export function EmberReadinessWidget({ projects }: { projects: { id: string; name: string; readiness: ProjectReadiness }[] }) {
  if (projects.length === 0) return null

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Ember readiness</h2>
      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full min-w-[36rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Project</th>
              <th className="px-3 py-2 font-medium">Verdict</th>
              <th className="px-3 py-2 text-right font-medium">Curator confidence</th>
              <th className="px-3 py-2 text-right font-medium">Measured score</th>
              <th className="px-3 py-2 text-right font-medium">Open gaps</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {projects.map(({ id, name, readiness }) => (
              <tr key={id}>
                <td className="px-3 py-2">
                  <Link href={`/projects/${id}#ember-readiness`} className="underline">
                    {name}
                  </Link>
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${READINESS_VERDICT_STYLES[readiness.status.verdict]}`}>
                    {READINESS_VERDICT_LABELS[readiness.status.verdict]}
                  </span>
                  {readiness.status.reviewDue && <span className="ml-2 text-xs text-red-700">review due</span>}
                </td>
                <td className="px-3 py-2 text-right">{readiness.current ? `${readiness.current.confidencePercent}%` : '—'}</td>
                <td className="px-3 py-2 text-right">
                  {readiness.measured ? `${readiness.measured.passed}/${readiness.measured.questions} (${readiness.measured.pct}%)` : '—'}
                </td>
                <td className="px-3 py-2 text-right">
                  {readiness.openGapCount > 0 ? (
                    <Link href={`/projects/${id}#knowledge-gaps`} className="underline">
                      {readiness.openGapCount}
                    </Link>
                  ) : (
                    0
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
