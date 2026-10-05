import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { SectionHero } from '@/components/SectionHero'

const DATASET_STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  active: 'bg-green-100 text-green-800',
  archived: 'bg-zinc-200 text-zinc-500',
}

const RUN_STATUS_STYLES: Record<string, string> = {
  pending: 'bg-zinc-100 text-zinc-700',
  running: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
  cancelled: 'bg-zinc-200 text-zinc-500',
}

export default async function EvalsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  const canAuthor = viewerProfile?.role === 'curator' || viewerProfile?.role === 'admin'
  // Ember Readiness, Stage 1: running evals and reading runs is platform-
  // admin work (reached from Admin -> Ember readiness). Curators still come
  // here to find and author datasets; everyone else goes back to Ember.
  const isAdmin = viewerProfile?.role === 'admin'
  if (!canAuthor) redirect('/dashboard')

  const [{ data: datasets }, { data: runs }] = await Promise.all([
    supabase.from('eval_datasets').select('*').order('created_at', { ascending: false }),
    isAdmin
      ? supabase
          .from('eval_runs')
          .select('id, name, status, dataset_id, is_baseline, created_at, completed_at')
          .order('created_at', { ascending: false })
          .limit(20)
      : Promise.resolve({ data: [] }),
  ])

  const datasetNameById = new Map((datasets ?? []).map((d) => [d.id, d.name]))

  return (
    <div className="flex flex-col gap-8">
      <SectionHero image="/images/sections/evaluations.png" height="compact" priority />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Evals</h1>
        {canAuthor && (
          <Link href="/evals/datasets/new" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            New dataset
          </Link>
        )}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Datasets</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {(datasets ?? []).map((d) => (
            <Link key={d.id} href={`/evals/datasets/${d.id}`} className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400">
              <div className="flex items-start justify-between gap-2">
                <h3 className="font-medium">{d.name}</h3>
                <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${DATASET_STATUS_STYLES[d.status]}`}>
                  {d.status}
                </span>
              </div>
              <p className="mt-1 text-xs text-zinc-500">version {d.version}</p>
              {d.description && <p className="mt-1 text-sm text-zinc-600">{d.description}</p>}
            </Link>
          ))}
          {(datasets ?? []).length === 0 && <p className="text-sm text-zinc-500 sm:col-span-2">No datasets yet.</p>}
        </div>
      </section>

      {isAdmin && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Recent runs</h2>
          <div className="rounded border border-zinc-200 bg-white">
            <table className="w-full text-sm">
              <thead className="border-b border-zinc-200 text-left text-zinc-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Run</th>
                  <th className="px-4 py-2 font-medium">Dataset</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0">
                    <td className="px-4 py-3">
                      <Link href={`/evals/runs/${r.id}`} className="font-medium underline">
                        {r.name || r.id.slice(0, 8)}
                      </Link>
                      {r.is_baseline && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">baseline</span>}
                    </td>
                    <td className="px-4 py-3 text-zinc-600">{datasetNameById.get(r.dataset_id) ?? '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${RUN_STATUS_STYLES[r.status]}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/evals/runs/new?dataset=${r.dataset_id}`} className="text-xs underline">
                        Run again
                      </Link>
                    </td>
                  </tr>
                ))}
                {(runs ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-4 py-8 text-center text-zinc-500">
                      No runs yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
