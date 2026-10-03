import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SectionHero } from '@/components/SectionHero'
import { projectStatusLabel, projectStatusStyle } from '@/lib/projects/status-labels'

const TYPE_LABELS: Record<string, string> = {
  learning: 'Learning',
  experiment: 'AI Experiment',
  consulting: 'Client / Consulting',
  transformation: 'Internal Transformation',
  knowledge: 'Knowledge',
}

// "My Projects" declutter (2026-09-04, Mike) -- grouped by
// portfolio_category instead of one flat grid, using Mike's own "Suggested
// categorization of existing Projects" bucket names. See
// 20260904130001_project_portfolio_category_v2.sql for the mapping and why
// this is a separate axis from project_type, not a relabeling of it.
const CATEGORY_SECTIONS: { key: string; title: string; description: string }[] = [
  { key: 'sandz', title: 'Sandz', description: 'The Sandz–Zadara pilot and its supporting Projects.' },
  { key: 'foundation', title: 'Foundation', description: 'The product itself, and general AI R&D not tied to one client.' },
  { key: 'showcases', title: 'Showcases', description: 'Public example/case-study Projects.' },
  { key: 'builder_lab', title: 'Builder Lab', description: 'Agent, connector, MCP, and deployment Projects.' },
  { key: 'templates', title: 'Templates', description: 'Generic department and use-case starting Projects.' },
  { key: 'legacy_test', title: 'Legacy/Test', description: 'Duplicate legacy-system exercises, regression data, and superseded experiments.' },
  { key: 'archived', title: 'Archived', description: 'Completed work no longer needed for active navigation.' },
  { key: 'other', title: 'Others', description: 'Not yet categorized.' },
]


const ROLE_LABELS: Record<string, string> = {
  owner: 'Owner',
  curator: 'Curator',
  consultant: 'Consultant',
  viewer: 'Viewer',
}

export default async function ProjectsPage() {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()

  let viewerRole: string | undefined
  let membershipByProject = new Map<string, string>()
  let projects: {
    id: string
    name: string
    project_type: string
    objective: string | null
    status: string
    visibility: string
    published_at: string | null
    owner_id: string | null
    portfolio_category: string
  }[] = []
  if (user) {
    const [{ data: viewerProfile }, { data: memberships }] = await Promise.all([
      supabase.from('profiles').select('role').eq('id', user.id).single(),
      supabase.from('project_members').select('project_id, role').eq('user_id', user.id).eq('status', 'active'),
    ])
    viewerRole = viewerProfile?.role
    membershipByProject = new Map((memberships ?? []).map((m) => [m.project_id, m.role]))

    // My Projects means the viewer's own active memberships -- for
    // everyone, including admins/curators. is_project_member's RLS bypass
    // for platform admins would otherwise return every project here; the
    // Organization Portfolio (/projects/portfolio) is the deliberate,
    // safe-metadata-only place for staff to see across memberships.
    const projectIds = [...membershipByProject.keys()]
    if (projectIds.length > 0) {
      const { data } = await supabase
        .from('projects')
        .select('id, name, project_type, objective, status, visibility, published_at, owner_id, portfolio_category')
        .in('id', projectIds)
        .order('created_at', { ascending: false })
      projects = data ?? []
    }
  }

  // "Draft" means "not yet approved" -- only meaningful to someone who
  // either created it (they know it's a work in progress) or could approve
  // it (they need to see what's pending). A plain viewer/consultant on a
  // draft project sees no status badge at all rather than "draft".
  function canSeeDraftBadge(p: { id: string; owner_id: string | null }): boolean {
    if (!user) return false
    if (p.owner_id === user.id) return true
    if (viewerRole === 'admin' || viewerRole === 'curator') return true
    const projectRole = membershipByProject.get(p.id)
    return projectRole === 'owner' || projectRole === 'curator'
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHero image="/images/sections/graph-workflow.png" height="compact" priority />

      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">My Projects</h1>
          {(viewerRole === 'admin' || viewerRole === 'curator') && (
            <Link href="/projects/portfolio" className="text-sm underline">
              View Organization Portfolio &rarr;
            </Link>
          )}
        </div>
        <Link href="/projects/new" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          New project
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className="text-sm text-zinc-500">
          No projects yet, or none you&rsquo;re a member of. Create a project to organize AI engineering work --
          knowledge, evaluations, and results that belong together.
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {CATEGORY_SECTIONS.map((section) => {
            const sectionProjects = projects.filter((p) => (p.portfolio_category || 'other') === section.key)
            if (sectionProjects.length === 0) return null
            return (
              <section key={section.key} className="flex flex-col gap-3">
                <div>
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
                    {section.title} <span className="font-normal normal-case text-zinc-400">({sectionProjects.length})</span>
                  </h2>
                  <p className="text-xs text-zinc-400">{section.description}</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {sectionProjects.map((p) => (
                    <Link key={p.id} href={`/projects/${p.id}`} className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-medium">{p.name}</h3>
                        <div className="flex shrink-0 items-center gap-1.5">
                          {membershipByProject.get(p.id) && (
                            <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-600">
                              {ROLE_LABELS[membershipByProject.get(p.id)!] ?? membershipByProject.get(p.id)}
                            </span>
                          )}
                          {p.visibility === 'public' && p.published_at && (
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">Published</span>
                          )}
                          {(p.status !== 'draft' || canSeeDraftBadge(p)) && (
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${projectStatusStyle(p.status)}`}>{projectStatusLabel(p.status)}</span>
                          )}
                        </div>
                      </div>
                      <p className="mt-1 text-xs text-zinc-500">{TYPE_LABELS[p.project_type] ?? p.project_type}</p>
                      {p.objective && <p className="mt-1 text-sm text-zinc-600">{p.objective}</p>}
                    </Link>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
