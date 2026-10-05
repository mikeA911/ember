import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listRequirements } from '@/lib/projects/requirements'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { CATEGORY_LABELS, PRIORITY_LABELS, SOURCE_KIND_LABELS, STATUS_LABELS, STATUS_STYLES, APPLIES_FROM_LABELS } from '@/components/projects/requirement-labels'
import type { RequirementStatus } from '@/types/database'

// Solution conformance, Stage 1: the Project's requirements register --
// what the delivered solution must satisfy, traced to its sources and
// scoped to workstreams and Project objects. Members read; Project
// curators/admins author draft requirements.
export default async function RequirementsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ status?: string; category?: string; workstream?: string }>
}) {
  const { id } = await params
  const filters = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate, isMember } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project || !isMember) notFound()

  const all = await listRequirements(supabase, id)
  const statusFilter = filters.status ?? 'open'
  const requirements = all.filter(
    (r) =>
      (statusFilter === 'all' || (statusFilter === 'open' ? r.status === 'draft' || r.status === 'baselined' : r.status === statusFilter)) &&
      (!filters.category || r.category === filters.category) &&
      (!filters.workstream || r.workstreamNames.includes(filters.workstream))
  )
  const counts = {
    draft: all.filter((r) => r.status === 'draft').length,
    baselined: all.filter((r) => r.status === 'baselined').length,
    withoutMethod: all.filter((r) => (r.status === 'draft' || r.status === 'baselined') && r.methodCount === 0).length,
    vendorClaims: all.filter((r) => (r.status === 'draft' || r.status === 'baselined') && r.sourceKinds.includes('vendor_claim')).length,
  }
  const workstreamNames = [...new Set(all.flatMap((r) => r.workstreamNames))].sort()

  const filterLink = (next: Record<string, string | undefined>) => {
    const merged = { status: statusFilter, category: filters.category, workstream: filters.workstream, ...next }
    const qs = new URLSearchParams(Object.entries(merged).filter((e): e is [string, string] => !!e[1])).toString()
    return `/projects/${id}/requirements${qs ? `?${qs}` : ''}`
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm underline">
          &larr; {project.name}
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div className="max-w-2xl">
            <h1 className="text-xl font-semibold">Requirements</h1>
            <p className="mt-1 text-sm text-zinc-600">
              What this Project&rsquo;s delivered solution must satisfy, where each requirement comes from (standards, regulation, contract, customer needs,
              vendor claims to verify), what it concerns and how it will be verified.
            </p>
          </div>
          {canCurate && (
            <Link href={`/projects/${id}/requirements/new`} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
              New requirement
            </Link>
          )}
        </div>
        <p className="mt-2 text-sm text-zinc-600">
          {counts.draft} draft · {counts.baselined} baselined
          {counts.withoutMethod > 0 && <span className="text-amber-800"> · {counts.withoutMethod} without a verification method</span>}
          {counts.vendorClaims > 0 && <span> · {counts.vendorClaims} citing vendor claims to verify</span>}
        </p>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <span className="text-zinc-500">Show:</span>
        {(['open', 'draft', 'baselined', 'withdrawn', 'superseded', 'all'] as const).map((s) => (
          <Link key={s} href={filterLink({ status: s })} className={statusFilter === s ? 'font-medium underline' : 'text-zinc-600 hover:underline'}>
            {s === 'open' ? 'Open' : s === 'all' ? 'All' : STATUS_LABELS[s as RequirementStatus]}
          </Link>
        ))}
        {(filters.category || filters.workstream) && (
          <Link href={filterLink({ category: undefined, workstream: undefined })} className="text-blue-700 underline">
            Clear filters
          </Link>
        )}
      </div>
      {workstreamNames.length > 0 && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className="text-zinc-500">Workstream:</span>
          {workstreamNames.map((w) => (
            <Link key={w} href={filterLink({ workstream: w })} className={filters.workstream === w ? 'font-medium underline' : 'text-zinc-600 hover:underline'}>
              {w}
            </Link>
          ))}
        </div>
      )}

      <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
        <table className="w-full min-w-[48rem] text-left text-sm">
          <thead className="bg-zinc-50 text-xs text-zinc-500">
            <tr>
              <th className="px-3 py-2 font-medium">Code</th>
              <th className="px-3 py-2 font-medium">Requirement</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Priority</th>
              <th className="px-3 py-2 font-medium">Sources</th>
              <th className="px-3 py-2 text-right font-medium">Methods</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {requirements.map((r) => (
              <tr key={r.id}>
                <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{r.code}</td>
                <td className="px-3 py-2">
                  <Link href={`/projects/${id}/requirements/${r.id}`} className="font-medium underline">
                    {r.title}
                  </Link>
                  <p className="text-xs text-zinc-500">
                    Verify from {APPLIES_FROM_LABELS[r.applies_from].toLowerCase()}
                    {r.workstreamNames.length > 0 && ` · ${r.workstreamNames.join(', ')}`}
                    {r.objectNames.length > 0 && ` · ${r.objectNames.join(', ')}`}
                  </p>
                </td>
                <td className="px-3 py-2 text-zinc-600">
                  <Link href={filterLink({ category: r.category })} className="hover:underline">
                    {CATEGORY_LABELS[r.category]}
                  </Link>
                </td>
                <td className="px-3 py-2 text-zinc-600">{PRIORITY_LABELS[r.priority]}</td>
                <td className="px-3 py-2 text-xs text-zinc-600">{r.sourceKinds.map((k) => SOURCE_KIND_LABELS[k]).join(', ') || '—'}</td>
                <td className={`px-3 py-2 text-right ${r.methodCount === 0 && r.status !== 'withdrawn' && r.status !== 'superseded' ? 'text-amber-800' : ''}`}>
                  {r.methodCount}
                </td>
                <td className="px-3 py-2">
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[r.status]}`}>{STATUS_LABELS[r.status]}</span>
                </td>
              </tr>
            ))}
            {requirements.length === 0 && (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-zinc-500">
                  {all.length === 0 ? 'No requirements yet.' : 'No requirements match these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
