import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { listUnpublishedArticles } from '@/lib/wiki/queries'
import { listProjectsWithDraftUpdates } from '@/lib/projects/queries'
import { listTrendingUnderReview } from '@/lib/trending/queries'
import { listProjectsWithMissingAuthorities } from '@/lib/governance/queries'

export interface NeedsAttentionItem {
  label: string
  count: number
  href: string
}

// One aggregator over six independently-owned queries -- deliberately not a
// single SQL query, since "needs attention" spans unrelated tables with
// different meanings of "pending." Items with count 0 are still returned
// (not filtered here) so the UI decides how to render an all-clear state.
export async function getNeedsAttention(supabase: SupabaseClient<Database>): Promise<NeedsAttentionItem[]> {
  const [
    { data: submittedDocs },
    unpublishedArticles,
    { data: failedRuns },
    draftProjects,
    trendingUnderReview,
    projectsMissingAuthorities,
    { data: unclassifiedComments },
  ] = await Promise.all([
    supabase.from('documents').select('id').eq('processing_status', 'submitted'),
    listUnpublishedArticles(supabase),
    supabase.from('eval_runs').select('id').eq('status', 'failed'),
    listProjectsWithDraftUpdates(supabase),
    listTrendingUnderReview(supabase),
    listProjectsWithMissingAuthorities(supabase),
    // Naturally scoped by the viewer's own project-membership RLS, same as
    // every other line here -- not a true platform-wide count.
    supabase.from('presentation_slide_comments').select('id').is('classification', null),
  ])

  return [
    { label: 'documents sent for optional admin sign-off', count: (submittedDocs ?? []).length, href: '/upload' },
    { label: 'Wiki articles awaiting approval', count: unpublishedArticles.length, href: '/wiki' },
    { label: 'failed evaluation runs', count: (failedRuns ?? []).length, href: '/evals' },
    { label: 'unpublished project updates', count: draftProjects.length, href: '/projects' },
    { label: 'Trending items under review', count: trendingUnderReview.length, href: '/trending' },
    { label: 'projects with a governance authority needed', count: projectsMissingAuthorities.length, href: '/projects' },
    { label: 'presentation comments awaiting classification', count: (unclassifiedComments ?? []).length, href: '/projects' },
  ]
}
