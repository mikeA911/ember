import type { ProjectAwaitingApprovalRow } from '@/lib/workbench/project-approval'
import { ProjectApprovalDecision } from './ProjectApprovalDecision'

const TYPE_LABELS: Record<string, string> = {
  learning: 'Learning',
  experiment: 'AI Experiment',
  consulting: 'Client / Consulting',
  transformation: 'Internal Transformation',
  knowledge: 'Knowledge',
}

// Dashboard queue for a platform admin or curator -- in Builder mode a
// curator only gets their own builders' projects (listProjectsAwaitingApproval). Deciders aren't members of a pending
// project, so everything they need to decide is shown here.
export function ProjectsAwaitingApprovalWidget({ projects }: { projects: ProjectAwaitingApprovalRow[] }) {
  if (projects.length === 0) return null
  return (
    <div className="rounded border border-amber-300 bg-white">
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-3">
        <h2 className="font-medium text-amber-900">New projects awaiting your approval ({projects.length})</h2>
        <p className="mt-0.5 text-xs text-amber-800">Only the creator can see these until you approve them.</p>
      </div>
      <ul className="divide-y divide-zinc-100">
        {projects.map((p) => (
          <li key={p.id} className="flex flex-col gap-2 px-4 py-3">
            <div>
              <div className="font-medium">{p.name}</div>
              <p className="mt-0.5 text-xs text-zinc-500">
                {TYPE_LABELS[p.projectType] ?? p.projectType} · created by {p.creatorEmail ?? 'unknown'} ·{' '}
                {new Date(p.createdAt).toLocaleDateString()}
                {p.pendingMemberCount > 0 && ` · ${p.pendingMemberCount} team member${p.pendingMemberCount === 1 ? '' : 's'} to add on approval`}
              </p>
              {p.objective && <p className="mt-1 text-sm text-zinc-700">{p.objective}</p>}
            </div>
            <ProjectApprovalDecision projectId={p.id} projectName={p.name} />
          </li>
        ))}
      </ul>
    </div>
  )
}
