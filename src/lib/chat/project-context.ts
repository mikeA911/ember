import 'server-only'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { InformationSensitivity } from '@/types/database'
import { listKnowledgeBasesForProject } from '@/lib/projects/queries'
import { listArticlesForProject } from '@/lib/wiki/project-links'

// Project-Aware Knowledge and Assistant Context, Stage 2. Backs both the
// chat banner's "knowledge scope" display and the project-bound system
// prompt addendum in loop.ts -- one resolution, two renderings, so they
// can't drift apart.
export interface ProjectContext {
  id: string
  name: string
  goal: string | null
  // The short description under the project title -- lets Ember see what
  // update_project_description would be replacing.
  objective: string | null
  // Read by loop.ts's pre-inference sensitivity check -- name/goal are
  // embedded into the system prompt every turn (buildProjectPromptAddendum),
  // independent of whether any tool ever retrieves anything, so this has to
  // travel with the context rather than being folded in only when evidence
  // is retrieved. See 20260829120001_project_information_sensitivity.sql.
  informationSensitivity: InformationSensitivity | null
  knowledgeBases: { id: string; name: string }[]
  wikiArticles: { id: string; slug: string; title: string }[]
  // A short, clickable prompt Ember offers when opened bound to this
  // project (ChatPanel.tsx) -- curator/owner-set, see updateProjectStarterPrompt.
  starterPrompt: string | null
}

// Same bar as viewing the project page itself (is_project_member, not the
// strict variant) -- this is "what does this project know about," not a
// confidentiality gate on the knowledge itself (RLS on the underlying
// tables is that gate, enforced when the tools actually retrieve content).
export async function getProjectContext(ctx: WorkbenchCallerContext, projectId: string): Promise<ProjectContext | null> {
  const { data: project, error } = await ctx.supabase
    .from('projects')
    .select('id, name, goal, objective, information_sensitivity, starter_prompt')
    .eq('id', projectId)
    .maybeSingle()
  if (error) throw error
  if (!project) return null

  const [knowledgeBases, articleLinks] = await Promise.all([
    listKnowledgeBasesForProject(ctx.supabase, projectId),
    listArticlesForProject(ctx.supabase, projectId),
  ])

  return {
    id: project.id,
    name: project.name,
    goal: project.goal,
    objective: project.objective,
    informationSensitivity: project.information_sensitivity,
    knowledgeBases,
    wikiArticles: articleLinks
      .map((l) => l.article)
      .filter((a): a is NonNullable<typeof a> => a !== null)
      .map((a) => ({ id: a.id, slug: a.slug, title: a.title })),
    starterPrompt: project.starter_prompt,
  }
}

// The banner/system-prompt text form -- kept separate from the data shape
// above so loop.ts's prompt and ChatPanel's banner render identically
// without either owning formatting logic the other has to duplicate.
export function describeProjectKnowledgeScope(context: ProjectContext): string {
  const kbPart = context.knowledgeBases.length
    ? `knowledge base(s) ${context.knowledgeBases.map((k) => k.name).join(', ')}`
    : 'no attached knowledge base'
  const articlePart = context.wikiArticles.length
    ? `Wiki article(s) ${context.wikiArticles.map((a) => a.title).join(', ')}`
    : 'no attached Wiki articles'
  return `${kbPart}; ${articlePart}`
}
