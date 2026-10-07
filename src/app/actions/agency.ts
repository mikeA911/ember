'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { assignBuilderToAgency } from '@/lib/workbench/agency-dashboard'
import { setBillingRates, setBuilderSharePct, setClientProjectFee, type BillingRates, type FeeInput } from '@/lib/workbench/client-billing'

export async function assignBuilderToAgencyAction(builderId: string, agencyId: string | null) {
  const ctx = await requireUser()
  await assignBuilderToAgency(ctx, builderId, agencyId)
  revalidatePath('/agency')
}

export async function setBillingRatesAction(rates: Partial<BillingRates>) {
  const ctx = await requireUser()
  await setBillingRates(ctx, rates)
  revalidatePath('/agency')
}

export async function setClientProjectFeeAction(projectId: string, fee: FeeInput) {
  const ctx = await requireUser()
  await setClientProjectFee(ctx, projectId, fee)
  revalidatePath('/agency')
}

// null puts the builder back on the default share.
export async function setBuilderShareAction(builderId: string, pct: number | null) {
  const ctx = await requireUser()
  await setBuilderSharePct(ctx, builderId, pct)
  revalidatePath('/agency')
}
