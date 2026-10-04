import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import type { AIProvider, EmbedInput, GenerateChatInput, GenerateStructuredInput, GenerateTextInput } from './provider'
import { AuthError } from '@/lib/auth'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

// Builder AI Usage Metering (docs/dev-request-kb-sandbox-builder-product.md,
// "Credits and metering"): every builder Ember call against the
// platform's own provider budget is priced and counted against a monthly
// allowance plus any manually-granted credit top-ups. Deliberately NOT the
// doc's 5-milestone-triggered automatic credit awards -- the milestones
// don't exist yet, same deferral already on record for this whole
// initiative. A call made through a builder's own BYOLLM credential
// (src/lib/workbench/builder-llm-credentials.ts) is logged with
// is_byo_llm=true and never counted here -- that cost is the builder's own,
// not the platform's.

export class BuilderAllowanceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BuilderAllowanceError'
  }
}

// Used only when a builder has no builder_ai_allowances row yet -- "use the
// platform-wide default" rather than seeding a row per builder, same
// "don't fabricate a value" posture listBuilderOperationsRows already uses
// for the fields it omits today.
const DEFAULT_MONTHLY_ALLOWANCE_USD = 20
const DEFAULT_WARNING_THRESHOLD_PCT = 80
const DEFAULT_STOP_AT_ALLOWANCE = true

// Looks up the ai_models row for this (provider, model) pair to price a
// completed call. Returns null (never 0) when pricing isn't configured --
// an unpriced call is honestly unpriced, not silently free, so it can't
// quietly deflate a builder's reported spend.
export async function computeCost(
  supabase: SupabaseClient<Database>,
  providerName: string,
  modelId: string,
  inputTokens: number | null,
  outputTokens: number | null
): Promise<number | null> {
  if (inputTokens === null && outputTokens === null) return null
  const { data: provider } = await supabase.from('ai_providers').select('id').eq('name', providerName).maybeSingle()
  if (!provider) return null
  const { data: model } = await supabase
    .from('ai_models')
    .select('input_cost_per_million, output_cost_per_million')
    .eq('provider_id', provider.id)
    .eq('model_id', modelId)
    .maybeSingle()
  if (!model || model.input_cost_per_million === null || model.output_cost_per_million === null) return null
  const inputCost = ((inputTokens ?? 0) / 1_000_000) * model.input_cost_per_million
  const outputCost = ((outputTokens ?? 0) / 1_000_000) * model.output_cost_per_million
  return inputCost + outputCost
}

export interface BuilderSpendSummary {
  allowanceUsd: number
  creditsUsd: number
  spentThisPeriodUsd: number
  remainingUsd: number
  warningThresholdPct: number
  stopAtAllowance: boolean
}

type AllowanceRow = Pick<
  Database['public']['Tables']['builder_ai_allowances']['Row'],
  'monthly_allowance_usd' | 'warning_threshold_pct' | 'stop_at_allowance' | 'current_period_start'
>

function currentMonthStart(): string {
  return new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
}

function periodStartOf(allowanceRow: AllowanceRow | null | undefined): string {
  return allowanceRow?.current_period_start ?? currentMonthStart()
}

function summarize(allowanceRow: AllowanceRow | null | undefined, creditsUsd: number, spentThisPeriodUsd: number): BuilderSpendSummary {
  const allowanceUsd = allowanceRow?.monthly_allowance_usd ?? DEFAULT_MONTHLY_ALLOWANCE_USD
  return {
    allowanceUsd,
    creditsUsd,
    spentThisPeriodUsd,
    remainingUsd: allowanceUsd + creditsUsd - spentThisPeriodUsd,
    warningThresholdPct: allowanceRow?.warning_threshold_pct ?? DEFAULT_WARNING_THRESHOLD_PCT,
    stopAtAllowance: allowanceRow?.stop_at_allowance ?? DEFAULT_STOP_AT_ALLOWANCE,
  }
}

// Admin-client read throughout -- same "safe narrow metadata query" posture
// as listBuilderOperationsRows. Spend is scoped to this builder's own
// requests against the platform's budget (is_byo_llm=false) from their
// current allowance period onward; a BYOLLM call never counts here.
export async function getBuilderSpendSummary(
  admin: SupabaseClient<Database>,
  builderId: string
): Promise<BuilderSpendSummary> {
  const { data: allowanceRow } = await admin.from('builder_ai_allowances').select('*').eq('builder_id', builderId).maybeSingle()

  const { data: grants } = await admin.from('builder_credit_grants').select('amount_usd').eq('builder_id', builderId)
  const creditsUsd = (grants ?? []).reduce((sum, g) => sum + g.amount_usd, 0)

  const { data: logs } = await admin
    .from('ai_operation_logs')
    .select('estimated_cost_usd')
    .eq('requested_by', builderId)
    .eq('is_byo_llm', false)
    .gte('created_at', periodStartOf(allowanceRow))
  const spentThisPeriodUsd = (logs ?? []).reduce((sum, l) => sum + (l.estimated_cost_usd ?? 0), 0)

  return summarize(allowanceRow, creditsUsd, spentThisPeriodUsd)
}

// The same summary for many builders in three queries (the agency
// dashboard). Each builder's spend still starts at their own period start.
export async function getBuilderSpendSummaries(
  admin: SupabaseClient<Database>,
  builderIds: string[]
): Promise<Map<string, BuilderSpendSummary>> {
  const result = new Map<string, BuilderSpendSummary>()
  if (builderIds.length === 0) return result

  const [{ data: allowanceRows, error: allowanceError }, { data: grants, error: grantError }] = await Promise.all([
    admin.from('builder_ai_allowances').select('*').in('builder_id', builderIds),
    admin.from('builder_credit_grants').select('builder_id, amount_usd').in('builder_id', builderIds),
  ])
  if (allowanceError) throw allowanceError
  if (grantError) throw grantError
  const allowanceByBuilder = new Map((allowanceRows ?? []).map((r) => [r.builder_id, r]))
  const periodStartByBuilder = new Map(builderIds.map((id) => [id, periodStartOf(allowanceByBuilder.get(id))]))
  const earliestPeriodStart = [...periodStartByBuilder.values()].reduce((a, b) => (b < a ? b : a))

  const { data: logs, error: logError } = await admin
    .from('ai_operation_logs')
    .select('requested_by, estimated_cost_usd, created_at')
    .in('requested_by', builderIds)
    .eq('is_byo_llm', false)
    .gte('created_at', earliestPeriodStart)
  if (logError) throw logError

  const creditsByBuilder = new Map<string, number>()
  for (const g of grants ?? []) creditsByBuilder.set(g.builder_id, (creditsByBuilder.get(g.builder_id) ?? 0) + Number(g.amount_usd))
  const spentByBuilder = new Map<string, number>()
  for (const l of logs ?? []) {
    if (!l.requested_by || l.created_at < periodStartByBuilder.get(l.requested_by)!) continue
    spentByBuilder.set(l.requested_by, (spentByBuilder.get(l.requested_by) ?? 0) + Number(l.estimated_cost_usd ?? 0))
  }

  for (const id of builderIds) {
    result.set(id, summarize(allowanceByBuilder.get(id), creditsByBuilder.get(id) ?? 0, spentByBuilder.get(id) ?? 0))
  }
  return result
}

// Mirrors src/lib/ai/sensitivity.ts's withPolicyGate shape exactly: a
// blocked check throws BuilderAllowanceError before the wrapped provider
// method ever runs, so an over-budget request genuinely never reaches the
// provider. getSummary is a thunk (not a pre-computed value) so every call
// in a multi-call turn re-checks the latest spend, not a snapshot from
// before the turn started.
export function withAllowanceGate(getSummary: () => Promise<BuilderSpendSummary>, provider: AIProvider): AIProvider {
  const gate = async () => {
    const summary = await getSummary()
    if (summary.stopAtAllowance && summary.remainingUsd <= 0) {
      throw new BuilderAllowanceError(
        'Monthly AI allowance used up -- ask your agency for more credit, or configure your own LLM in your profile.'
      )
    }
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

// The platform admin, or the builder's own agency (agency_builders) -- the
// same set can_manage_builder_budget enforces in RLS
// (20261007100001_agency_scoped_builder_budgets.sql). An enterprise running
// its own Ember is the agency, so it manages its employees' budgets here.
async function requireBudgetManager(ctx: WorkbenchCallerContext, builderId: string): Promise<void> {
  if (ctx.profile.role === 'admin') return
  if (ctx.profile.role !== 'curator') {
    throw new AuthError('Requires curator or admin role to manage builder AI allowances')
  }
  const { data: link, error } = await ctx.supabase
    .from('agency_builders')
    .select('builder_id')
    .eq('builder_id', builderId)
    .eq('agency_id', ctx.user.id)
    .maybeSingle()
  if (error) throw error
  if (!link) throw new AuthError("Only the builder's agency or the platform admin can manage their AI budget")
}

export async function grantBuilderCredit(ctx: WorkbenchCallerContext, builderId: string, amountUsd: number, reason: string): Promise<void> {
  await requireBudgetManager(ctx, builderId)
  const trimmedReason = reason.trim()
  if (amountUsd <= 0) throw new Error('Credit amount must be positive')
  if (!trimmedReason) throw new Error('A reason is required')
  const { error } = await ctx.supabase
    .from('builder_credit_grants')
    .insert({ builder_id: builderId, amount_usd: amountUsd, reason: trimmedReason, granted_by: ctx.user.id })
  if (error) throw error
}

export interface SetBuilderAllowanceInput {
  monthlyAllowanceUsd: number
  warningThresholdPct: number
  stopAtAllowance: boolean
}

export async function setBuilderAllowance(ctx: WorkbenchCallerContext, builderId: string, input: SetBuilderAllowanceInput): Promise<void> {
  await requireBudgetManager(ctx, builderId)
  if (input.monthlyAllowanceUsd < 0) throw new Error('Monthly allowance cannot be negative')
  const { error } = await ctx.supabase.from('builder_ai_allowances').upsert(
    {
      builder_id: builderId,
      monthly_allowance_usd: input.monthlyAllowanceUsd,
      warning_threshold_pct: input.warningThresholdPct,
      stop_at_allowance: input.stopAtAllowance,
    },
    { onConflict: 'builder_id' }
  )
  if (error) throw error
}
