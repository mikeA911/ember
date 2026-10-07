import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { ClientSource, Database, FeeBillingPeriod, FeeCurrency } from '@/types/database'
import type { WorkbenchCallerContext } from './context'
import { createAdminClient } from '@/lib/supabase/admin'

// Client maintenance fees and how they're split (20261003100003_client_
// project_fees.sql, 20261029100001_client_source_and_workstream_limits.sql).
// Ember records figures for invoicing; it never charges anyone. The
// deployment defaults live in settings.builder_billing: Ember's cut when a
// builder found the client (platformRatePct) and the builder's share when
// Ember found the client (builderSharePct). Both are recorded on each fee
// when it's created, so changing a default never rewrites an agreed fee.

export const DEFAULT_PLATFORM_RATE_PCT = 10
export const DEFAULT_BUILDER_SHARE_PCT = 10
export const FEE_CURRENCIES: FeeCurrency[] = ['PHP', 'USD']
export const FEE_PERIODS: FeeBillingPeriod[] = ['monthly', 'annual']

const SETTINGS_KEY = 'builder_billing'

export interface FeeInput {
  amount: number
  currency: FeeCurrency
  period: FeeBillingPeriod
  // Omitted: a new fee takes the deployment default, an existing one keeps
  // what it has.
  builderSharePct?: number
}

export function validateFee(input: FeeInput): FeeInput {
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ProjectValidationError('Fee must be a number of zero or more')
  if (!FEE_CURRENCIES.includes(input.currency)) throw new ProjectValidationError('Currency must be PHP or USD')
  if (!FEE_PERIODS.includes(input.period)) throw new ProjectValidationError('Billing period must be monthly or annual')
  return {
    amount: Math.round(input.amount * 100) / 100,
    currency: input.currency,
    period: input.period,
    ...(input.builderSharePct === undefined ? {} : { builderSharePct: validateRatePct(input.builderSharePct, "Builder's share") }),
  }
}

export function validateRatePct(pct: number, label = 'Platform rate'): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ProjectValidationError(`${label} must be between 0 and 100`)
  return Math.round(pct * 100) / 100
}

export function monthlyEquivalent(amount: number, period: FeeBillingPeriod): number {
  return period === 'annual' ? amount / 12 : amount
}

export interface BillingRates {
  platformRatePct: number
  builderSharePct: number
}

export async function getBillingRates(supabase: SupabaseClient<Database>): Promise<BillingRates> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  if (error) throw error
  const value = (data?.value ?? {}) as { platformRatePct?: unknown; builderSharePct?: unknown }
  return {
    platformRatePct: typeof value.platformRatePct === 'number' ? value.platformRatePct : DEFAULT_PLATFORM_RATE_PCT,
    builderSharePct: typeof value.builderSharePct === 'number' ? value.builderSharePct : DEFAULT_BUILDER_SHARE_PCT,
  }
}

export async function getPlatformRatePct(supabase: SupabaseClient<Database>): Promise<number> {
  return (await getBillingRates(supabase)).platformRatePct
}

// Admin only. Either rate may be omitted to keep its current value.
export async function setBillingRates(ctx: WorkbenchCallerContext, input: Partial<BillingRates>): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can set the platform rate')
  const current = await getBillingRates(ctx.supabase)
  const value = {
    platformRatePct: input.platformRatePct === undefined ? current.platformRatePct : validateRatePct(input.platformRatePct),
    builderSharePct:
      input.builderSharePct === undefined ? current.builderSharePct : validateRatePct(input.builderSharePct, "Builder's share"),
  }
  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ key: SETTINGS_KEY, value, updated_by: ctx.user.id, updated_at: new Date().toISOString() })
  if (error) throw error
}

export async function setPlatformRatePct(ctx: WorkbenchCallerContext, pct: number): Promise<void> {
  await setBillingRates(ctx, { platformRatePct: pct })
}

// Who found the client decides the split, and the two shares always add up
// to 100% (20261029100001_client_source_and_workstream_limits.sql):
//   * builder-found -- Ember takes its cut (platformRatePct); the builder
//     keeps the rest.
//   * Ember-found   -- the builder gets their share (builderSharePct); Ember
//     keeps the rest.
// A builder can have their own starting figures for either case
// (builder_billing_shares), raised as they succeed; each fee can still be
// adjusted per Project.
export interface FeeSplit {
  platformRatePct: number
  builderSharePct: number
}

export interface BuilderRates {
  // Ember's cut when the builder found the client; null = default.
  platformRatePct: number | null
  // The builder's share when Ember found the client; null = default.
  builderSharePct: number | null
}

export function feeSplitFor(source: ClientSource, defaults: BillingRates, own: BuilderRates | null): FeeSplit {
  if (source === 'ember') {
    const builderSharePct = own?.builderSharePct ?? defaults.builderSharePct
    return { builderSharePct, platformRatePct: round2(100 - builderSharePct) }
  }
  const platformRatePct = own?.platformRatePct ?? defaults.platformRatePct
  return { platformRatePct, builderSharePct: round2(100 - platformRatePct) }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

export async function getBuilderRates(supabase: SupabaseClient<Database>, builderId: string): Promise<BuilderRates | null> {
  const { data, error } = await supabase
    .from('builder_billing_shares')
    .select('share_pct, platform_rate_pct')
    .eq('builder_id', builderId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return {
    platformRatePct: data.platform_rate_pct === null ? null : Number(data.platform_rate_pct),
    builderSharePct: data.share_pct === null ? null : Number(data.share_pct),
  }
}

// The split a new fee is recorded with, for this builder and source.
export async function getFeeSplit(
  supabase: SupabaseClient<Database>,
  builderId: string,
  source: ClientSource,
  defaults?: BillingRates
): Promise<FeeSplit> {
  const [rates, own] = await Promise.all([defaults ? Promise.resolve(defaults) : getBillingRates(supabase), getBuilderRates(supabase, builderId)])
  return feeSplitFor(source, rates, own)
}

// Admin only. A null figure puts the builder back on that default. Applies
// to fees recorded from now on; recorded fees keep their split.
export async function setBuilderRates(ctx: WorkbenchCallerContext, builderId: string, rates: BuilderRates): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError("Only the platform admin can set a builder's rates")
  if (rates.platformRatePct === null && rates.builderSharePct === null) {
    const { error } = await ctx.supabase.from('builder_billing_shares').delete().eq('builder_id', builderId)
    if (error) throw error
    return
  }
  const { error } = await ctx.supabase.from('builder_billing_shares').upsert(
    {
      builder_id: builderId,
      platform_rate_pct: rates.platformRatePct === null ? null : validateRatePct(rates.platformRatePct, "Ember's cut"),
      share_pct: rates.builderSharePct === null ? null : validateRatePct(rates.builderSharePct, "Builder's share"),
      set_by: ctx.user.id,
    },
    { onConflict: 'builder_id' }
  )
  if (error) throw error
}

// Admin, or the agency of this client Project's builder (the builder of
// record, or the owner before a builder_id was recorded). Only a Project
// created by an approved workstream promotion is paid. A new fee takes the
// split for who found the client and this builder's own rates; setting the
// builder's share on a fee sets Ember's to the rest. Correcting only the
// amount keeps the recorded split.
export async function setClientProjectFee(ctx: WorkbenchCallerContext, projectId: string, input: FeeInput): Promise<void> {
  const fee = validateFee(input)
  const admin = createAdminClient()

  const { data: project, error: projectError } = await admin
    .from('projects')
    .select('owner_id, builder_id, client_source')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) throw projectError
  const builderId = project?.builder_id ?? project?.owner_id
  if (!builderId) throw new ProjectValidationError('Project not found')

  const { data: promotion, error: promotionError } = await admin
    .from('workstream_promotions')
    .select('id')
    .eq('created_project_id', projectId)
    .eq('status', 'approved')
    .limit(1)
    .maybeSingle()
  if (promotionError) throw promotionError
  if (!promotion) throw new ProjectValidationError('Only a project promoted from a workstream can have a client fee')

  if (ctx.profile.role !== 'admin') {
    const { data: link, error: linkError } = await ctx.supabase
      .from('agency_builders')
      .select('builder_id')
      .eq('builder_id', builderId)
      .eq('agency_id', ctx.user.id)
      .maybeSingle()
    if (linkError) throw linkError
    if (!link) throw new AuthError("Only this builder's agency or the platform admin can set a client fee")
  }

  const { data: existing, error: existingError } = await ctx.supabase
    .from('client_project_fees')
    .select('platform_rate_pct')
    .eq('project_id', projectId)
    .maybeSingle()
  if (existingError) throw existingError

  const row = {
    amount: fee.amount,
    currency: fee.currency,
    billing_period: fee.period,
    set_by: ctx.user.id,
    ...(fee.builderSharePct === undefined
      ? {}
      : { builder_share_pct: fee.builderSharePct, platform_rate_pct: round2(100 - fee.builderSharePct) }),
  }
  let error
  if (existing) {
    ;({ error } = await ctx.supabase.from('client_project_fees').update(row).eq('project_id', projectId))
  } else {
    const split = await getFeeSplit(admin, builderId, project?.client_source ?? 'builder')
    ;({ error } = await ctx.supabase.from('client_project_fees').insert({
      project_id: projectId,
      platform_rate_pct: split.platformRatePct,
      builder_share_pct: split.builderSharePct,
      ...row,
    }))
  }
  if (error) throw error
}

export interface MyMaintenanceShare {
  projectId: string
  projectName: string
  currency: FeeCurrency
  monthlyAmount: number
  builderSharePct: number
  builderMonthly: number
}

// The builder's own view of what they earn: every client Project they are
// the builder of record for (or still own) that has a fee, through their
// own RLS-scoped client (client_project_fees_select_builder_agency_or_admin).
export async function listMyMaintenanceShares(ctx: WorkbenchCallerContext): Promise<MyMaintenanceShare[]> {
  const { data: projects, error: projectError } = await ctx.supabase
    .from('projects')
    .select('id, name, owner_id, builder_id')
    .or(`builder_id.eq.${ctx.user.id},owner_id.eq.${ctx.user.id}`)
  if (projectError) throw projectError
  // Projects with a builder of record are theirs alone -- not one the
  // caller merely owns after someone else built it.
  const mine = (projects ?? []).filter((p) => (p.builder_id ?? p.owner_id) === ctx.user.id)
  if (mine.length === 0) return []

  const { data: fees, error: feeError } = await ctx.supabase
    .from('client_project_fees')
    .select('project_id, amount, currency, billing_period, builder_share_pct')
    .in('project_id', mine.map((p) => p.id))
  if (feeError) throw feeError

  const nameById = new Map(mine.map((p) => [p.id, p.name]))
  return (fees ?? [])
    .map((f) => {
      const monthlyAmount = monthlyEquivalent(Number(f.amount), f.billing_period)
      const builderSharePct = Number(f.builder_share_pct)
      return {
        projectId: f.project_id,
        projectName: nameById.get(f.project_id) ?? 'Client project',
        currency: f.currency,
        monthlyAmount,
        builderSharePct,
        builderMonthly: (monthlyAmount * builderSharePct) / 100,
      }
    })
    .sort((a, b) => a.projectName.localeCompare(b.projectName))
}
