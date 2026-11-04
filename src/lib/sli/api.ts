import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { sliErrorMessage } from './errors'
import type { DecisionSettings, SliContext, TriggerContributor, TriggerDetail, TriggerSummary, TriggerType } from './types'

// Reads for SLI pages, as the signed-in person. The SLI functions aren't in
// the generated Database type, so they are called through an untyped rpc.
type Client = Awaited<ReturnType<typeof createClient>>

export class SliError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SliError'
  }
}

export async function sliRpc<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw new SliError(sliErrorMessage(error))
  return data as T
}

export async function getSliContext(supabase: Client): Promise<SliContext | null> {
  return sliRpc<SliContext | null>(supabase, 'sli_context')
}

export async function listTriggers(supabase: Client, opts: { includeArchived?: boolean; search?: string } = {}): Promise<TriggerSummary[]> {
  return sliRpc<TriggerSummary[]>(supabase, 'sli_list_triggers', { p_include_archived: opts.includeArchived ?? false, p_search: opts.search ?? null })
}

export async function getTrigger(supabase: Client, code: string): Promise<TriggerDetail | null> {
  return sliRpc<TriggerDetail | null>(supabase, 'sli_get_trigger', { p_code: code })
}

export async function listTriggerTypes(supabase: Client): Promise<TriggerType[]> {
  return sliRpc<TriggerType[]>(supabase, 'sli_list_trigger_types')
}

export async function listContributorCandidates(supabase: Client, triggerId: string): Promise<TriggerContributor[]> {
  return sliRpc<TriggerContributor[]>(supabase, 'sli_list_contributor_candidates', { p_trigger: triggerId })
}

export type ResearchFinding = { id: string; type: string; title: string; content: string | null; createdAt: string }
export type ResearchStage = { workstreamId: string; name: string; slug: string; deliverables: string[]; findings: ResearchFinding[] }

// What has been saved to a Trigger's research Project, by Workstream in the
// order the stages began (Research, Concept, Feasibility): the fit check,
// the concept paper, the feasibility assessment, saved files. Read as the
// caller, so Project membership and evidence access rules apply.
export async function listResearchStages(supabase: Client, projectId: string): Promise<ResearchStage[]> {
  const { data: workstreams, error } = await supabase
    .from('project_workstreams')
    .select('id, name, slug, deliverables')
    .eq('project_id', projectId)
    .order('created_at')
  if (error) throw new SliError('The research couldn’t be loaded.')
  const ids = (workstreams ?? []).map((w) => w.id)
  if (ids.length === 0) return []
  const { data: artifacts, error: artifactError } = await supabase
    .from('workstream_artifacts')
    .select('id, workstream_id, artifact_type, title, content, created_at')
    .in('workstream_id', ids)
    .order('created_at', { ascending: false })
    .limit(200)
  if (artifactError) throw new SliError('The research couldn’t be loaded.')
  return (workstreams ?? []).map((w) => ({
    workstreamId: w.id,
    name: w.name,
    slug: w.slug,
    deliverables: Array.isArray(w.deliverables)
      ? (w.deliverables as { label?: unknown }[]).map((d) => (typeof d?.label === 'string' ? d.label : '')).filter(Boolean)
      : [],
    findings: (artifacts ?? [])
      .filter((a) => a.workstream_id === w.id)
      .map((a) => ({ id: a.id, type: a.artifact_type, title: a.title, content: a.content, createdAt: a.created_at })),
  }))
}

// Who decides, the delegation, and what waits for the caller's decision.
// Null for anyone outside the Discovery team.
export async function getDecisionSettings(supabase: Client): Promise<DecisionSettings | null> {
  return sliRpc<DecisionSettings | null>(supabase, 'sli_decision_settings')
}
