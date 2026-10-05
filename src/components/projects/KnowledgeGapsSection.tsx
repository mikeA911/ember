import type { ProjectKnowledgeGap } from '@/types/database'
import { KnowledgeGapActions } from './KnowledgeGapActions'
import { ReportFailureForm } from './ReportFailureForm'
import { FAILURE_KIND_LABELS, GAP_STATUS_LABELS, GAP_STATUS_STYLES } from './knowledge-gap-labels'
import { formatReadinessDate } from './ember-readiness-labels'

const OPEN = new Set(['new', 'needs_source', 'wiki_needed'])

// Ember Readiness, Stage 3: failure reports and the curators' knowledge-gap
// queue. Every member can report; a reporter sees their own reports and how
// they were resolved; the Project's curators and platform admins see and
// work the whole queue. (RLS returns exactly that set, so `gaps` is already
// scoped to the viewer.)
export function KnowledgeGapsSection({
  projectId,
  gaps,
  isCurator,
  nameForUser,
  sources,
  articles,
  evalCaseDatasetById,
}: {
  projectId: string
  gaps: ProjectKnowledgeGap[]
  isCurator: boolean
  nameForUser: (userId: string | null) => string
  // What a gap can be resolved with: this Project's sources and Wiki articles.
  sources: { id: string; title: string }[]
  articles: { id: string; title: string }[]
  // eval_cases.id -> dataset id, for gaps already turned into test questions.
  evalCaseDatasetById: Map<string, string>
}) {
  const open = gaps.filter((g) => OPEN.has(g.status))
  const closed = gaps.filter((g) => !OPEN.has(g.status))
  const sourceTitle = new Map(sources.map((s) => [s.id, s.title]))
  const articleTitle = new Map(articles.map((a) => [a.id, a.title]))

  function GapCard({ gap }: { gap: ProjectKnowledgeGap }) {
    const isOpen = OPEN.has(gap.status)
    const resolvedWith = [
      gap.resolving_source_id ? `source "${sourceTitle.get(gap.resolving_source_id) ?? 'linked source'}"` : null,
      gap.resolving_article_id ? `Wiki "${articleTitle.get(gap.resolving_article_id) ?? 'linked article'}"` : null,
    ].filter(Boolean)

    return (
      <li className="flex flex-col gap-1.5 rounded border border-zinc-200 bg-white p-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${GAP_STATUS_STYLES[gap.status]}`}>{GAP_STATUS_LABELS[gap.status]}</span>
          {gap.failure_kind && <span className="text-xs text-zinc-500">{FAILURE_KIND_LABELS[gap.failure_kind]}</span>}
          <span className="text-xs text-zinc-500">
            {gap.origin === 'automatic' ? 'Detected by Ember' : `Reported by ${nameForUser(gap.reported_by)}`} · {formatReadinessDate(gap.created_at)}
          </span>
        </div>
        <p className="font-medium">{gap.question}</p>
        {gap.details && <p className="text-zinc-700">{gap.details}</p>}
        {gap.correct_answer && (
          <p className="text-zinc-700">
            <span className="text-zinc-500">Correct answer: </span>
            {gap.correct_answer}
          </p>
        )}
        {gap.suggested_source && (
          <p className="text-zinc-700">
            <span className="text-zinc-500">Suggested source: </span>
            {gap.suggested_source}
          </p>
        )}
        {gap.ember_answer && (
          <details>
            <summary className="cursor-pointer text-xs text-zinc-500">
              What Ember said{gap.answer_model ? ` (${gap.answer_model})` : ''}
            </summary>
            <p className="mt-1 whitespace-pre-wrap rounded bg-zinc-50 p-2 text-xs text-zinc-700">{gap.ember_answer}</p>
            {gap.cited_sources && gap.cited_sources.length > 0 && (
              <p className="mt-1 text-xs text-zinc-500">Cited: {gap.cited_sources.map((c) => c.label).join('; ')}</p>
            )}
          </details>
        )}
        {gap.triage_note && <p className="text-xs text-zinc-600">Curator note: {gap.triage_note}</p>}
        {gap.status === 'resolved' && (
          <p className="text-xs text-green-800">
            Resolved{resolvedWith.length > 0 ? ` with ${resolvedWith.join(' and ')}` : ''}
            {gap.resolution_note ? `: ${gap.resolution_note}` : '.'}
            {gap.verified_answers === true && ' Ember now answers it.'}
            {gap.verified_answers === false && ' Ember still doesn’t answer it.'}
          </p>
        )}
        {gap.status === 'product_issue' && <p className="text-xs text-purple-800">Moved to the platform feedback board as a problem with Ember itself.</p>}
        {isCurator && (
          <KnowledgeGapActions
            gapId={gap.id}
            isOpen={isOpen}
            canPromote={!gap.eval_case_id && gap.status !== 'out_of_scope' && gap.status !== 'duplicate' && gap.status !== 'product_issue'}
            evalCaseDatasetId={gap.eval_case_id ? (evalCaseDatasetById.get(gap.eval_case_id) ?? null) : null}
            sources={sources}
            articles={articles}
            otherGaps={gaps.filter((g) => g.id !== gap.id && g.status !== 'duplicate').map((g) => ({ id: g.id, question: g.question }))}
          />
        )}
      </li>
    )
  }

  return (
    <section id="knowledge-gaps" className="flex scroll-mt-4 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge gaps</h2>
        {isCurator && <span className="text-xs text-zinc-500">{open.length} open</span>}
      </div>
      <p className="text-sm text-zinc-600">
        {isCurator
          ? 'Questions Ember got wrong or couldn’t answer from this Project’s knowledge. Add or approve the missing source, link it here, and turn the question into a test question so it stays fixed.'
          : 'Tell the Project’s curators when Ember gets something wrong or can’t answer. In a chat, use “Report a problem” under the answer.'}
      </p>
      <ReportFailureForm projectId={projectId} />

      {isCurator ? (
        <>
          {open.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {open.map((g) => (
                <GapCard key={g.id} gap={g} />
              ))}
            </ul>
          ) : (
            <p className="text-sm text-zinc-500">No open knowledge gaps.</p>
          )}
          {closed.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-zinc-600">Closed ({closed.length})</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {closed.map((g) => (
                  <GapCard key={g.id} gap={g} />
                ))}
              </ul>
            </details>
          )}
        </>
      ) : (
        gaps.length > 0 && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">Your reports</h3>
            <ul className="flex flex-col gap-2">
              {gaps.map((g) => (
                <GapCard key={g.id} gap={g} />
              ))}
            </ul>
          </div>
        )
      )}
    </section>
  )
}
