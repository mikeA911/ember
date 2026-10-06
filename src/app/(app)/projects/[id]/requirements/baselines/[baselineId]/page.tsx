import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getBaseline, listBaselineCandidates, listMyAuthorities, type BaselineRollUp } from '@/lib/projects/baselines'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { listReverificationDue, type ReverificationDue } from '@/lib/projects/reverification'
import {
  APPLIES_FROM_LABELS,
  BASELINE_REQUIREMENT_STATUS_LABELS,
  BASELINE_REQUIREMENT_STATUS_STYLES,
  BASELINE_STATUS_LABELS,
  BASELINE_STATUS_STYLES,
  CONFORMANCE_APPROVAL_LABELS,
  CONFORMANCE_STATUS_LABELS,
  CONFORMANCE_STATUS_STYLES,
  DECISION_TYPE_LABELS,
  REVERIFY_BADGE,
  STATUS_LABELS,
  WAIVER_KIND_LABELS,
} from '@/components/projects/requirement-labels'
import {
  BaselineFieldsEditor,
  BaselineItemsEditor,
  BaselineLifecycleActions,
  DecisionActions,
  DecisionRequestForm,
  WaiverActions,
  WaiverRequestForm,
} from '@/components/projects/BaselineForms'

// Solution conformance, Stage 3: one evaluation baseline -- its requirements
// and their live verification roll-up, waivers, and the conformance
// decisions made against it (each showing the roll-up it rested on).
export default async function BaselinePage({ params }: { params: Promise<{ id: string; baselineId: string }> }) {
  const { id, baselineId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, canRecord, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const detail = await getBaseline(supabase, id, baselineId)
  if (!detail) notFound()
  const { baseline: b, versions, requirements, rollUp, waivers, decisions } = detail
  const isDraft = b.status === 'draft'
  const isActive = b.status === 'active'
  const [candidates, authorities, reverification] = await Promise.all([
    canCurate && isDraft ? listBaselineCandidates(supabase, id) : Promise.resolve([]),
    listMyAuthorities(supabase, id, user.id),
    listReverificationDue(supabase, id).catch(() => new Map<string, ReverificationDue>()),
  ])
  const dueCount = requirements.filter((r) => reverification.has(r.id)).length

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements/baselines`} className="text-sm underline">
          &larr; Baselines · {project.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{b.name}</h1>
          <span className="text-sm text-zinc-500">v{b.version}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BASELINE_STATUS_STYLES[b.status]}`}>{BASELINE_STATUS_LABELS[b.status]}</span>
        </div>
        <p className="mt-1 text-sm text-zinc-600">
          {DECISION_TYPE_LABELS[b.purpose]} · {APPLIES_FROM_LABELS[b.lifecycle_stage]}
          {b.activated_at && ` · activated ${new Date(b.activated_at).toLocaleDateString()}`}
        </p>
        {b.description && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700">{b.description}</p>}
        {versions.length > 1 && (
          <p className="mt-2 flex flex-wrap gap-2 text-xs">
            <span className="text-zinc-500">Versions:</span>
            {versions.map((v) =>
              v.id === b.id ? (
                <span key={v.id} className="font-medium">
                  v{v.version} ({BASELINE_STATUS_LABELS[v.status].toLowerCase()})
                </span>
              ) : (
                <Link key={v.id} href={`/projects/${id}/requirements/baselines/${v.id}`} className="underline">
                  v{v.version} ({BASELINE_STATUS_LABELS[v.status].toLowerCase()})
                </Link>
              )
            )}
          </p>
        )}
        {canCurate && isDraft && (
          <div className="mt-2">
            <BaselineFieldsEditor
              baselineId={b.id}
              initial={{ name: b.name, purpose: b.purpose, lifecycleStage: b.lifecycle_stage, description: b.description ?? '' }}
            />
          </div>
        )}
        {canCurate && (
          <div className="mt-3">
            <BaselineLifecycleActions projectId={id} baselineId={b.id} status={b.status} />
          </div>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Requirements and where they stand</h2>
        <RollUpSummary rollUp={rollUp} />
        {dueCount > 0 && (
          <p className="text-sm text-orange-800">
            {dueCount} requirement{dueCount === 1 ? '' : 's'} need{dueCount === 1 ? 's' : ''} re-verification. A production-change decision over this baseline
            can&rsquo;t be approved until they are re-verified or resolved.{' '}
            <Link href={`/projects/${id}/requirements/changes`} className="underline">
              See changes
            </Link>
          </p>
        )}
        <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="bg-zinc-50 text-xs text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-medium">Code</th>
                <th className="px-3 py-2 font-medium">Requirement</th>
                <th className="px-3 py-2 font-medium">Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {requirements.map((r) => {
                const status = rollUp.statuses.get(r.id) ?? 'not_verified'
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.code}</td>
                    <td className="px-3 py-2">
                      <Link href={`/projects/${id}/requirements/${r.id}`} className="underline">
                        {r.title}
                      </Link>
                      {r.status !== 'baselined' && <span className="text-xs text-zinc-500"> · {STATUS_LABELS[r.status]}</span>}
                      {r.supersededBy && (
                        <Link href={`/projects/${id}/requirements/${r.supersededBy}`} className="ml-1 text-xs text-blue-700 underline">
                          see replacement
                        </Link>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${BASELINE_REQUIREMENT_STATUS_STYLES[status]}`}>
                        {BASELINE_REQUIREMENT_STATUS_LABELS[status]}
                      </span>
                      {reverification.has(r.id) && <span className={`ml-1 rounded-full px-2 py-0.5 text-xs font-medium ${REVERIFY_BADGE}`}>Re-verify</span>}
                    </td>
                  </tr>
                )
              })}
              {requirements.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-zinc-500">
                    No requirements in this baseline yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canCurate && isDraft && <BaselineItemsEditor baselineId={b.id} candidates={candidates} initial={requirements.map((r) => r.id)} />}
        {isDraft && (
          <p className="text-xs text-zinc-500">
            Activating needs at least one requirement, each with a verification method. It moves them to baselined, which fixes their content.
          </p>
        )}
      </section>

      {!isDraft && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Waivers and deviations</h2>
          <p className="text-xs text-zinc-500">
            A waiver accepts a requirement as not met for this baseline; a deviation accepts it met differently. Each needs a rationale and approval by a
            holder of the named authority, and approved ones appear in every report for this baseline.
          </p>
          <ul className="flex flex-col gap-2">
            {waivers.map((w) => (
              <li key={w.id} className="rounded border border-zinc-200 bg-white p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFORMANCE_STATUS_STYLES[w.status]}`}>{CONFORMANCE_STATUS_LABELS[w.status]}</span>
                  <span className="font-medium">
                    {WAIVER_KIND_LABELS[w.kind]} · <span className="font-mono text-xs">{w.requirementCode}</span>
                  </span>
                  <span className="text-xs text-zinc-500">needs {CONFORMANCE_APPROVAL_LABELS[w.approval_type].toLowerCase()} authority</span>
                </div>
                <p className="mt-1 whitespace-pre-wrap text-zinc-800">{w.rationale}</p>
                {w.conditions && <p className="text-amber-800">Conditions: {w.conditions}</p>}
                <p className="mt-1 text-xs text-zinc-500">
                  Requested {new Date(w.requested_at).toLocaleDateString()}
                  {w.requestedByEmail && ` by ${w.requestedByEmail}`}
                  {w.decided_at && w.status !== 'pending' && ` · ${CONFORMANCE_STATUS_LABELS[w.status].toLowerCase()} ${new Date(w.decided_at).toLocaleDateString()}`}
                  {w.decidedByEmail && w.status !== 'pending' && ` by ${w.decidedByEmail}`}
                </p>
                {w.decision_note && <p className="text-xs text-zinc-600">Note: {w.decision_note}</p>}
                {w.status === 'pending' && (authorities.has(w.approval_type) || w.requested_by === user.id || canCurate) && (
                  <WaiverActions
                    baselineId={b.id}
                    waiverId={w.id}
                    canDecide={authorities.has(w.approval_type)}
                    canWithdraw={w.requested_by === user.id || canCurate}
                  />
                )}
              </li>
            ))}
            {waivers.length === 0 && <li className="text-sm text-zinc-500">No waivers or deviations.</li>}
          </ul>
          {canRecord && isActive && requirements.length > 0 && <WaiverRequestForm baselineId={b.id} requirements={requirements} />}
        </section>
      )}

      {!isDraft && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Conformance decisions</h2>
          <ul className="flex flex-col gap-3">
            {decisions.map((d) => {
              const approvalsGiven = d.approvals.filter((a) => a.verdict === 'approve').length
              return (
                <li key={d.id} className="rounded border border-zinc-200 bg-white p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${CONFORMANCE_STATUS_STYLES[d.status]}`}>{CONFORMANCE_STATUS_LABELS[d.status]}</span>
                    <span className="font-medium">{DECISION_TYPE_LABELS[d.decision_type]}</span>
                    <span className="text-xs text-zinc-500">
                      needs {CONFORMANCE_APPROVAL_LABELS[d.approval_type].toLowerCase()} authority ·{' '}
                      {d.approval_mode === 'all_assigned' ? 'every holder must approve' : `${d.required_approvals} approval${d.required_approvals === 1 ? '' : 's'}`}
                      {d.status === 'pending' && ` · ${approvalsGiven} given`}
                    </span>
                  </div>
                  {d.request_note && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{d.request_note}</p>}
                  <p className="mt-1 text-xs text-zinc-500">
                    Requested {new Date(d.requested_at).toLocaleDateString()}
                    {d.requestedByEmail && ` by ${d.requestedByEmail}`}
                    {d.decided_at && ` · ${CONFORMANCE_STATUS_LABELS[d.status].toLowerCase()} ${new Date(d.decided_at).toLocaleString()}`}
                  </p>
                  {d.approvals.length > 0 && (
                    <ul className="mt-2 flex flex-col gap-1 text-xs">
                      {d.approvals.map((a) => (
                        <li key={a.id}>
                          <span className={a.verdict === 'approve' ? 'text-green-800' : 'text-red-700'}>{a.verdict === 'approve' ? 'Approved' : 'Rejected'}</span>
                          {a.approverEmail && ` by ${a.approverEmail}`} · {new Date(a.created_at).toLocaleString()}
                          {a.note && <span className="text-zinc-600"> — {a.note}</span>}
                          {a.conditions && <span className="text-amber-800"> · Conditions: {a.conditions}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  {d.decidedRollUp && d.snapshot && (
                    <div className="mt-2 rounded bg-zinc-50 p-2">
                      <p className="text-xs font-medium text-zinc-600">
                        What it rested on (v{d.snapshot.baseline_version}, {new Date(d.snapshot.taken_at).toLocaleString()}):
                      </p>
                      <RollUpSummary rollUp={d.decidedRollUp} />
                    </div>
                  )}
                  {d.status === 'pending' && (authorities.has(d.approval_type) || d.requested_by === user.id || canCurate) && (
                    <DecisionActions
                      baselineId={b.id}
                      decisionId={d.id}
                      canDecide={authorities.has(d.approval_type) && !d.approvals.some((a) => a.approver_id === user.id)}
                      canWithdraw={d.requested_by === user.id || canCurate}
                    />
                  )}
                </li>
              )
            })}
            {decisions.length === 0 && <li className="text-sm text-zinc-500">No decisions yet.</li>}
          </ul>
          {canCurate && isActive && <DecisionRequestForm baselineId={b.id} purpose={b.purpose} />}
          {b.status === 'superseded' && <p className="text-xs text-zinc-500">This version has been superseded; its decisions stay readable here.</p>}
        </section>
      )}
    </div>
  )
}

function RollUpSummary({ rollUp }: { rollUp: BaselineRollUp }) {
  const c = rollUp.counts
  return (
    <p className="text-sm text-zinc-700">
      {c.total} requirement{c.total === 1 ? '' : 's'}: <span className="text-green-800">{c.passed} passed</span>
      {c.failed > 0 && <span className="text-red-700"> · {c.failed} failed</span>}
      {c.conditional > 0 && <span className="text-amber-800"> · {c.conditional} conditional</span>}
      {c.waived > 0 && <span className="text-purple-800"> · {c.waived} waived</span>}
      {c.notApplicable > 0 && <span> · {c.notApplicable} not applicable</span>}
      <span className="text-zinc-500"> · {c.notVerified} not yet verified</span>
    </p>
  )
}
