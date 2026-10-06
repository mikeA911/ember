import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listBaselines } from '@/lib/projects/baselines'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import {
  BASELINE_STATUS_LABELS,
  BASELINE_STATUS_STYLES,
  CONFORMANCE_STATUS_LABELS,
  CONFORMANCE_STATUS_STYLES,
  DECISION_TYPE_LABELS,
} from '@/components/projects/requirement-labels'

// Solution conformance, Stage 3: the Project's evaluation baselines -- frozen,
// versioned sets of requirements that conformance decisions are made against.
export default async function BaselinesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const baselines = await listBaselines(supabase, id)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements`} className="text-sm underline">
          &larr; Requirements · {project.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h1 className="text-xl font-semibold">Baselines and decisions</h1>
            <p className="mt-1 text-sm text-zinc-600">
              A baseline fixes the requirements a decision is made against (e.g. Phase 1 site acceptance). Once active it can&rsquo;t change; a new scope is a
              new version. Decisions are approved by the people holding the matching approval authority in this Project.
            </p>
          </div>
          {canCurate && (
            <Link href={`/projects/${id}/requirements/baselines/new`} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
              New baseline
            </Link>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full min-w-[40rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Baseline</th>
              <th className="px-3 py-2 font-medium">For</th>
              <th className="px-3 py-2 text-right font-medium">Requirements</th>
              <th className="px-3 py-2 font-medium">Latest decision</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {baselines.map((b) => (
              <tr key={b.id} className={b.status === 'superseded' ? 'text-zinc-500' : ''}>
                <td className="px-3 py-2">
                  <Link href={`/projects/${id}/requirements/baselines/${b.id}`} className="font-medium underline">
                    {b.name}
                  </Link>{' '}
                  <span className="text-xs text-zinc-500">v{b.version}</span>
                </td>
                <td className="px-3 py-2 text-zinc-600">{DECISION_TYPE_LABELS[b.purpose]}</td>
                <td className="px-3 py-2 text-right">{b.itemCount}</td>
                <td className="px-3 py-2 text-xs">
                  {b.latestDecision ? (
                    <span className={`rounded-full px-2 py-0.5 font-medium ${CONFORMANCE_STATUS_STYLES[b.latestDecision.status]}`}>
                      {DECISION_TYPE_LABELS[b.latestDecision.decision_type]}: {CONFORMANCE_STATUS_LABELS[b.latestDecision.status]}
                    </span>
                  ) : (
                    <span className="text-zinc-400">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BASELINE_STATUS_STYLES[b.status]}`}>{BASELINE_STATUS_LABELS[b.status]}</span>
                </td>
              </tr>
            ))}
            {baselines.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-zinc-500">
                  No baselines yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
