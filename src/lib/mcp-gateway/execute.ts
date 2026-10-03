import 'server-only'
import { createAdminClient } from '@/lib/supabase/admin'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import type { BuilderIntegrationRiskClassification } from '@/types/database'
import { connectAndCallTool } from './client'
import { resolveCredentials, type DelegationRequestContext } from './credentials'
import { confirmApproval, confirmCancellation } from './orderlunch-confirmation'
import { checkSpendingLimit, extractCorrelatedAmount } from './spending'
import { requiresConfirmation } from './risk'
import { computeDelegationRoles, isTestOperatorOnlyTool } from './delegation'
import type { GatewayToolContext } from './discovery'

// OrderLunch MCP Showcase's trusted confirmation boundary needs two pseudo
// tool names that never reach the remote server as real MCP tool calls --
// see runOrderLunchRequestApproval/runOrderLunchCancelOrder below. Chosen so
// GatewayInvocationCard's existing "Confirm: {name with _ -> space}" header
// still reads cleanly with zero changes to that component.
const ORDERLUNCH_CONFIRM_APPROVAL_TOOL = 'confirm_order_placement'
const ORDERLUNCH_CONFIRM_CANCELLATION_TOOL = 'confirm_order_cancellation'

// The first code-level "propose, then confirm, then execute" gate in this
// codebase -- every other tool today only has a prompt-level confirmation
// instruction (see src/lib/chat/project-note-tool.ts's own comment). A
// read-only Gateway tool call still writes one audit row, but self-executes
// in the same turn (matches how every other read tool already behaves --
// no reason to add friction to a menu lookup). A gated call never touches
// the external server until a human explicitly confirms via
// executeConfirmedInvocation, called from
// src/app/actions/gateway-invocations.ts.

export interface PendingGatewayInvocation {
  invocationId: string
  toolName: string
  integrationSlug: string
  riskClassification: BuilderIntegrationRiskClassification
  input: Record<string, unknown>
  confirmationFields?: string[]
}

export interface GatewayCallOutcome {
  resultForModel: unknown
  pending?: PendingGatewayInvocation
}

export async function runGatewayToolCall(
  ctx: WorkbenchCallerContext,
  params: { projectId: string; conversationId: string; toolContext: GatewayToolContext; input: Record<string, unknown> }
): Promise<GatewayCallOutcome> {
  const { projectId, conversationId, toolContext, input } = params
  const admin = createAdminClient()

  // OrderLunch's own trusted confirmation boundary -- neither of these tools
  // fits the ordinary auto-execute-vs-gate split, so they're special-cased
  // before it, not folded into the generic risk-classification path below.
  if (toolContext.realToolName === 'request_order_approval') {
    return runOrderLunchRequestApproval(ctx, admin, params)
  }
  if (toolContext.realToolName === 'cancel_order') {
    return runOrderLunchCancelOrder(ctx, admin, params)
  }

  // App-side gate, not just discovery-time filtering -- discovery already
  // excludes a test-operator-only tool from what's offered to a non-operator
  // (src/lib/mcp-gateway/discovery.ts), but a role can change between
  // discovery and this call within the same turn; fail closed rather than
  // trust a snapshot.
  if (isTestOperatorOnlyTool(toolContext.realToolName) && !toolContext.delegationRoles.includes('test_operator')) {
    throw new Error('This tool requires the test_operator role, which this caller does not have')
  }

  if (!requiresConfirmation(toolContext.riskClassification)) {
    let output: unknown
    let errorMessage: string | null = null
    try {
      // Narrowly scoped to exactly the one tool being called -- least
      // privilege, and avoids needing to re-derive the integration's full
      // tool list at call time (see credentials.ts/delegation.ts).
      const auth = await resolveCredentials(toolContext.credentialsPolicy, toolContext.authMethod, {
        userId: toolContext.callerUserId,
        projectId: toolContext.projectId,
        tools: [toolContext.realToolName],
        roles: toolContext.delegationRoles,
      })
      output = await connectAndCallTool(toolContext.endpointUrl, auth, toolContext.realToolName, input)
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err)
    }
    const { error: insertError } = await admin.from('builder_integration_invocations').insert({
      builder_integration_id: toolContext.integrationId,
      builder_integration_version_id: toolContext.versionId,
      project_id: projectId,
      conversation_id: conversationId,
      actor_id: ctx.user.id,
      tool_name: toolContext.realToolName,
      risk_classification: toolContext.riskClassification,
      input,
      output: errorMessage ? null : (output as Record<string, unknown>),
      status: errorMessage ? 'failed' : 'executed',
      error: errorMessage,
      correlated_amount: errorMessage ? null : extractCorrelatedAmount(output),
      executed_at: new Date().toISOString(),
    })
    if (insertError) throw insertError
    if (errorMessage) throw new Error(errorMessage)
    return { resultForModel: output }
  }

  const spendingCheck = await checkSpendingLimit(ctx.supabase, {
    integrationId: toolContext.integrationId,
    projectId,
    spendingLimits: toolContext.spendingLimits,
    toolInput: input,
  })
  if (!spendingCheck.ok) {
    return { resultForModel: { status: 'rejected', reason: spendingCheck.reason } }
  }

  const { data: proposed, error: proposeError } = await admin
    .from('builder_integration_invocations')
    .insert({
      builder_integration_id: toolContext.integrationId,
      builder_integration_version_id: toolContext.versionId,
      project_id: projectId,
      conversation_id: conversationId,
      actor_id: ctx.user.id,
      tool_name: toolContext.realToolName,
      risk_classification: toolContext.riskClassification,
      input,
      status: 'proposed',
      correlated_amount: spendingCheck.correlatedAmount,
    })
    .select('id')
    .single()
  if (proposeError || !proposed) throw proposeError ?? new Error('Failed to record proposed Gateway action')

  return {
    resultForModel: {
      status: 'awaiting_human_confirmation',
      invocationId: proposed.id,
      message:
        'This action requires explicit human confirmation before it executes. Tell the user what you are about to do and that a confirmation card has appeared for them to approve or cancel -- do not claim the action has already happened.',
    },
    pending: {
      invocationId: proposed.id,
      toolName: toolContext.realToolName,
      integrationSlug: toolContext.integrationSlug,
      riskClassification: toolContext.riskClassification,
      input,
      confirmationFields: toolContext.approvalPolicy.confirmationFields,
    },
  }
}

// Correlates request_order_approval's quoteId back to the matching
// prepare_quotation call earlier in the same conversation, purely to enrich
// the confirmation card with the itemized basket -- request_order_approval's
// own output already carries outlet/total/fulfilment/payment terms/expiry,
// but not line items. Best-effort: returns undefined (card just omits the
// itemized list) rather than failing the whole confirmation if no match is
// found, same "human reviewing the card is the real backstop" posture as
// spending.ts's own correlation logic.
async function findCorrelatedQuoteItems(
  supabase: WorkbenchCallerContext['supabase'],
  conversationId: string,
  integrationId: string,
  quoteId: unknown
): Promise<unknown[] | undefined> {
  if (typeof quoteId !== 'string') return undefined
  const { data } = await supabase
    .from('builder_integration_invocations')
    .select('output')
    .eq('conversation_id', conversationId)
    .eq('builder_integration_id', integrationId)
    .eq('tool_name', 'prepare_quotation')
    .eq('status', 'executed')
    .order('created_at', { ascending: false })
    .limit(20)
  const match = (data ?? []).find((row) => (row.output as { id?: string } | null)?.id === quoteId)
  return (match?.output as { items?: unknown[] } | undefined)?.items
}

// request_order_approval is safe to call immediately -- per the remote
// server's own tool description, it only creates a pending, inert approval
// object; the actual consequential step (place_order) never happens until
// the separate trusted REST confirmation below succeeds. Auto-executing it
// here (rather than routing it through the generic propose/confirm gate
// like every other consequential-classified tool) is what makes its real
// output -- which the confirmation card needs -- available at all: a
// generically gated call never touches the remote server until *after* a
// human confirms, which would be too late to show real quote details on
// the very card that's asking for that confirmation.
async function runOrderLunchRequestApproval(
  ctx: WorkbenchCallerContext,
  admin: ReturnType<typeof createAdminClient>,
  params: { projectId: string; conversationId: string; toolContext: GatewayToolContext; input: Record<string, unknown> }
): Promise<GatewayCallOutcome> {
  const { projectId, conversationId, toolContext, input } = params

  const auth = await resolveCredentials(toolContext.credentialsPolicy, toolContext.authMethod, {
    userId: toolContext.callerUserId,
    projectId: toolContext.projectId,
    tools: [toolContext.realToolName],
    roles: toolContext.delegationRoles,
  })
  const output = await connectAndCallTool(toolContext.endpointUrl, auth, toolContext.realToolName, input)
  const approval = output as { approvalId?: string; status?: string }

  const { error: insertError } = await admin.from('builder_integration_invocations').insert({
    builder_integration_id: toolContext.integrationId,
    builder_integration_version_id: toolContext.versionId,
    project_id: projectId,
    conversation_id: conversationId,
    actor_id: ctx.user.id,
    tool_name: toolContext.realToolName,
    risk_classification: toolContext.riskClassification,
    input,
    output: output as Record<string, unknown>,
    status: 'executed',
    correlated_amount: extractCorrelatedAmount(output),
    executed_at: new Date().toISOString(),
  })
  if (insertError) throw insertError

  if (approval.status !== 'pending_human_confirmation' || !approval.approvalId) {
    // Not the shape this integration is expected to return -- surface the
    // raw result rather than silently inventing a confirmation card for
    // something that isn't actually one.
    return { resultForModel: output }
  }

  const items = await findCorrelatedQuoteItems(ctx.supabase, conversationId, toolContext.integrationId, input.quoteId)
  const cardInput: Record<string, unknown> = { ...approval, items }

  const { data: pendingRow, error: pendingError } = await admin
    .from('builder_integration_invocations')
    .insert({
      builder_integration_id: toolContext.integrationId,
      builder_integration_version_id: toolContext.versionId,
      project_id: projectId,
      conversation_id: conversationId,
      actor_id: ctx.user.id,
      tool_name: ORDERLUNCH_CONFIRM_APPROVAL_TOOL,
      risk_classification: toolContext.riskClassification,
      input: cardInput,
      status: 'proposed',
      correlated_amount: extractCorrelatedAmount(approval),
    })
    .select('id')
    .single()
  if (pendingError || !pendingRow) throw pendingError ?? new Error('Failed to record the pending order confirmation')

  return {
    resultForModel: {
      status: 'awaiting_human_confirmation',
      invocationId: pendingRow.id,
      message:
        'A trusted confirmation card is now showing the real quote (outlet, items, total in PHP, pay-upon-delivery terms, expiry) for the user to confirm or cancel. Do not claim the order has been placed -- it has not.',
    },
    pending: {
      invocationId: pendingRow.id,
      toolName: ORDERLUNCH_CONFIRM_APPROVAL_TOOL,
      integrationSlug: toolContext.integrationSlug,
      riskClassification: toolContext.riskClassification,
      input: cardInput,
      confirmationFields: toolContext.approvalPolicy.confirmationFields,
    },
  }
}

// cancel_order's own schema requires a confirmationId that only exists once
// the trusted REST cancellation-confirmation call below creates one -- the
// model can never legitimately supply it (there is no MCP tool that mints
// one), so any model-supplied confirmationId is ignored, never trusted, and
// this always runs the REST call itself rather than forwarding whatever the
// model passed in `input`.
async function runOrderLunchCancelOrder(
  ctx: WorkbenchCallerContext,
  admin: ReturnType<typeof createAdminClient>,
  params: { projectId: string; conversationId: string; toolContext: GatewayToolContext; input: Record<string, unknown> }
): Promise<GatewayCallOutcome> {
  const { projectId, conversationId, toolContext, input } = params
  const orderId = typeof input.orderId === 'string' ? input.orderId : null
  if (!orderId) throw new Error('cancel_order requires an orderId')

  const delegation: DelegationRequestContext = {
    userId: toolContext.callerUserId,
    projectId: toolContext.projectId,
    tools: ['cancel_order'],
    roles: toolContext.delegationRoles,
  }
  const { confirmationId } = await confirmCancellation(toolContext.endpointUrl, toolContext.credentialsPolicy, toolContext.authMethod, delegation, orderId)

  const cardInput = { orderId, confirmationId }
  const { data: pendingRow, error: pendingError } = await admin
    .from('builder_integration_invocations')
    .insert({
      builder_integration_id: toolContext.integrationId,
      builder_integration_version_id: toolContext.versionId,
      project_id: projectId,
      conversation_id: conversationId,
      actor_id: ctx.user.id,
      tool_name: ORDERLUNCH_CONFIRM_CANCELLATION_TOOL,
      risk_classification: toolContext.riskClassification,
      input: cardInput,
      status: 'proposed',
    })
    .select('id')
    .single()
  if (pendingError || !pendingRow) throw pendingError ?? new Error('Failed to record the pending cancellation confirmation')

  return {
    resultForModel: {
      status: 'awaiting_human_confirmation',
      invocationId: pendingRow.id,
      message:
        'A trusted cancellation-confirmation card is now showing for the user to confirm or back out. Do not claim the order has been cancelled -- it has not.',
    },
    pending: {
      invocationId: pendingRow.id,
      toolName: ORDERLUNCH_CONFIRM_CANCELLATION_TOOL,
      integrationSlug: toolContext.integrationSlug,
      riskClassification: toolContext.riskClassification,
      input: cardInput,
    },
  }
}

interface ExecuteResult {
  output?: unknown
  error?: string
}

// The tool-result message persisted for the ORIGINAL gated call (see
// runGatewayToolCall/runOrderLunchRequestApproval/runOrderLunchCancelOrder
// above) is frozen forever at "awaiting_human_confirmation" -- appendMessage
// writes it once, when the model first proposed the call, and nothing ever
// touches it again. On every later turn, the model reloads this exact
// conversation history as its own context and sees its own tool call still
// "pending," with no way to know a human already confirmed/cancelled it out
// of band via GatewayInvocationCard -- so it dutifully keeps telling the
// user to go confirm a card that was already confirmed, sometimes proposing
// a brand-new duplicate invocation instead. Caught live 2026-09-04: a real
// user stuck in exactly this loop trying to browse the OrderLunch menu.
//
// Fix: once a confirmation is resolved (executed, failed, or cancelled),
// overwrite that same persisted tool-result row with the real outcome, so
// the next turn's reloaded history shows what actually happened instead of
// the stale "still waiting" placeholder. Located by conversation_id + role
// 'tool' + the invocationId embedded in the original JSON content (chat_
// messages.content is plain text, not JSONB, so this is a substring match,
// not a JSON query) -- best-effort: a miss (e.g. the row was somehow never
// written, or a future refactor changes the JSON shape) silently updates
// zero rows rather than failing the confirm/cancel action itself, same
// "never let bookkeeping block the real action" posture as this file's
// other admin-client follow-up writes.
async function syncToolMessageForInvocation(
  admin: ReturnType<typeof createAdminClient>,
  conversationId: string | null,
  invocationId: string,
  resolvedContent: Record<string, unknown>
): Promise<void> {
  if (!conversationId) return
  await admin
    .from('chat_messages')
    .update({ content: JSON.stringify(resolvedContent) })
    .eq('conversation_id', conversationId)
    .eq('role', 'tool')
    .ilike('content', `%"invocationId":"${invocationId}"%`)
}

async function requireProjectAccess(ctx: WorkbenchCallerContext, projectId: string): Promise<void> {
  if (ctx.profile.role === 'curator' || ctx.profile.role === 'admin') return
  const { data: membership } = await ctx.supabase
    .from('project_members')
    .select('id')
    .eq('project_id', projectId)
    .eq('user_id', ctx.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!membership) throw new Error('Not authorized to act on this Gateway invocation')
}

export async function executeConfirmedInvocation(ctx: WorkbenchCallerContext, invocationId: string): Promise<ExecuteResult> {
  const admin = createAdminClient()
  const { data: invocation, error } = await admin.from('builder_integration_invocations').select('*').eq('id', invocationId).single()
  if (error || !invocation) throw error ?? new Error('Gateway invocation not found')
  if (invocation.status !== 'proposed') throw new Error(`This action is no longer pending confirmation (status: ${invocation.status})`)

  await requireProjectAccess(ctx, invocation.project_id)

  // Computed once, reused below for both the test-operator gate and the
  // delegation token minted at actual call time.
  const { data: confirmerMembership } = await ctx.supabase
    .from('project_members')
    .select('role')
    .eq('project_id', invocation.project_id)
    .eq('user_id', ctx.user.id)
    .eq('status', 'active')
    .maybeSingle()
  const confirmerRoles = computeDelegationRoles({
    projectRole: confirmerMembership?.role ?? null,
    platformRole: ctx.profile.role,
    isProjectMember: !!confirmerMembership,
  })
  if (isTestOperatorOnlyTool(invocation.tool_name) && !confirmerRoles.includes('test_operator')) {
    throw new Error('This tool requires the test_operator role, which this caller does not have')
  }

  const { data: integration } = await admin.from('builder_integrations').select('endpoint_url').eq('id', invocation.builder_integration_id).single()
  const { data: version } = await admin
    .from('builder_integration_versions')
    .select('credentials_policy, auth_method, spending_limits')
    .eq('id', invocation.builder_integration_version_id)
    .single()
  if (!integration?.endpoint_url || !version) throw new Error('This integration is no longer available')

  // Defends against a race between propose-time and confirm-time (another
  // order placed in between) -- re-checked, not just trusted from earlier.
  const spendingCheck = await checkSpendingLimit(admin, {
    integrationId: invocation.builder_integration_id,
    projectId: invocation.project_id,
    spendingLimits: version.spending_limits,
    toolInput: invocation.input,
  })
  if (!spendingCheck.ok) {
    await admin
      .from('builder_integration_invocations')
      .update({ status: 'failed', error: spendingCheck.reason, confirmed_at: new Date().toISOString(), confirmed_by: ctx.user.id })
      .eq('id', invocationId)
    await syncToolMessageForInvocation(admin, invocation.conversation_id, invocationId, {
      status: 'failed',
      error: spendingCheck.reason,
      message: 'The human declined or this action failed at confirmation time -- it did not happen. Do not retry it silently; explain the failure to the user.',
    })
    return { error: spendingCheck.reason }
  }

  try {
    const delegation: DelegationRequestContext = { userId: ctx.user.id, projectId: invocation.project_id, tools: [invocation.tool_name], roles: confirmerRoles }
    let output: unknown

    if (invocation.tool_name === ORDERLUNCH_CONFIRM_APPROVAL_TOOL) {
      // Confirming here means BOTH the trusted REST confirmation AND the
      // actual place_order call -- treated as one atomic user-facing
      // "confirm" action per the spec ("Only the trusted server-side KB
      // Sandbox action may call the confirmation endpoint... After
      // confirmation, Ember may call place_order with a server-generated
      // idempotency key"). The idempotency key is generated here, server-
      // side, never from anything the model or a prior stored value
      // supplied.
      const { approvalId, quoteHash } = invocation.input as { approvalId?: string; quoteHash?: string }
      if (!approvalId) throw new Error('This confirmation is missing its approvalId')
      if (!quoteHash) throw new Error('This confirmation is missing its quoteHash')
      await confirmApproval(
        integration.endpoint_url,
        version.credentials_policy,
        version.auth_method,
        { ...delegation, tools: ['request_order_approval'] },
        approvalId,
        quoteHash
      )
      const placeAuth = await resolveCredentials(version.credentials_policy, version.auth_method, { ...delegation, tools: ['place_order'] })
      output = await connectAndCallTool(integration.endpoint_url, placeAuth, 'place_order', { approvalId, idempotencyKey: crypto.randomUUID() })
    } else if (invocation.tool_name === ORDERLUNCH_CONFIRM_CANCELLATION_TOOL) {
      const { orderId, confirmationId } = invocation.input as { orderId?: string; confirmationId?: string }
      if (!orderId || !confirmationId) throw new Error('This confirmation is missing its orderId/confirmationId')
      const cancelAuth = await resolveCredentials(version.credentials_policy, version.auth_method, { ...delegation, tools: ['cancel_order'] })
      output = await connectAndCallTool(integration.endpoint_url, cancelAuth, 'cancel_order', { orderId, confirmationId })
    } else {
      const auth = await resolveCredentials(version.credentials_policy, version.auth_method, delegation)
      output = await connectAndCallTool(integration.endpoint_url, auth, invocation.tool_name, invocation.input)
    }

    await admin
      .from('builder_integration_invocations')
      .update({
        status: 'executed',
        output: output as Record<string, unknown>,
        correlated_amount: extractCorrelatedAmount(output) ?? invocation.correlated_amount,
        confirmed_at: new Date().toISOString(),
        confirmed_by: ctx.user.id,
        executed_at: new Date().toISOString(),
      })
      .eq('id', invocationId)
    await syncToolMessageForInvocation(admin, invocation.conversation_id, invocationId, {
      status: 'confirmed_and_executed',
      result: output,
      message: 'The human confirmed this action and it has now actually happened -- use this real result, do not ask for confirmation again.',
    })
    return { output }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    await admin
      .from('builder_integration_invocations')
      .update({ status: 'failed', error: message, confirmed_at: new Date().toISOString(), confirmed_by: ctx.user.id })
      .eq('id', invocationId)
    await syncToolMessageForInvocation(admin, invocation.conversation_id, invocationId, {
      status: 'failed',
      error: message,
      message: 'The human confirmed this action, but it failed when actually attempted. Do not claim it succeeded -- explain the failure to the user.',
    })
    return { error: message }
  }
}

// Re-hydrates a still-pending GatewayInvocationCard when a conversation is
// reloaded from persisted history (toDisplayMessages), not just live in the
// same turn -- re-checked against current DB state (same "never trust what
// was true when the row was written" posture as resolveCreatedRecord),
// since the invocation may have already been confirmed/cancelled/expired in
// a previous session. Returns null for anything not still 'proposed', or
// not visible to this caller, or now-missing -- never throws.
export async function resolvePendingInvocation(ctx: WorkbenchCallerContext, invocationId: string): Promise<PendingGatewayInvocation | null> {
  try {
    const { data: invocation } = await ctx.supabase
      .from('builder_integration_invocations')
      .select('id, tool_name, risk_classification, input, status, builder_integration_id, builder_integration_version_id')
      .eq('id', invocationId)
      .maybeSingle()
    if (!invocation || invocation.status !== 'proposed') return null

    const { data: integration } = await ctx.supabase.from('builder_integrations').select('slug').eq('id', invocation.builder_integration_id).maybeSingle()
    const { data: version } = await ctx.supabase
      .from('builder_integration_versions')
      .select('approval_policy')
      .eq('id', invocation.builder_integration_version_id)
      .maybeSingle()
    if (!integration) return null

    return {
      invocationId: invocation.id,
      toolName: invocation.tool_name,
      integrationSlug: integration.slug,
      riskClassification: invocation.risk_classification,
      input: invocation.input,
      confirmationFields: version?.approval_policy?.confirmationFields,
    }
  } catch {
    return null
  }
}

export async function cancelInvocation(ctx: WorkbenchCallerContext, invocationId: string): Promise<void> {
  const admin = createAdminClient()
  const { data: invocation, error } = await admin
    .from('builder_integration_invocations')
    .select('project_id, conversation_id, status')
    .eq('id', invocationId)
    .single()
  if (error || !invocation) throw error ?? new Error('Gateway invocation not found')
  if (invocation.status !== 'proposed') throw new Error(`This action is no longer pending confirmation (status: ${invocation.status})`)

  await requireProjectAccess(ctx, invocation.project_id)

  const { error: updateError } = await admin.from('builder_integration_invocations').update({ status: 'cancelled' }).eq('id', invocationId)
  if (updateError) throw updateError

  await syncToolMessageForInvocation(admin, invocation.conversation_id, invocationId, {
    status: 'cancelled_by_user',
    message: 'The human cancelled this action -- it did not happen. Do not retry it unless the user explicitly asks again.',
  })
}
