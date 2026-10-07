'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { assignBuilderToAgency } from '@/lib/workbench/agency-dashboard'
import { assignProjectBuilder } from '@/lib/workbench/project-builder'
import { setBillingRates, setBuilderRates, type BuilderRates, setClientProjectFee, type BillingRates, type FeeInput } from '@/lib/workbench/client-billing'

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

// A null figure puts the builder back on that default.
export async function setBuilderRatesAction(builderId: string, rates: BuilderRates) {
  const ctx = await requireUser()
  await setBuilderRates(ctx, builderId, rates)
  revalidatePath('/agency')
}

export async function assignProjectBuilderAction(projectId: string, builderId: string) {
  const ctx = await requireUser()
  await assignProjectBuilder(ctx, projectId, builderId)
  revalidatePath(`/projects/${projectId}/members`)
  revalidatePath('/agency')
}
