import Link from 'next/link'
import type { ProjectReadiness, ReadinessJudgement } from '@/lib/projects/ember-readiness'
import { EmberReadinessForm } from './EmberReadinessForm'
import { READINESS_VERDICT_LABELS, READINESS_VERDICT_STYLES, formatReadinessDate } from './ember-readiness-labels'

// Ember Readiness, Stage 2 (docs/dev-request-ember-readiness-and-knowledge-
// gaps.md): how ready Ember is for this Project. Curator confidence and the
// measured score are shown side by side, never blended; the verdict on top
// is a person's decision. Every member sees it; Project curators and
// platform admins can update it.
export function EmberReadinessSection({
  projectId,
  readiness,
  canEdit,
  datasets,
  nameForUser,
}: {
  projectId: string
  readiness: ProjectReadiness
  canEdit: boolean
  // The Project's eval datasets -- linked for curators (who author the test
  // questions), listed for everyone else.
  datasets: { id: string; name: string; status: string }[]
  nameForUser: (userId: string | null) => string
}) {
  const { current, measured, coverage, status, history } = readiness

  return (
    <section id="ember-readiness" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Ember readiness</h2>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${READINESS_VERDICT_STYLES[status.verdict]}`}>
          {READINESS_VERDICT_LABELS[status.verdict]}
        </span>
        {status.reviewDue && <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">Review due</span>}
      </div>
      <p className="text-sm text-zinc-600">
        How well Ember knows this Project: a curator&rsquo;s judgement and a measured test score, shown separately.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="rounded border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Curator confidence</div>
          {current ? (
            <>
              <div className="mt-1 text-3xl font-semibold">{current.confidencePercent}%</div>
              <p className="mt-1 text-sm text-zinc-700">{current.rationale}</p>
              <p className="mt-2 text-xs text-zinc-500">
                Set by {nameForUser(current.setBy)} on {formatReadinessDate(current.setAt)} · review by {formatReadinessDate(current.reviewDueAt)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">Not assessed yet.</p>
          )}
        </div>

        <div className="rounded border border-zinc-200 bg-white p-4">
          <div className="text-xs uppercase tracking-wide text-zinc-500">Measured score</div>
          {measured ? (
            <>
              <div className="mt-1 text-3xl font-semibold">{measured.pct}%</div>
              <p className="mt-1 text-sm text-zinc-700">
                {measured.passed} of {measured.questions} test question{measured.questions === 1 ? '' : 's'} passed
              </p>
              <p className="mt-2 text-xs text-zinc-500">
                {measured.datasetName ?? 'Test questions'} · run {formatReadinessDate(measured.measuredAt)}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-zinc-500">
              No test run yet. A platform admin runs the Project&rsquo;s test questions from Admin → Ember readiness.
            </p>
          )}
        </div>
      </div>

      {status.disagreement && (
        <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {status.disagreement} Worth a look before relying on either.
        </p>
      )}
      {status.reviewReasons.length > 0 && (
        <ul className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          {status.reviewReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}

      <p className="text-sm text-zinc-600">
        Knowledge: {coverage.sourceCount} source{coverage.sourceCount === 1 ? '' : 's'} ({coverage.searchableSourceCount} searchable) ·{' '}
        {coverage.wikiArticleCount} Wiki article{coverage.wikiArticleCount === 1 ? '' : 's'} · last source added{' '}
        {formatReadinessDate(coverage.lastSourceAddedAt)}
      </p>

      <div className="text-sm text-zinc-600">
        Test questions:{' '}
        {datasets.length === 0
          ? 'none yet.'
          : datasets.map((d, i) => (
              <span key={d.id}>
                {i > 0 && ', '}
                {canEdit ? (
                  <Link href={`/evals/datasets/${d.id}`} className="underline">
                    {d.name}
                  </Link>
                ) : (
                  d.name
                )}{' '}
                <span className="text-zinc-500">({d.status})</span>
              </span>
            ))}
      </div>

      {canEdit && <EmberReadinessForm projectId={projectId} initialConfidence={current?.confidencePercent ?? null} initialVerdict={current?.verdict ?? null} />}

      {history.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-zinc-600">Earlier assessments ({history.length})</summary>
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((h: ReadinessJudgement) => (
              <li key={h.setAt} className="rounded border border-zinc-100 bg-white px-3 py-2">
                <span className="font-medium">{h.confidencePercent}%</span> · {READINESS_VERDICT_LABELS[h.verdict]} ·{' '}
                <span className="text-zinc-500">
                  {nameForUser(h.setBy)}, {formatReadinessDate(h.setAt)}
                </span>
                <p className="mt-0.5 text-zinc-700">{h.rationale}</p>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}
