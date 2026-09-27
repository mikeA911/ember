import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPublicProjectBySlug } from '@/lib/projects/public'
import { listPublicWorkstreams } from '@/lib/projects/public-workstreams'

const TYPE_LABELS: Record<string, string> = {
  learning: 'Learning',
  experiment: 'AI Experiment',
  consulting: 'Client / Consulting',
  transformation: 'Internal Transformation',
  knowledge: 'Knowledge',
}

export default async function ExampleDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const project = await getPublicProjectBySlug(supabase, slug)
  if (!project) notFound()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let canManage = false
  if (user) {
    const [{ data: viewerProfile }, { data: viewerMembership }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).single(),
      supabase.from('project_members').select('role').eq('project_id', project.id).eq('user_id', user.id).maybeSingle(),
    ])
    canManage = viewerProfile?.role === 'admin' || viewerMembership?.role === 'owner'
  }

  const profile = project.public_profile ?? {}
  const workstreams = project.public_full_detail ? await listPublicWorkstreams(supabase, project.id) : []

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{profile.title || project.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{TYPE_LABELS[project.project_type] ?? project.project_type}</p>
        </div>
        {canManage && (
          <Link href={`/projects/${project.id}/publish`} className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm">
            Manage Public Page
          </Link>
        )}
      </div>

      {profile.summary && <p className="text-zinc-700">{profile.summary}</p>}

      {profile.problem && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Question</h2>
          <p className="text-sm text-zinc-700 whitespace-pre-wrap">{profile.problem}</p>
        </section>
      )}

      {profile.approach && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Approach</h2>
          <p className="text-sm text-zinc-700 whitespace-pre-wrap">{profile.approach}</p>
        </section>
      )}

      {profile.benchmarkSummary && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Results &mdash; {profile.benchmarkSummary.name}</h2>
          <div className="overflow-x-auto rounded border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 text-left text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Metric</th>
                  <th className="px-4 py-2 font-medium">Baseline</th>
                  <th className="px-4 py-2 font-medium">Variant</th>
                </tr>
              </thead>
              <tbody>
                {profile.benchmarkSummary.rows.map((row) => (
                  <tr key={row.metric} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-2">{row.metric}</td>
                    <td className="px-4 py-2 text-zinc-600">{row.baseline ?? '—'}</td>
                    <td className="px-4 py-2 text-zinc-600">{row.variant ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {profile.findings && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Key Finding</h2>
          <p className="text-sm text-zinc-700 whitespace-pre-wrap">{profile.findings}</p>
        </section>
      )}

      {profile.conclusion && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">What We Learned</h2>
          <p className="text-sm text-zinc-700 whitespace-pre-wrap">{profile.conclusion}</p>
        </section>
      )}

      {workstreams.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Workstreams</h2>
          <p className="text-xs text-zinc-500">The real workstreams, artifacts, and assessment responses behind this project &mdash; not just the summary above.</p>
          <div className="flex flex-col gap-2">
            {workstreams.map((w) => (
              <Link
                key={w.id}
                href={`/examples/${slug}/workstreams/${w.id}`}
                className="rounded border border-zinc-200 bg-white p-3 text-sm hover:border-zinc-300"
              >
                <span className="font-medium">{w.name}</span>
                <span className="ml-2 text-xs text-zinc-500">
                  {w.deliverables.filter((d) => d.completed).length}/{w.deliverables.length} deliverables
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {profile.relatedWikiSlugs && profile.relatedWikiSlugs.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Related Knowledge</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {profile.relatedWikiSlugs.map((s) => (
              <Link key={s} href={`/knowledge/${s}`} className="rounded-full bg-zinc-100 px-3 py-1 hover:bg-zinc-200">
                {s}
              </Link>
            ))}
          </div>
        </section>
      )}

      {!user && (
        <div className="rounded border border-zinc-200 bg-white p-4 text-center">
          <Link href="/login" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            Sign in to explore Ember
          </Link>
        </div>
      )}
    </div>
  )
}
