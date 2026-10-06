import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listBaselineCandidates } from '@/lib/projects/baselines'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { BaselineCreateForm } from '@/components/projects/BaselineForms'

export default async function NewBaselinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project) notFound()
  if (!canCurate) redirect(`/projects/${id}/requirements/baselines`)

  const candidates = await listBaselineCandidates(supabase, id)

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements/baselines`} className="text-sm underline">
          &larr; Baselines
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New baseline</h1>
        <p className="mt-1 text-sm text-zinc-600">
          {project.name}. A baseline is the set of requirements a decision will be made against. It starts as a draft; activating it freezes it and its
          requirements.
        </p>
      </div>
      <BaselineCreateForm projectId={id} candidates={candidates} />
    </div>
  )
}
