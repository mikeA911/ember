import { createClient } from '@/lib/supabase/server'
import { ProjectWizard } from '@/components/projects/ProjectWizard'
import { listActiveKnowledgeBases } from '@/lib/knowledge-bases'
import { listSelectableUsers } from '@/lib/projects/selectable-users'

export default async function NewProjectPage() {
  const supabase = await createClient()

  const [knowledgeBases, { data: evalDatasets }, selectableUsers] = await Promise.all([
    listActiveKnowledgeBases(supabase),
    supabase.from('eval_datasets').select('id, name').eq('status', 'active').order('name'),
    listSelectableUsers(),
  ])

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">New project</h1>
      <ProjectWizard
        knowledgeBases={knowledgeBases.map((kb) => ({ id: kb.id, label: kb.name }))}
        evalDatasets={(evalDatasets ?? []).map((d) => ({ id: d.id, label: d.name }))}
        selectableUsers={selectableUsers}
      />
    </div>
  )
}
