'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { grantBuilderCredit, setBuilderAllowance, getBuilderSpendSummary, type SetBuilderAllowanceInput, type BuilderSpendSummary } from '@/lib/ai'

export async function grantBuilderCreditAction(builderId: string, amountUsd: number, reason: string): Promise<void> {
  const ctx = await requireUser()
  await grantBuilderCredit(ctx, builderId, amountUsd, reason)
  revalidatePath('/admin')
  revalidatePath('/agency')
}

export async function setBuilderAllowanceAction(builderId: string, input: SetBuilderAllowanceInput): Promise<void> {
  const ctx = await requireUser()
  await setBuilderAllowance(ctx, builderId, input)
  revalidatePath('/admin')
  revalidatePath('/agency')
}

// The profile page's own reader -- scoped to the caller's own spend, RLS-safe
// under builder_ai_allowances_select_own_or_operator regardless of caller
// role (the admin client here is only for the "own project" existence check
// getBuilderSpendSummary itself doesn't need to repeat for this one caller).
export async function getMyBuilderSpendSummaryAction(): Promise<BuilderSpendSummary> {
  const ctx = await requireUser()
  const admin = createAdminClient()
  return getBuilderSpendSummary(admin, ctx.user.id)
}
