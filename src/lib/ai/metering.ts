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

// Admin-client read throughout -- same "safe narrow metadata query" posture
// as listBuilderOperationsRows. Spend is scoped to this builder's own
// requests against the platform's budget (is_byo_llm=false) from their
// current allowance period onward; a BYOLLM call never counts here.
export async function getBuilderSpendSummary(
  admin: SupabaseClient<Database>,
  builderId: string
): Promise<BuilderSpendSummary> {
  const { data: allowanceRow } = await admin.from('builder_ai_allowances').select('*').eq('builder_id', builderId).maybeSingle()
  const allowanceUsd = allowanceRow?.monthly_allowance_usd ?? DEFAULT_MONTHLY_ALLOWANCE_USD
  const warningThresholdPct = allowanceRow?.warning_threshold_pct ?? DEFAULT_WARNING_THRESHOLD_PCT
  const stopAtAllowance = allowanceRow?.stop_at_allowance ?? DEFAULT_STOP_AT_ALLOWANCE
  const periodStart = allowanceRow?.current_period_start ?? new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)

  const { data: grants } = await admin.from('builder_credit_grants').select('amount_usd').eq('builder_id', builderId)
  const creditsUsd = (grants ?? []).reduce((sum, g) => sum + g.amount_usd, 0)

  const { data: logs } = await admin
    .from('ai_operation_logs')
    .select('estimated_cost_usd')
    .eq('requested_by', builderId)
    .eq('is_byo_llm', false)
    .gte('created_at', periodStart)
  const spentThisPeriodUsd = (logs ?? []).reduce((sum, l) => sum + (l.estimated_cost_usd ?? 0), 0)

  return {
    allowanceUsd,
    creditsUsd,
    spentThisPeriodUsd,
    remainingUsd: allowanceUsd + creditsUsd - spentThisPeriodUsd,
    warningThresholdPct,
    stopAtAllowance,
  }
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
        'Monthly AI allowance used up -- ask your operator for more credit, or configure your own LLM in your profile.'
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

async function requireCuratorOrAdmin(ctx: WorkbenchCallerContext): Promise<void> {
  if (ctx.profile.role !== 'curator' && ctx.profile.role !== 'admin') {
    throw new AuthError('Requires curator or admin role to manage builder AI allowances')
  }
}

export async function grantBuilderCredit(ctx: WorkbenchCallerContext, builderId: string, amountUsd: number, reason: string): Promise<void> {
  await requireCuratorOrAdmin(ctx)
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
  await requireCuratorOrAdmin(ctx)
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
