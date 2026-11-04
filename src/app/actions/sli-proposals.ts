'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AuthError, requireUser } from '@/lib/auth'
import { SliError, sliRpc } from '@/lib/sli/api'
import { sliEnabled } from '@/lib/sli/flag'
import type { SliProposal } from '@/lib/sli/types'

// The person's answer to a change Ember proposed: confirm runs the same SLI
// function the pages use, as them; cancel saves nothing
// (supabase/migrations/20261110100001_sli_assistant_proposals.sql).

type Result = { ok: true; proposal: SliProposal } | { ok: false; error: string }

async function decide(fn: 'sli_confirm_proposal' | 'sli_cancel_proposal', id: string): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: 'Proposal not found.' }
  try {
    const { supabase } = await requireUser()
    const proposal = await sliRpc<SliProposal>(supabase, fn, { p_id: id })
    if (proposal.status === 'confirmed') {
      revalidatePath('/sli', 'layout')
    }
    return { ok: true, proposal }
  } catch (err) {
    if (err instanceof SliError || err instanceof AuthError) return { ok: false, error: err.message }
    return { ok: false, error: 'Something went wrong. Try again in a moment.' }
  }
}

export async function confirmSliProposalAction(id: string): Promise<Result> {
  return decide('sli_confirm_proposal', id)
}

export async function cancelSliProposalAction(id: string): Promise<Result> {
  return decide('sli_cancel_proposal', id)
}
