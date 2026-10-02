import { createClient } from '@/lib/supabase/server'
import { hasRequiredRole } from '@/lib/auth'
import { ProjectWizard } from '@/components/projects/ProjectWizard'
import { listActiveKnowledgeBases } from '@/lib/knowledge-bases'
import { listSelectableUsers } from '@/lib/projects/selectable-users'

export default async function NewProjectPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { data: profile } = user ? await supabase.from('profiles').select('role').eq('id', user.id).single() : { data: null }
  // Below curator, a new project waits for approval (project-approval.ts).
  const needsApproval = !profile || !hasRequiredRole(profile.role, 'curator')

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
        needsApproval={needsApproval}
      />
    </div>
  )
}
