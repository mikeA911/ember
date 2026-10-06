import Link from 'next/link'

// Solution conformance, Stages 1-2: the Project page's pointer into the
// requirements register, with verification counts.
export function RequirementsSummarySection({
  projectId,
  counts,
  canCurate,
}: {
  projectId: string
  counts: { draft: number; baselined: number; withoutMethod: number; passed: number; failed: number }
  canCurate: boolean
}) {
  const total = counts.draft + counts.baselined
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Requirements</h2>
      <p className="text-sm text-zinc-600">
        {total === 0 ? (
          'No requirements yet. Record what the delivered solution must satisfy, traced to standards, contract terms, customer needs and vendor claims.'
        ) : (
          <>
            {counts.draft} draft · {counts.baselined} baselined
            {counts.withoutMethod > 0 && <span className="text-amber-800"> · {counts.withoutMethod} without a verification method</span>}
            {' · '}
            {counts.passed} passed verification
            {counts.failed > 0 && <span className="text-red-700"> · {counts.failed} failed</span>}
          </>
        )}
      </p>
      <div className="flex gap-3 text-sm">
        <Link href={`/projects/${projectId}/requirements`} className="underline">
          Open the requirements register
        </Link>
        {canCurate && (
          <Link href={`/projects/${projectId}/requirements/new`} className="text-blue-700 underline">
            + New requirement
          </Link>
        )}
      </div>
    </section>
  )
}
