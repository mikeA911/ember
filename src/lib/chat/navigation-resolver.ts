import 'server-only'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { getArticleBySlug } from '@/lib/wiki/queries'
import { getAssessmentById } from '@/lib/projects/assessments'
import type { NavigationTargetKind } from './response-envelope'

export interface ResolvedNavigationTarget {
  label: string
  route: string
}

// Resolves a model-proposed {kind, id} into a real, authorized route. The
// model never supplies a URL -- only a target kind and a stable record id;
// this is the only place that turns that into something clickable. Every
// branch reuses an existing lookup exactly as already used elsewhere in the
// app (RLS via ctx.supabase is the access check -- no new authorization
// layer). Returns null for anything missing, inaccessible, or malformed --
// never throws, and never partially reveals a title/id for a target the
// caller can't see.
export async function resolveNavigationTarget(
  ctx: WorkbenchCallerContext,
  target: { kind: NavigationTargetKind; id: string }
): Promise<ResolvedNavigationTarget | null> {
  try {
    switch (target.kind) {
      case 'wiki_article': {
        const article = await getArticleBySlug(ctx.supabase, target.id)
        if (!article) return null
        return { label: article.title, route: `/wiki/${article.slug}` }
      }
      case 'project': {
        const { data: project } = await ctx.supabase.from('projects').select('id, name').eq('id', target.id).maybeSingle()
        if (!project) return null
        return { label: project.name, route: `/projects/${project.id}` }
      }
      case 'workstream': {
        const { data: workstream } = await ctx.supabase
          .from('project_workstreams')
          .select('id, project_id, name')
          .eq('id', target.id)
          .maybeSingle()
        if (!workstream) return null
        return { label: workstream.name, route: `/projects/${workstream.project_id}/workstreams/${workstream.id}` }
      }
      case 'assessment': {
        const assessment = await getAssessmentById(ctx.supabase, target.id)
        if (!assessment) return null
        return { label: assessment.name, route: `/projects/${assessment.project_id}/assessments/${assessment.id}` }
      }
      case 'knowledge_source': {
        // RLS (knowledge_sources_select_staff_or_owner_or_project_member,
        // 20260824180001_project_knowledge_visibility_retrieval_fix.sql) is
        // the actual access check -- a source a user can't see just returns
        // null here, same as every other case.
        const { data: source } = await ctx.supabase.from('knowledge_sources').select('id, title').eq('id', target.id).maybeSingle()
        if (!source) return null
        return { label: source.title, route: `/sources/${source.id}` }
      }
      case 'project_note': {
        // RLS (project_notes_select_visible/project_notes_select_own) is the
        // actual access check -- send_project_note's own author and
        // recipient can always see the note it just created.
        const { data: note } = await ctx.supabase.from('project_notes').select('id, project_id, subject').eq('id', target.id).maybeSingle()
        if (!note) return null
        return { label: note.subject, route: `/projects/${note.project_id}/notes/${note.id}` }
      }
      case 'working_knowledge': {
        // RLS (working_knowledge_items_select_visible/..._select_own, via
        // can_view_working_knowledge_item) is the actual access check -- a
        // notebook the viewer can no longer see (revoked share, removed
        // membership) simply returns null here, same as every other case.
        const { data: item } = await ctx.supabase.from('working_knowledge_items').select('id, project_id, title').eq('id', target.id).maybeSingle()
        if (!item) return null
        return { label: item.title, route: `/projects/${item.project_id}/working-knowledge/${item.id}` }
      }
      case 'solution_requirement': {
        // RLS (solution_requirements_select_member) is the access check.
        const { data: requirement } = await ctx.supabase
          .from('solution_requirements')
          .select('id, project_id, code, title')
          .eq('id', target.id)
          .maybeSingle()
        if (!requirement) return null
        return { label: `${requirement.code} ${requirement.title}`, route: `/projects/${requirement.project_id}/requirements/${requirement.id}` }
      }
    }
  } catch {
    // A query error (malformed id, transient failure) is treated the same
    // as "not found" -- an unresolvable target is omitted, not a turn
    // failure.
    return null
  }
}
