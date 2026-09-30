import 'server-only'
import { SENSITIVITY_RANK } from '@/lib/ai/sensitivity'
import { createAdminClient } from '@/lib/supabase/admin'
import type { EvidenceResourceType, InformationSensitivity } from '@/types/database'

// The external MCP server's sensitivity ceiling: an approved chatbot app
// (mcp_approved_clients.max_sensitivity) may only be sent content at or
// below its tier. Unclassified content counts as 'internal', the same
// conservative default as src/lib/ai/sensitivity.ts.
//
// Tier lookup uses the service-role client on purpose, and returns only
// (resource id -> tier) -- never content. resource_access_policies is
// readable under RLS only by the project's manager (can_manage_project), so
// an ordinary member's own client sees no rows and every document would
// silently read as unclassified -> 'internal', letting a Confidential
// document through to an 'internal' ceiling. Same "safe metadata via admin
// client" shape as getRestrictedResourceIds in src/lib/projects/evidence-access.ts.

export function tierOf(value: InformationSensitivity | null | undefined): InformationSensitivity {
  return value ?? 'internal'
}

export function withinCeiling(tier: InformationSensitivity | null | undefined, ceiling: InformationSensitivity): boolean {
  return SENSITIVITY_RANK[tierOf(tier)] <= SENSITIVITY_RANK[ceiling]
}

export async function resourceTiers(resourceType: EvidenceResourceType, resourceIds: string[]): Promise<Map<string, InformationSensitivity>> {
  const tiers = new Map<string, InformationSensitivity>()
  if (resourceIds.length === 0) return tiers
  const { data, error } = await createAdminClient()
    .from('resource_access_policies')
    .select('resource_id, information_sensitivity')
    .eq('resource_type', resourceType)
    .in('resource_id', resourceIds)
  if (error) throw error
  const classified = new Map((data ?? []).map((row) => [row.resource_id, row.information_sensitivity as InformationSensitivity | null]))
  for (const id of resourceIds) tiers.set(id, tierOf(classified.get(id)))
  return tiers
}
