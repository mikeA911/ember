import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { BuilderIntegrationRiskClassification, Database, ExternalAgentCertificationStatus, ExternalAgentProtocol } from '@/types/database'
import type { ToolSpec } from '@/lib/ai/provider'
import { connectAndListTools } from './client'
import { classifyToolRisk } from './risk'
import { resolveCredentials } from './credentials'
import { computeDelegationRoles, isTestOperatorOnlyTool } from './delegation'

// Every Gateway-dispatched tool name is namespaced gw__<integration-slug>__
// <real-tool-name>, both to avoid collisions between two registered
// integrations exposing a same-named tool, and so loop.ts can recognize a
// Gateway call with a single prefix check (same sentinel-name pattern as
// SEARCH_PROJECT_KNOWLEDGE_TOOL_NAME etc.).
export const GATEWAY_TOOL_PREFIX = 'gw__'

export function makeGatewayToolName(integrationSlug: string, realToolName: string): string {
  return `${GATEWAY_TOOL_PREFIX}${integrationSlug}__${realToolName}`
}

export function parseGatewayToolName(name: string): { integrationSlug: string; realToolName: string } | null {
  if (!name.startsWith(GATEWAY_TOOL_PREFIX)) return null
  const rest = name.slice(GATEWAY_TOOL_PREFIX.length)
  const separatorIndex = rest.indexOf('__')
  if (separatorIndex === -1) return null
  return { integrationSlug: rest.slice(0, separatorIndex), realToolName: rest.slice(separatorIndex + 2) }
}

export interface GatewayToolContext {
  integrationId: string
  integrationSlug: string
  versionId: string
  endpointUrl: string
  protocol: ExternalAgentProtocol
  realToolName: string
  riskClassification: BuilderIntegrationRiskClassification
  credentialsPolicy: Record<string, unknown>
  authMethod: string | null
  spendingLimits: { perOrderMax?: number; dailyMax?: number; currency?: string }
  approvalPolicy: { requiresHumanConfirmation?: boolean; confirmationFields?: string[] }
  // The caller's delegation roles for this Project, computed once at
  // discovery time (see listAvailableTools) -- reused at actual call time
  // (execute.ts) so a fresh, narrowly-scoped token is minted per call
  // without re-querying project_members for the same answer twice.
  callerUserId: string
  projectId: string
  delegationRoles: string[]
}

export interface GatewayDiscoveryResult {
  toolSpecs: ToolSpec[]
  contextByToolName: Map<string, GatewayToolContext>
}

// Certification threshold for Ember discoverability: sandbox_tested or
// higher. Draft/experimental integrations stay reachable for manual testing
// via the registry UI (and by the registering builder/staff directly), but
// not exposed in an ordinary conversation -- deliberately adjustable policy,
// not a hard architectural constraint (see the plan's own design note).
const DISCOVERABLE_STATUSES: ExternalAgentCertificationStatus[] = ['sandbox_tested', 'security_reviewed', 'outlet_accepted', 'production_approved']

export async function listAvailableTools(
  supabase: SupabaseClient<Database>,
  projectId: string,
  caller: { userId: string; platformRole: string }
): Promise<GatewayDiscoveryResult> {
  const { data: availability, error } = await supabase
    .from('builder_integration_project_availability')
    .select('builder_integration_id')
    .eq('project_id', projectId)
  if (error) throw error
  if (!availability || availability.length === 0) return { toolSpecs: [], contextByToolName: new Map() }

  const integrationIds = availability.map((a) => a.builder_integration_id)
  // Excludes 'archived' rather than requiring 'active': Phase A never shipped
  // any action that moves builder_integrations.status out of its 'draft'
  // default (checked directly -- no registry.ts function, no UI control sets
  // it), so requiring 'active' here would make every integration permanently
  // undiscoverable. certification_status (below) is the real fitness-for-use
  // gate; 'archived' is the one status distinction worth respecting today,
  // since a withdrawn integration should never be called regardless of its
  // certification history.
  const { data: integrations, error: integrationsError } = await supabase
    .from('builder_integrations')
    .select('id, slug, protocol, endpoint_url, active_version_id, status')
    .in('id', integrationIds)
    .neq('status', 'archived')
    .not('endpoint_url', 'is', null)
  if (integrationsError) throw integrationsError

  const versionIds = (integrations ?? []).map((i) => i.active_version_id).filter((id): id is string => !!id)
  if (versionIds.length === 0) return { toolSpecs: [], contextByToolName: new Map() }

  const { data: versions, error: versionsError } = await supabase
    .from('builder_integration_versions')
    .select('id, builder_integration_id, risk_classification, credentials_policy, auth_method, spending_limits, approval_policy, certification_status')
    .in('id', versionIds)
    .in('certification_status', DISCOVERABLE_STATUSES)
  if (versionsError) throw versionsError

  // Computed once, reused for every integration below -- the caller's role
  // on THIS Project doesn't vary per integration. Needed to mint a
  // discovery-scoped delegation token (delegated_user_identity integrations
  // require auth on every MCP request, including tools/list, not just
  // gated calls) and to filter test-operator-only tools out of what Ember
  // is even offered.
  const { data: membership } = await supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', caller.userId)
    .eq('status', 'active')
    .maybeSingle()
  const roles = computeDelegationRoles({
    projectRole: membership?.role ?? null,
    platformRole: caller.platformRole,
    isProjectMember: !!membership,
  })

  const toolSpecs: ToolSpec[] = []
  const contextByToolName = new Map<string, GatewayToolContext>()

  for (const version of versions ?? []) {
    const integration = (integrations ?? []).find((i) => i.id === version.builder_integration_id)
    if (!integration || !integration.endpoint_url) continue

    let discovered: Awaited<ReturnType<typeof connectAndListTools>>
    try {
      // Discovery never calls a specific tool, so the delegation token's own
      // `tools` claim is intentionally empty here -- a real, narrowly-scoped
      // token (naming the one tool being invoked) is minted fresh at actual
      // call time instead (src/lib/mcp-gateway/execute.ts), never reused
      // from this one.
      const auth = await resolveCredentials(version.credentials_policy, version.auth_method, {
        userId: caller.userId,
        projectId,
        tools: [],
        roles,
      })
      discovered = await connectAndListTools(integration.endpoint_url, auth)
    } catch {
      // An unreachable/misbehaving integration must never break Ember's
      // whole turn -- skip it silently from this turn's tool list (same
      // "degrade, don't crash the conversation" posture as every other
      // tool-call error path in loop.ts).
      continue
    }

    for (const tool of discovered) {
      // Excluded from what Ember can even see/call, not just from what the
      // remote server would separately reject -- see delegation.ts.
      if (isTestOperatorOnlyTool(tool.name) && !roles.includes('test_operator')) continue

      const gatewayName = makeGatewayToolName(integration.slug, tool.name)
      toolSpecs.push({ name: gatewayName, description: tool.description ?? tool.name, parameters: tool.inputSchema ?? { type: 'object' } })
      contextByToolName.set(gatewayName, {
        integrationId: integration.id,
        integrationSlug: integration.slug,
        versionId: version.id,
        endpointUrl: integration.endpoint_url,
        protocol: integration.protocol,
        realToolName: tool.name,
        riskClassification: classifyToolRisk(version.risk_classification, tool.name),
        credentialsPolicy: version.credentials_policy,
        authMethod: version.auth_method,
        spendingLimits: version.spending_limits,
        approvalPolicy: version.approval_policy,
        callerUserId: caller.userId,
        projectId,
        delegationRoles: roles,
      })
    }
  }

  return { toolSpecs, contextByToolName }
}
