import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { CreateWorkstreamForm } from '@/components/projects/CreateWorkstreamForm'

export default async function NewWorkstreamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase.from('projects').select('id, name, status').eq('id', id).single()
  if (!project) notFound()

  return (
    <div className="flex max-w-lg flex-col gap-6">
      <div>
        <Link href={`/projects/${id}`} className="text-sm underline">
          &larr; {project.name}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">New Workstream</h1>
        {project.status === 'live' && (
          <p className="mt-1 text-sm text-zinc-600">
            {project.name} is Live -- add each bug fix or new feature as its own workstream here. The project stays Live while you work on it.
          </p>
        )}
      </div>
      <CreateWorkstreamForm projectId={id} defaultLifecycleStage={project.status === 'live' ? 'management_maintenance' : ''} />
    </div>
  )
}
