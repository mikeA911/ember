'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { assignBuilderToAgency } from '@/lib/workbench/agency-dashboard'

export async function assignBuilderToAgencyAction(builderId: string, agencyId: string | null) {
  const ctx = await requireUser()
  await assignBuilderToAgency(ctx, builderId, agencyId)
  revalidatePath('/agency')
}
