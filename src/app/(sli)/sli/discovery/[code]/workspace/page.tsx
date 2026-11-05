import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { sliRpc } from '@/lib/sli/api'
import { loadTriggerView } from '@/lib/sli/trigger-view'
import { CalmWorkspace, type WorkspacePanel } from '@/components/sli/CalmWorkspace'
import { CandidateCustomers } from '@/components/sli/CandidateCustomers'
import { ResearchSaved } from '@/components/sli/ResearchSaved'
import { StageBadge } from '@/components/sli/StageBadge'
import { TriggerActions } from '@/components/sli/TriggerActions'
import { TriggerContributors } from '@/components/sli/TriggerContributors'
import { TriggerDecision } from '@/components/sli/TriggerDecision'
import { TriggerHandoffs } from '@/components/sli/TriggerHandoffs'
import { STAGE_LABELS } from '@/lib/sli/types'
import { loadSavedView } from '@/lib/view-settings'
import { requireUser } from '@/lib/auth'

const FIND_CANDIDATES_PROMPT =
  'Help me find candidate customers for this Trigger. Ask me one question at a time about who it is for, look companies up in our registry, and propose each good fit as a candidate (with its tier and why) for me to confirm. If a company isn’t in the registry, propose adding it.'
const RECOMMEND_PROMPT =
  'I’d like to record my recommendation on this Trigger. Ask me what I recommend (approve, revise, defer or reject), where it should go if approved, and why, one question at a time. Then propose it for me to confirm.'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: `${code.toUpperCase()} workspace` }
}

// The calm workspace for one Trigger: the same data and rules as the
// classic Trigger page (loadTriggerView), arranged as a conversation with
// artifacts beside it.
export default async function TriggerWorkspacePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()
  const view = await loadTriggerView(supabase, code)
  if (!view) notFound()
  const { trigger, ctx } = view

  const [fitCheckPrompt, stagePrompt, savedView, { profile }] = await Promise.all([
    sliRpc<string>(supabase, 'sli_fit_check_prompt'),
    trigger.stage === 'concept' || trigger.stage === 'feasibility' ? sliRpc<string>(supabase, 'sli_stage_prompt', { p_stage: trigger.stage }) : Promise.resolve(null),
    loadSavedView(supabase),
    requireUser(),
  ])

  const panels: WorkspacePanel[] = [
    {
      key: 'trigger',
      label: 'Trigger',
      attention: trigger.allowedActions.some((a) => a.action !== 'archive' && a.action !== 'unarchive'),
      content: (
        <div className="space-y-4 text-sm">
          <div className="flex flex-wrap items-center gap-2 text-zinc-500">
            <span className="font-mono text-xs">{trigger.code}</span>
            <StageBadge stage={trigger.stage} />
            <span>{trigger.triggerTypeLabel ?? trigger.triggerType}</span>
          </div>
          <h2 className="text-lg font-semibold">{trigger.title}</h2>
          <p className="text-zinc-600">
            Raised by {trigger.raisedByMe ? 'you' : trigger.raisedByName}
            {trigger.sponsorName ? ` · Sponsor: ${trigger.sponsoredByMe ? 'you' : trigger.sponsorName}` : ' · No sponsor yet'}
          </p>
          {trigger.summary && <p className="whitespace-pre-wrap">{trigger.summary}</p>}
          {trigger.strategicObjective && (
            <p>
              <span className="text-zinc-500">Objective:</span> {trigger.strategicObjective}
            </p>
          )}
          <TriggerActions triggerId={trigger.id} actions={trigger.allowedActions} />
        </div>
      ),
    },
  ]
  if (view.hasResearch) {
    panels.push({ key: 'saved', label: 'Saved', content: <ResearchSaved stages={view.stages} /> })
  }
  if (view.showCandidates && view.candidateList) {
    panels.push({ key: 'candidates', label: 'Candidates', content: <CandidateCustomers triggerId={trigger.id} list={view.candidateList} /> })
  }
  if (view.showDecision && trigger.decisionInfo) {
    panels.push({
      key: 'decision',
      label: 'Decision',
      attention: !!trigger.decisionInfo.canDecide || !!trigger.decisionInfo.canRecommend,
      content: (
        <TriggerDecision
          triggerId={trigger.id}
          info={trigger.decisionInfo}
          evidenceOptions={view.researchOptions}
          candidateCount={view.acceptedCandidateCount}
        />
      ),
    })
  }
  if (view.showHandoffs && trigger.handoffInfo) {
    panels.push({
      key: 'handoff',
      label: 'Handoff',
      attention: !!trigger.handoffInfo.canPropose || (trigger.handoffInfo.handoffs ?? []).some((h) => h.canDecide),
      content: (
        <TriggerHandoffs triggerId={trigger.id} info={trigger.handoffInfo} researchOptions={view.researchOptions} receivedPackage={view.receivedPackage} />
      ),
    })
  }
  if (view.hasResearch && (trigger.canManageContributors || (trigger.contributors?.length ?? 0) > 0)) {
    panels.push({
      key: 'colleagues',
      label: 'Colleagues',
      content: (
        <TriggerContributors
          triggerId={trigger.id}
          contributors={trigger.contributors ?? []}
          candidates={view.contributorCandidates}
          canManage={!!trigger.canManageContributors}
        />
      ),
    })
  }

  const taskChips = [
    ...(view.showCandidates && view.candidateList?.canEdit
      ? [{ label: 'Find candidates', prompt: FIND_CANDIDATES_PROMPT, title: 'Ember looks companies up; you confirm each one' }]
      : []),
    ...(trigger.decisionInfo?.canRecommend ? [{ label: 'Recommend', prompt: RECOMMEND_PROMPT, title: 'Ember records it once you confirm' }] : []),
  ]

  return (
    <CalmWorkspace
      code={trigger.code}
      title={trigger.title}
      stageLabel={STAGE_LABELS[trigger.stage]}
      productName={ctx?.productName ?? 'Ember SLI'}
      projectId={view.hasResearch && !trigger.archived ? (trigger.projectId ?? null) : null}
      stagePrompt={stagePrompt}
      fitCheckPrompt={fitCheckPrompt}
      taskChips={taskChips}
      savedView={savedView}
      userName={profile.full_name ?? profile.email}
      panels={panels}
    />
  )
}
