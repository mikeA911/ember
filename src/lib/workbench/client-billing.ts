import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { Database, FeeBillingPeriod, FeeCurrency } from '@/types/database'
import type { WorkbenchCallerContext } from './context'
import { createAdminClient } from '@/lib/supabase/admin'

// Client maintenance fees and the platform's share (20261003100003_client_
// project_fees.sql). Ember records figures for invoicing builders; it
// never charges anyone. The platform rate is one per deployment, in
// settings.builder_billing -- the platform owner's own business model.
// The builder's share (20261008100001) works the same way: a deployment
// default in settings.builder_billing, recorded on each fee when it's
// created, and adjustable per Project -- for an employee it's a bonus on
// the maintenance fee.

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

// Each builder can have their own share (builder_billing_shares,
// 20261028100001), raised as they bring more paid projects; without one
// they get the deployment default. Read where a new fee is recorded.
export async function getBuilderSharePct(supabase: SupabaseClient<Database>, builderId: string, defaultPct?: number): Promise<number> {
  const { data, error } = await supabase.from('builder_billing_shares').select('share_pct').eq('builder_id', builderId).maybeSingle()
  if (error) throw error
  if (data) return Number(data.share_pct)
  return defaultPct ?? (await getBillingRates(supabase)).builderSharePct
}

// Admin only. null removes the builder's own share, back to the default.
// Applies to fees recorded from now on; recorded fees keep their share.
export async function setBuilderSharePct(ctx: WorkbenchCallerContext, builderId: string, pct: number | null): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError("Only the platform admin can set a builder's share")
  if (pct === null) {
    const { error } = await ctx.supabase.from('builder_billing_shares').delete().eq('builder_id', builderId)
    if (error) throw error
    return
  }
  const { error } = await ctx.supabase
    .from('builder_billing_shares')
    .upsert({ builder_id: builderId, share_pct: validateRatePct(pct, "Builder's share"), set_by: ctx.user.id }, { onConflict: 'builder_id' })
  if (error) throw error
}

// Admin, or the agency of this client Project's builder (the builder of
// record, or the owner before a builder_id was recorded). Only a Project
// created by an approved workstream promotion is paid. A new fee row takes
// today's platform rate and the builder's own share; correcting an
// existing fee keeps the platform rate it was recorded with.
export async function setClientProjectFee(ctx: WorkbenchCallerContext, projectId: string, input: FeeInput): Promise<void> {
  const fee = validateFee(input)
  const admin = createAdminClient()

  const { data: project, error: projectError } = await admin.from('projects').select('owner_id, builder_id').eq('id', projectId).maybeSingle()
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
    ...(fee.builderSharePct === undefined ? {} : { builder_share_pct: fee.builderSharePct }),
  }
  let error
  if (existing) {
    ;({ error } = await ctx.supabase.from('client_project_fees').update(row).eq('project_id', projectId))
  } else {
    const rates = await getBillingRates(admin)
    ;({ error } = await ctx.supabase.from('client_project_fees').insert({
      project_id: projectId,
      builder_share_pct: await getBuilderSharePct(admin, builderId, rates.builderSharePct),
      ...row,
      platform_rate_pct: rates.platformRatePct,
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
