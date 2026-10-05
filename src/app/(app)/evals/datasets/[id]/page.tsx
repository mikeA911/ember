import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { DatasetActions } from '@/components/eval/DatasetActions'
import { CaseManager } from '@/components/eval/CaseManager'

export default async function EvalDatasetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: viewerProfile } = user
    ? await supabase.from('profiles').select('role').eq('id', user.id).single()
    : { data: null }
  const canAuthor = viewerProfile?.role === 'curator' || viewerProfile?.role === 'admin'

  const { data: dataset } = await supabase.from('eval_datasets').select('*').eq('id', id).single()
  if (!dataset) notFound()

  const [{ data: cases }, { data: articles }] = await Promise.all([
    supabase.from('eval_cases').select('*').eq('dataset_id', id).order('created_at', { ascending: true }),
    supabase.from('wiki_articles').select('id, title, slug').eq('status', 'approved').order('title'),
  ])

  // Ember Readiness, Stage 1: only platform admins run evaluations; curators
  // keep authoring this dataset's cases.
  const canRun = viewerProfile?.role === 'admin'

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{dataset.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">
            version {dataset.version} · {dataset.status} · {(cases ?? []).length} case{(cases ?? []).length === 1 ? '' : 's'}
          </p>
          {dataset.description && <p className="mt-1 text-sm text-zinc-600">{dataset.description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {canRun && (
            <Link href={`/evals/runs/new?dataset=${dataset.id}`} className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
              Run evaluation
            </Link>
          )}
          {canAuthor && <DatasetActions datasetId={dataset.id} status={dataset.status} />}
        </div>
      </div>

      <CaseManager
        datasetId={dataset.id}
        datasetStatus={dataset.status}
        cases={cases ?? []}
        articles={articles ?? []}
        canAuthor={canAuthor}
      />
    </div>
  )
}
