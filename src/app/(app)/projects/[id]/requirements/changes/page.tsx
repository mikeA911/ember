import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getChangeFormOptions, listReverificationDue, listReverificationEvents } from '@/lib/projects/reverification'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { CHANGE_KIND_LABELS, LINK_STATE_LABELS, LINK_STATE_STYLES } from '@/components/projects/requirement-labels'
import { RecordChangeForm, ResolveReverificationForm } from '@/components/projects/ReverificationForms'

// Solution conformance, Stage 4: changes that need requirements re-verified
// -- component changes the team records, new versions of cited sources and
// operational measures outside their threshold (both automatic) -- and
// where each affected requirement stands.
export default async function RequirementChangesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, canRecord, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const due = await listReverificationDue(supabase, id)
  const [events, options] = await Promise.all([
    listReverificationEvents(supabase, id, { due }),
    canRecord ? getChangeFormOptions(supabase, id) : Promise.resolve(null),
  ])
  const reviewDue = [...due.values()].filter((d) => d.reviewDue).length

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements`} className="text-sm underline">
          &larr; Requirements · {project.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">Changes and re-verification</h1>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          A component, firmware or configuration change, a new version of a cited source, or an operational measure outside its threshold marks the affected
          requirements for re-verification. A requirement stays due until each of its methods has a new result, or a curator resolves it with a reason. Past
          results and decisions stay as they were.
        </p>
        <p className="mt-2 text-sm">
          {due.size === 0 ? (
            <span className="text-green-800">Nothing needs re-verification.</span>
          ) : (
            <span className="text-orange-800">
              {due.size} requirement{due.size === 1 ? '' : 's'} need{due.size === 1 ? 's' : ''} re-verification
              {reviewDue > 0 && ` (${reviewDue} for a scheduled review)`}.
            </span>
          )}
        </p>
      </div>

      {options && <RecordChangeForm projectId={id} requirements={options.requirements} objects={options.objects} workstreams={options.workstreams} />}

      <ul className="flex flex-col gap-3">
        {events.map((e) => (
          <li key={e.id} className="rounded border border-zinc-200 bg-white p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs font-medium">{CHANGE_KIND_LABELS[e.kind]}</span>
              <span className="font-medium">{e.summary}</span>
            </div>
            {e.change_reference && <p className="text-zinc-700">{e.change_reference}</p>}
            {e.detail && <p className="mt-1 whitespace-pre-wrap text-zinc-600">{e.detail}</p>}
            <p className="mt-1 text-xs text-zinc-500">
              {new Date(e.created_at).toLocaleString()}
              {e.recordedByEmail ? ` · recorded by ${e.recordedByEmail}` : e.kind === 'source_revision' ? ' · detected automatically' : ''}
              {e.objectName && ` · ${e.objectName}`}
              {e.workstreamName && ` · ${e.workstreamName}`}
              {e.knowledge_source_id && (
                <>
                  {' · '}
                  <Link href={`/sources/${e.knowledge_source_id}`} className="underline">
                    source
                  </Link>
                </>
              )}
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {e.requirements.map((r) => (
                <li key={r.linkId} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${LINK_STATE_STYLES[r.state]}`}>{LINK_STATE_LABELS[r.state]}</span>
                  <Link href={`/projects/${id}/requirements/${r.requirementId}`} className="underline">
                    <span className="font-mono">{r.code}</span> {r.title}
                  </Link>
                  {r.state === 'resolved' && r.resolutionNote && (
                    <span className="text-zinc-500">
                      — {r.resolutionNote}
                      {r.resolvedByEmail && ` (${r.resolvedByEmail})`}
                    </span>
                  )}
                  {canCurate && r.state === 'open' && <ResolveReverificationForm linkId={r.linkId} />}
                </li>
              ))}
            </ul>
          </li>
        ))}
        {events.length === 0 && <li className="text-sm text-zinc-500">No changes recorded yet.</li>}
      </ul>
    </div>
  )
}
