import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Database, EvidenceResourceType, InformationSensitivity } from '@/types/database'
import type { AIProvider, EmbedInput, GenerateChatInput, GenerateStructuredInput, GenerateTextInput } from './provider'

// Information Sensitivity Classification (Shadow AI blog, 2026-08-28):
// "which AI models may process this content" -- deliberately separate from
// resource_access_policies.classification, which answers "which humans may
// see this resource" (see the migration comment,
// supabase/migrations/20260828170001_information_sensitivity_classification.sql).
export class AISensitivityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AISensitivityError'
  }
}

export const SENSITIVITY_RANK: Record<InformationSensitivity, number> = {
  public: 0,
  internal: 1,
  confidential: 2,
  restricted: 3,
}

const SENSITIVITY_LABEL: Record<InformationSensitivity, string> = {
  public: 'Public',
  internal: 'Internal',
  confidential: 'Confidential',
  restricted: 'Restricted',
}

// Nothing evidence-based retrieved yet (e.g. a turn's first generateChat
// call, before any tool has run) is NOT the same as "internal" -- it's
// genuinely nothing, so it stays 'public' (the floor) rather than tripping
// up a provider that's only approved for public content. Only once a real
// resource has been retrieved does the conservative 'internal' default for
// *unclassified* content apply. Effective sensitivity is the HIGHEST tier
// found across every resource actually used as evidence this turn: one
// Restricted document raises the whole request, per the blog's own rule.
//
// projectSensitivity is a third, distinct input, not a fourth resource type:
// a project-bound conversation embeds that project's name/goal into the
// system prompt on EVERY call (loop.ts's buildProjectPromptAddendum), not
// only once something has been retrieved -- so it can't wait for a
// wikiArticleSlugs/knowledgeSourceIds entry the way the other two can.
// `undefined` means "no project bound this turn" (preserves the
// nothing-retrieved-yet -> 'public' floor exactly as before); a project IS
// bound whenever this is `null` (present, unclassified -> 'internal', same
// conservative default as any other unclassified resource) or a real tier.
// Resource id -> tier, for every id asked about (unclassified -> 'internal').
// Reads resource_access_policies with the service-role client on purpose:
// that table's only RLS policy is can_manage_project, so through anyone
// else's own client every document looked unclassified and read as
// 'internal' -- a Confidential or Restricted document was then sent to a
// provider approved only for Internal whenever a non-manager asked. The
// tier decides which PROVIDER may see content, so it must be the same no
// matter who is asking. Returns tier values only -- never policy details or
// content -- the same "safe metadata via admin client" shape as
// getRestrictedResourceIds in src/lib/projects/evidence-access.ts. Shared
// with the external MCP server (src/lib/mcp/sensitivity.ts).
export async function readResourceTiers(resourceType: EvidenceResourceType, resourceIds: string[]): Promise<Map<string, InformationSensitivity>> {
  const tiers = new Map<string, InformationSensitivity>()
  if (resourceIds.length === 0) return tiers
  const { data, error } = await createAdminClient()
    .from('resource_access_policies')
    .select('resource_id, information_sensitivity')
    .eq('resource_type', resourceType)
    .in('resource_id', resourceIds)
  if (error) throw error
  const classified = new Map((data ?? []).map((row) => [row.resource_id, row.information_sensitivity as InformationSensitivity | null]))
  for (const id of resourceIds) tiers.set(id, classified.get(id) ?? 'internal')
  return tiers
}

// `supabase` is the caller's own client and is used only to resolve wiki
// slugs to ids (a user can only have retrieved an article they can see);
// tiers come from readResourceTiers.
export async function getEffectiveSensitivity(
  supabase: SupabaseClient<Database>,
  retrieved: { wikiArticleSlugs: string[]; knowledgeSourceIds: string[]; projectSensitivity?: InformationSensitivity | null }
): Promise<InformationSensitivity> {
  const resourceIdsByType = new Map<EvidenceResourceType, string[]>()

  if (retrieved.wikiArticleSlugs.length > 0) {
    const { data: articles, error } = await supabase.from('wiki_articles').select('id').in('slug', retrieved.wikiArticleSlugs)
    if (error) throw error
    if (articles && articles.length > 0) resourceIdsByType.set('wiki_article', articles.map((a) => a.id))
  }
  if (retrieved.knowledgeSourceIds.length > 0) {
    resourceIdsByType.set('knowledge_source', retrieved.knowledgeSourceIds)
  }
  if (resourceIdsByType.size === 0 && retrieved.projectSensitivity === undefined) return 'public'

  let highest: InformationSensitivity = 'public'
  if (retrieved.projectSensitivity !== undefined) {
    const projectTier = retrieved.projectSensitivity ?? 'internal'
    if (SENSITIVITY_RANK[projectTier] > SENSITIVITY_RANK[highest]) highest = projectTier
  }
  for (const [resourceType, resourceIds] of resourceIdsByType) {
    // Every retrieved resource counts, whether or not it has a policy row --
    // a row with information_sensitivity=null, or no row at all, is
    // unclassified content and defaults to 'internal', not 'public'.
    for (const tier of (await readResourceTiers(resourceType, resourceIds)).values()) {
      if (SENSITIVITY_RANK[tier] > SENSITIVITY_RANK[highest]) highest = tier
    }
  }
  return highest
}

// No row for this provider = treated as 'internal'-only, not "approved for
// everything" -- the safe default for a provider nobody has explicitly
// reviewed yet.
export async function assertProviderEligible(supabase: SupabaseClient<Database>, providerId: string, sensitivity: InformationSensitivity): Promise<void> {
  const { data, error } = await supabase
    .from('ai_provider_sensitivity_eligibility')
    .select('max_sensitivity')
    .eq('provider_id', providerId)
    .maybeSingle()
  if (error) throw error

  const maxSensitivity: InformationSensitivity = data?.max_sensitivity ?? 'internal'
  if (SENSITIVITY_RANK[maxSensitivity] < SENSITIVITY_RANK[sensitivity]) {
    throw new AISensitivityError(
      `This project contains ${SENSITIVITY_LABEL[sensitivity]} information and cannot be processed by this model under your organization's AI policy. Please select a model approved for ${SENSITIVITY_LABEL[sensitivity]} content.`
    )
  }
}

// --- Shared policy-enforcement service (Phase 2, increment 1) --------------
// docs/design-notes/ai-policy-enforcement-service-and-context-manifest.md.
// getEffectiveSensitivity/assertProviderEligible above stay exactly as they
// are -- loop.ts's per-iteration inline check keeps using them unchanged.
// Everything below is a manifest-shaped, reusable wrapper around the SAME
// two functions (no new DB queries, no behavior change) for callers that
// know their whole manifest up front, one call at a time, rather than
// accumulating it across a tool-iteration loop the way Ember's turn does.

// resourceId is a wiki-article SLUG for 'wiki_article' (matching
// getEffectiveSensitivity's own slug resolution) and a knowledge_sources.id
// for 'knowledge_source'.
export type ContextManifestEntry =
  | { resourceType: 'wiki_article'; resourceId: string }
  | { resourceType: 'knowledge_source'; resourceId: string }

export interface ContextManifest {
  entries: ContextManifestEntry[]
  // Same semantics as getEffectiveSensitivity's own projectSensitivity
  // param: undefined = no project bound, null = bound but unclassified.
  projectSensitivity?: InformationSensitivity | null
}

export interface PolicySubject {
  providerId: string
}

export interface PolicyDecision {
  // Only 'allow'/'block' are reachable today -- Phase 3 adds
  // redact/route/require_approval outcomes to this same shape, not a new one.
  outcome: 'allow' | 'block'
  effectiveSensitivity: InformationSensitivity
  reason?: string
}

function manifestToRetrieved(manifest: ContextManifest): { wikiArticleSlugs: string[]; knowledgeSourceIds: string[]; projectSensitivity?: InformationSensitivity | null } {
  return {
    wikiArticleSlugs: manifest.entries.filter((e) => e.resourceType === 'wiki_article').map((e) => e.resourceId),
    knowledgeSourceIds: manifest.entries.filter((e) => e.resourceType === 'knowledge_source').map((e) => e.resourceId),
    projectSensitivity: manifest.projectSensitivity,
  }
}

// Non-throwing sibling of assertProviderEligible, for callers that want a
// decision record rather than a try/catch -- e.g. withPolicyGate below.
export async function evaluatePolicy(supabase: SupabaseClient<Database>, manifest: ContextManifest, subject: PolicySubject): Promise<PolicyDecision> {
  const effectiveSensitivity = await getEffectiveSensitivity(supabase, manifestToRetrieved(manifest))
  try {
    await assertProviderEligible(supabase, subject.providerId, effectiveSensitivity)
    return { outcome: 'allow', effectiveSensitivity }
  } catch (err) {
    if (err instanceof AISensitivityError) return { outcome: 'block', effectiveSensitivity, reason: err.message }
    throw err
  }
}

// Mirrors src/lib/ai/logging.ts's withLogging shape exactly -- for a
// single-shot caller whose full manifest is known before the call (unlike
// Ember's tool-iteration loop, which must re-evaluate per iteration as
// evidence accumulates and so calls evaluatePolicy directly instead). A
// blocked decision throws AISensitivityError before the wrapped provider
// method ever runs, so the request genuinely never leaves the environment.
export function withPolicyGate(supabase: SupabaseClient<Database>, provider: AIProvider, manifest: ContextManifest, subject: PolicySubject): AIProvider {
  const gate = async () => {
    const decision = await evaluatePolicy(supabase, manifest, subject)
    if (decision.outcome === 'block') throw new AISensitivityError(decision.reason ?? 'Blocked by AI-processing policy.')
  }

  return {
    name: provider.name,
    async generateText(input: GenerateTextInput) {
      await gate()
      return provider.generateText(input)
    },
    async generateStructured<T>(input: GenerateStructuredInput<T>) {
      await gate()
      return provider.generateStructured(input)
    },
    async generateChat(input: GenerateChatInput) {
      await gate()
      return provider.generateChat(input)
    },
    async embed(input: EmbedInput) {
      await gate()
      return provider.embed(input)
    },
  }
}
