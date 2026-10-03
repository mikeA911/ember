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

export const DEFAULT_PLATFORM_RATE_PCT = 10
export const FEE_CURRENCIES: FeeCurrency[] = ['PHP', 'USD']
export const FEE_PERIODS: FeeBillingPeriod[] = ['monthly', 'annual']

const SETTINGS_KEY = 'builder_billing'

export interface FeeInput {
  amount: number
  currency: FeeCurrency
  period: FeeBillingPeriod
}

export function validateFee(input: FeeInput): FeeInput {
  if (!Number.isFinite(input.amount) || input.amount < 0) throw new ProjectValidationError('Fee must be a number of zero or more')
  if (!FEE_CURRENCIES.includes(input.currency)) throw new ProjectValidationError('Currency must be PHP or USD')
  if (!FEE_PERIODS.includes(input.period)) throw new ProjectValidationError('Billing period must be monthly or annual')
  return { amount: Math.round(input.amount * 100) / 100, currency: input.currency, period: input.period }
}

export function validateRatePct(pct: number): number {
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new ProjectValidationError('Platform rate must be between 0 and 100')
  return Math.round(pct * 100) / 100
}

export function monthlyEquivalent(amount: number, period: FeeBillingPeriod): number {
  return period === 'annual' ? amount / 12 : amount
}

export async function getPlatformRatePct(supabase: SupabaseClient<Database>): Promise<number> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
  if (error) throw error
  const pct = (data?.value as { platformRatePct?: unknown } | undefined)?.platformRatePct
  return typeof pct === 'number' ? pct : DEFAULT_PLATFORM_RATE_PCT
}

export async function setPlatformRatePct(ctx: WorkbenchCallerContext, pct: number): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can set the platform rate')
  const platformRatePct = validateRatePct(pct)
  const { error } = await ctx.supabase
    .from('settings')
    .upsert({ key: SETTINGS_KEY, value: { platformRatePct }, updated_by: ctx.user.id, updated_at: new Date().toISOString() })
  if (error) throw error
}

// Admin, or the agency of the builder who owns this client Project. A new
// fee row takes today's platform rate; correcting an existing fee keeps the
// rate it was recorded with.
export async function setClientProjectFee(ctx: WorkbenchCallerContext, projectId: string, input: FeeInput): Promise<void> {
  const fee = validateFee(input)
  const admin = createAdminClient()

  if (ctx.profile.role !== 'admin') {
    const { data: project, error: projectError } = await admin.from('projects').select('owner_id').eq('id', projectId).maybeSingle()
    if (projectError) throw projectError
    if (!project?.owner_id) throw new ProjectValidationError('Project not found')
    const { data: link, error: linkError } = await ctx.supabase
      .from('agency_builders')
      .select('builder_id')
      .eq('builder_id', project.owner_id)
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

  const row = { amount: fee.amount, currency: fee.currency, billing_period: fee.period, set_by: ctx.user.id }
  const { error } = existing
    ? await ctx.supabase.from('client_project_fees').update(row).eq('project_id', projectId)
    : await ctx.supabase
        .from('client_project_fees')
        .insert({ project_id: projectId, ...row, platform_rate_pct: await getPlatformRatePct(admin) })
  if (error) throw error
}
