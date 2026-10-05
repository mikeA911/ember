import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getRequirementOptions, nextRequirementCode } from '@/lib/projects/requirements'
import { loadRequirementsPageContext } from '@/lib/projects/requirements-page'
import { RequirementCreateForm } from '@/components/projects/RequirementForms'

export default async function NewRequirementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { project, canCurate } = await loadRequirementsPageContext(supabase, id, user.id)
  if (!project) notFound()
  if (!canCurate) redirect(`/projects/${id}/requirements`)

  const [picker, suggestedCode] = await Promise.all([getRequirementOptions(supabase, id), nextRequirementCode(supabase, id)])

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/projects/${id}/requirements`} className="text-sm underline">
          &larr; Requirements
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New requirement</h1>
        <p className="mt-1 text-sm text-zinc-600">{project.name}. It starts as a draft you can keep editing until it is baselined.</p>
      </div>
      <RequirementCreateForm projectId={id} picker={picker} suggestedCode={suggestedCode} />
    </div>
  )
}
