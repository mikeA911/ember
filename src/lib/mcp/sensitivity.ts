import 'server-only'
import { readResourceTiers, SENSITIVITY_RANK } from '@/lib/ai/sensitivity'
import type { InformationSensitivity } from '@/types/database'

// The external MCP server's sensitivity ceiling: an approved chatbot app
// (mcp_approved_clients.max_sensitivity) may only be sent content at or
// below its tier. Unclassified content counts as 'internal', the same
// conservative default as src/lib/ai/sensitivity.ts, whose readResourceTiers
// (service-role, tier values only) supplies per-resource tiers.

export function tierOf(value: InformationSensitivity | null | undefined): InformationSensitivity {
  return value ?? 'internal'
}

export function withinCeiling(tier: InformationSensitivity | null | undefined, ceiling: InformationSensitivity): boolean {
  return SENSITIVITY_RANK[tierOf(tier)] <= SENSITIVITY_RANK[ceiling]
}

export const resourceTiers = readResourceTiers
