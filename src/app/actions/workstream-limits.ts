'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import { decideWorkstreamLimitRequest, requestMoreWorkstreams } from '@/lib/workbench/workstream-limits'

export async function requestMoreWorkstreamsAction(projectId: string, requestedLimit: number, reason: string) {
  const ctx = await requireUser()
  await requestMoreWorkstreams(ctx, { requestedLimit, reason })
  revalidatePath(`/projects/${projectId}/workstreams/new`)
  revalidatePath('/agency')
}

export async function decideWorkstreamLimitRequestAction(requestId: string, approve: boolean, note?: string) {
  const ctx = await requireUser()
  await decideWorkstreamLimitRequest(ctx, requestId, approve, note)
  revalidatePath('/agency')
}
