import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRequirement, getRequirementOptions } from '@/lib/projects/requirements'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import {
  APPLIES_FROM_LABELS,
  CATEGORY_LABELS,
  METHOD_LABELS,
  PERFORMER_LABELS,
  PRIORITY_LABELS,
  SOURCE_KIND_LABELS,
  STATUS_LABELS,
  STATUS_STYLES,
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

export default async function RequirementPage({ params }: { params: Promise<{ id: string; requirementId: string }> }) {
  const { id, requirementId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const detail = await getRequirement(supabase, id, requirementId)
  if (!detail) notFound()
  const { requirement: r, sources, methods, workstreams, objects } = detail
  const isDraft = r.status === 'draft'
  const canEdit = canCurate && isDraft
  const picker = canEdit ? await getRequirementOptions(supabase, id) : null

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements`} className="text-sm underline">
          &larr; Requirements · {project.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="font-mono text-sm text-zinc-500">{r.code}</span>
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
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
            </li>
          ))}
          {methods.length === 0 && <li className="text-sm text-amber-800">No verification method yet.</li>}
        </ul>
        {canEdit && <VerificationMethodForm requirementId={r.id} />}
      </section>

      {canCurate && (
        <RequirementLifecycleActions projectId={id} requirementId={r.id} isDraft={isDraft} isOpen={r.status === 'draft' || r.status === 'baselined'} />
      )}
    </div>
  )
}
