import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRequirement, getRequirementOptions } from '@/lib/projects/requirements'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { currentResultByMethod, listEvidenceArtifactOptions, listVerificationRecords, rollUpVerification } from '@/lib/projects/verification'
import {
  APPLIES_FROM_LABELS,
  CATEGORY_LABELS,
  ENVIRONMENT_LABELS,
  METHOD_LABELS,
  PERFORMER_LABELS,
  PRIORITY_LABELS,
  RESULT_LABELS,
  RESULT_STYLES,
  SOURCE_KIND_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
  VERIFICATION_STATUS_LABELS,
  VERIFICATION_STATUS_STYLES,
} from '@/components/projects/requirement-labels'
import {
  AddSourceForm,
  RemoveSourceButton,
  RemoveMethodButton,
  RequirementFieldsEditor,
  RequirementLifecycleActions,
  ScopeEditor,
  VerificationMethodForm,
} from '@/components/projects/RequirementForms'
import { VerificationRecordForm } from '@/components/projects/VerificationRecordForm'
import type { VerificationEnvironment, VerificationResult } from '@/types/database'

export default async function RequirementPage({ params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const { id, requirementId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, canRecord, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const detail = await getRequirement(supabase, id, requirementId)
  if (!detail) notFound()
  const { requirement: r, sources, methods, workstreams, objects } = detail
  const isDraft = r.status === 'draft'
  const canEdit = canCurate && isDraft
  const isOpen = r.status === 'draft' || r.status === 'baselined'
  const canRecordHere = canRecord && isOpen && methods.length > 0
  const [picker, records, artifacts] = await Promise.all([
    canEdit ? getRequirementOptions(supabase, id) : Promise.resolve(null),
    // Stage 2; an empty history if the records can't be read (e.g. the
    // migration isn't applied yet).
    listVerificationRecords(supabase, requirementId).catch((err) => {
      console.error('Verification records unavailable', err)
      return []
    }),
    canRecordHere ? listEvidenceArtifactOptions(supabase, id, workstreams.map((w) => w.id)) : Promise.resolve([]),
  ])
  const current = currentResultByMethod(records)
  const verification = rollUpVerification(
    methods.map((m) => m.id),
    records
  )
  const recordForm = (props: { methodId?: string; supersedes?: (typeof records)[number] }) => (
    <VerificationRecordForm
      requirementId={r.id}
      methods={methods}
      artifacts={artifacts}
      methodId={props.methodId}
      supersedesId={props.supersedes?.id}
      initial={
        props.supersedes
          ? {
              methodId: props.supersedes.method_id ?? methods[0].id,
              environment: props.supersedes.environment,
              solutionReference: props.supersedes.solution_reference,
              configurationReference: props.supersedes.configuration_reference ?? '',
              artifactIds: props.supersedes.evidence.map((e) => e.artifactId).filter((x): x is string => !!x),
            }
          : undefined
      }
    />
  )

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements`} className="text-sm underline">
          &larr; Requirements · {project.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-zinc-500">{r.code}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${VERIFICATION_STATUS_STYLES[verification]}`}>
            {VERIFICATION_STATUS_LABELS[verification]}
          </span>
        </div>
        <h1 className="mt-1 text-xl font-semibold">{r.title}</h1>
        <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800">{r.statement}</p>
        {r.rationale && <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">Why: {r.rationale}</p>}
        <p className="mt-2 text-xs text-zinc-500">
          {CATEGORY_LABELS[r.category]} · {PRIORITY_LABELS[r.priority]} · verify from {APPLIES_FROM_LABELS[r.applies_from].toLowerCase()}
        </p>
        {canEdit && (
          <div className="mt-2">
            <RequirementFieldsEditor
              requirementId={r.id}
              initial={{
                code: r.code,
                title: r.title,
                statement: r.statement,
                rationale: r.rationale ?? '',
                category: r.category,
                priority: r.priority,
                appliesFrom: r.applies_from,
              }}
            />
          </div>
        )}
        {canCurate && !isDraft && r.status === 'baselined' && (
          <p className="mt-2 text-xs text-zinc-500">Baselined requirements can&rsquo;t be edited. Withdraw it, or supersede it with a new requirement.</p>
        )}
      </div>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Where it comes from</h2>
        <ul className="flex flex-col gap-2">
          {sources.map((s) => (
            <li key={s.id} className="rounded border border-zinc-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={`font-medium ${s.kind === 'vendor_claim' ? 'text-purple-800' : ''}`}>{SOURCE_KIND_LABELS[s.kind]}</span>
                {canEdit && <RemoveSourceButton requirementId={r.id} sourceId={s.id} />}
              </div>
              {s.locator && <p className="text-zinc-700">{s.locator}</p>}
              {s.requester && <p className="text-zinc-700">Requested by {s.requester}</p>}
              {s.knowledge_source_id && (
                <p className="text-xs">
                  Source:{' '}
                  <Link href={`/sources/${s.knowledge_source_id}`} className="underline">
                    {s.sourceTitle ?? 'linked source'}
                  </Link>
                </p>
              )}
              {s.wiki_article_id && (
                <p className="text-xs">
                  Wiki:{' '}
                  {s.articleSlug ? (
                    <Link href={`/wiki/${s.articleSlug}`} className="underline">
                      {s.articleTitle}
                    </Link>
                  ) : (
                    'linked article'
                  )}
                </p>
              )}
              {s.note && <p className="mt-1 text-xs text-zinc-600">{s.note}</p>}
            </li>
          ))}
          {sources.length === 0 && <li className="text-sm text-zinc-500">No sources you have access to.</li>}
        </ul>
        {canEdit && picker && <AddSourceForm requirementId={r.id} picker={picker} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What it concerns</h2>
        {workstreams.length === 0 && objects.length === 0 ? (
          <p className="text-sm text-zinc-500">Not scoped to a workstream or object.</p>
        ) : (
          <ul className="flex flex-wrap gap-2 text-sm">
            {workstreams.map((w) => (
              <li key={w.id}>
                <Link href={`/projects/${id}/workstreams/${w.id}`} className="rounded bg-zinc-100 px-2 py-0.5 underline">
                  {w.name}
                </Link>
              </li>
            ))}
            {objects.map((o) => (
              <li key={o.id} className="rounded bg-zinc-100 px-2 py-0.5">
                {o.name}
              </li>
            ))}
          </ul>
        )}
        {canEdit && picker && (
          <ScopeEditor requirementId={r.id} picker={picker} initialWorkstreamIds={workstreams.map((w) => w.id)} initialObjectIds={objects.map((o) => o.id)} />
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">How it will be verified</h2>
        <ul className="flex flex-col gap-2">
          {methods.map((m) => (
            <li key={m.id} className="rounded border border-zinc-200 bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {METHOD_LABELS[m.method]} <span className="font-normal text-zinc-500">· {PERFORMER_LABELS[m.performed_by]}</span>
                </span>
                {canEdit && (
                  <span className="flex gap-3">
                    <VerificationMethodForm
                      requirementId={r.id}
                      methodId={m.id}
                      initial={{
                        method: m.method,
                        procedure: m.procedure ?? '',
                        passCriteria: m.pass_criteria,
                        threshold: m.threshold ?? '',
                        measureWindow: m.measure_window ?? '',
                        performedBy: m.performed_by,
                      }}
                    />
                    <RemoveMethodButton requirementId={r.id} methodId={m.id} />
                  </span>
                )}
              </div>
              <p className="text-zinc-800">Pass: {m.pass_criteria}</p>
              {m.threshold && (
                <p className="text-zinc-700">
                  Threshold: {m.threshold} · measured {m.measure_window}
                </p>
              )}
              {m.procedure && <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600">{m.procedure}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-2 text-xs">
                <CurrentResult record={current.get(m.id)} />
                {canRecordHere && recordForm({ methodId: m.id })}
              </div>
            </li>
          ))}
          {methods.length === 0 && <li className="text-sm text-amber-800">No verification method yet.</li>}
        </ul>
        {canEdit && <VerificationMethodForm requirementId={r.id} />}
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Verification history</h2>
        <p className="text-xs text-zinc-500">
          Results can&rsquo;t be edited or deleted. A correction is recorded as a new result that supersedes the earlier one.
        </p>
        <ul className="flex flex-col gap-2">
          {records.map((rec) => (
            <li key={rec.id} className={`rounded border border-zinc-200 bg-white p-3 text-sm ${rec.supersededById ? 'opacity-60' : ''}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RESULT_STYLES[rec.result]}`}>{RESULT_LABELS[rec.result]}</span>
                  <span className="font-medium">{METHOD_LABELS[rec.method_kind]}</span>
                  {rec.supersededById && <span className="text-xs text-zinc-500">Superseded by a correction</span>}
                  {rec.supersedes_id && <span className="text-xs text-zinc-500">Correction</span>}
                </span>
                {canRecordHere && !rec.supersededById && recordForm({ supersedes: rec })}
              </div>
              <p className="text-xs text-zinc-600">
                {rec.performed_on} · {ENVIRONMENT_LABELS[rec.environment]} · {rec.solution_reference}
                {rec.configuration_reference && ` · config ${rec.configuration_reference}`}
              </p>
              <p className="text-xs text-zinc-500">Judged against: {rec.pass_criteria}</p>
              {rec.measured_value && <p className="text-zinc-700">Measured: {rec.measured_value}</p>}
              {rec.conditions && <p className="text-amber-800">Conditions: {rec.conditions}</p>}
              {rec.rationale && <p className="text-zinc-700">Rationale: {rec.rationale}</p>}
              {rec.observations && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{rec.observations}</p>}
              {rec.defect_reference && <p className="text-xs text-zinc-600">Issue: {rec.defect_reference}</p>}
              {rec.evidence.length > 0 && (
                <ul className="mt-1 flex flex-col gap-0.5 text-xs">
                  {rec.evidence.map((e, i) => (
                    <li key={e.artifactId ?? i}>
                      Evidence:{' '}
                      {e.title && e.workstreamId ? (
                        <Link href={`/projects/${id}/workstreams/${e.workstreamId}`} className="underline">
                          {e.title}
                        </Link>
                      ) : (
                        'artifact no longer available'
                      )}
                      {e.workstreamName && <span className="text-zinc-500"> · {e.workstreamName}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-zinc-400">
                Recorded {new Date(rec.recorded_at).toLocaleString()}
                {rec.recordedByEmail && ` by ${rec.recordedByEmail}`}
              </p>
            </li>
          ))}
          {records.length === 0 && <li className="text-sm text-zinc-500">No results recorded yet.</li>}
        </ul>
        {canRecord && isOpen && methods.length === 0 && (
          <p className="text-xs text-amber-800">Add a verification method before recording results.</p>
        )}
      </section>

      {canCurate && (
        <RequirementLifecycleActions projectId={id} requirementId={r.id} isDraft={isDraft} isOpen={isOpen} />
      )}
    </div>
  )
}

function CurrentResult({ record }: { record: { result: VerificationResult; performed_on: string; environment: VerificationEnvironment; solution_reference: string } | undefined }) {
  if (!record) return <span className="text-zinc-500">Not verified yet</span>
  return (
    <>
      <span className={`rounded-full px-2 py-0.5 font-medium ${RESULT_STYLES[record.result]}`}>{RESULT_LABELS[record.result]}</span>
      <span className="text-zinc-600">
        {record.performed_on} · {ENVIRONMENT_LABELS[record.environment]} · {record.solution_reference}
      </span>
    </>
  )
}
