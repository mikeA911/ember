import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import {
  getSliContext,
  getTrigger,
  listCandidateCustomers,
  listContributorCandidates,
  listResearchStages,
  listWorkstreamFindings,
  type ResearchFinding,
  type ResearchStage,
} from './api'
import type { CandidateList, SliContext, TriggerContributor, TriggerDetail } from './types'

// Everything a Trigger's screens show, loaded once for the classic Trigger
// page and the calm workspace alike, so the two never drift apart. Every
// read runs as the signed-in person; the SLI functions decide what they
// may see.

export type TriggerView = {
  trigger: TriggerDetail
  ctx: SliContext | null
  hasResearch: boolean
  contributorCandidates: TriggerContributor[]
  stages: ResearchStage[]
  receivedPackage: ResearchFinding[]
  candidateList: CandidateList | null
  acceptedCandidateCount: number
  showCandidates: boolean
  showHandoffs: boolean
  showDecision: boolean
  researchOptions: { id: string; title: string; stage: string }[]
}

export async function loadTriggerView(supabase: Awaited<ReturnType<typeof createClient>>, code: string): Promise<TriggerView | null> {
  const [trigger, ctx] = await Promise.all([getTrigger(supabase, code), getSliContext(supabase)])
  if (!trigger) return null
  const hasResearch = (trigger.access === 'full' || trigger.access === 'contributor') && !!trigger.projectId
  const acceptedHandoff = [...(trigger.handoffInfo?.handoffs ?? [])].reverse().find((h) => h.kind === 'promote' && h.status === 'accepted')
  const [contributorCandidates, stages, receivedPackage, candidateList] = await Promise.all([
    trigger.canManageContributors ? listContributorCandidates(supabase, trigger.id) : Promise.resolve([]),
    hasResearch && trigger.projectId ? listResearchStages(supabase, trigger.projectId) : Promise.resolve([]),
    acceptedHandoff?.destinationWorkstreamId ? listWorkstreamFindings(supabase, acceptedHandoff.destinationWorkstreamId) : Promise.resolve([]),
    trigger.access === 'full' ? listCandidateCustomers(supabase, trigger.id) : Promise.resolve(null),
  ])
  const decisions = trigger.decisionInfo?.decisions?.length ?? 0
  return {
    trigger,
    ctx,
    hasResearch,
    contributorCandidates,
    stages,
    receivedPackage,
    candidateList,
    acceptedCandidateCount: candidateList?.candidates.filter((c) => c.status === 'accepted').length ?? 0,
    showCandidates: !!candidateList && (candidateList.canEdit || candidateList.candidates.length > 0),
    showHandoffs:
      !!trigger.handoffInfo &&
      ((trigger.handoffInfo.handoffs?.length ?? 0) > 0 || !!trigger.handoffInfo.canPropose || !!trigger.handoffInfo.canSendBack),
    showDecision:
      !!trigger.decisionInfo && (trigger.stage === 'under_review' || decisions > 0) && (trigger.access === 'full' || decisions > 0),
    researchOptions: stages.flatMap((st) => st.findings.map((f) => ({ id: f.id, title: f.title, stage: st.name }))),
  }
}
