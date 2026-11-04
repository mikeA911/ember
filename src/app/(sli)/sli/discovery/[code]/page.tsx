import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getSliContext,
  getTrigger,
  listCandidateCustomers,
  listContributorCandidates,
  listResearchStages,
  listWorkstreamFindings,
} from '@/lib/sli/api'
import { CandidateCustomers } from '@/components/sli/CandidateCustomers'
import { StageBadge } from '@/components/sli/StageBadge'
import { TriggerActions } from '@/components/sli/TriggerActions'
import { TriggerContributors } from '@/components/sli/TriggerContributors'
import { TriggerDecision } from '@/components/sli/TriggerDecision'
import { TriggerHandoffs } from '@/components/sli/TriggerHandoffs'
import { TriggerResearchChat } from '@/components/sli/TriggerResearchChat'
import { STAGE_LABELS, type TriggerHistoryEntry } from '@/lib/sli/types'

export async function generateMetadata({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  return { title: code.toUpperCase() }
}

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Manila' })

function describe(h: TriggerHistoryEntry): string {
  switch (h.event) {
    case 'raised':
      return 'Raised'
    case 'archived':
      return 'Archived'
    case 'unarchived':
      return 'Unarchived'
    case 'contributor_added':
      return 'Colleague invited'
    case 'contributor_removed':
      return 'Colleague removed'
    case 'handoff_proposed':
      return 'Handoff proposed'
    case 'handoff_withdrawn':
      return 'Handoff withdrawn'
    case 'handoff_returned':
      return 'Handoff returned'
    case 'send_back_raised':
      return 'Send-back raised'
    case 'send_back_declined':
      return 'Send-back declined'
    default:
      return `${h.fromStage ? STAGE_LABELS[h.fromStage] : ''} → ${STAGE_LABELS[h.toStage]}`
  }
}

export default async function TriggerPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const supabase = await createClient()
  const [trigger, ctx] = await Promise.all([getTrigger(supabase, code), getSliContext(supabase)])
  if (!trigger) notFound()
  const hasResearch = (trigger.access === 'full' || trigger.access === 'contributor') && !!trigger.projectId
  const acceptedHandoff = [...(trigger.handoffInfo?.handoffs ?? [])].reverse().find((h) => h.kind === 'promote' && h.status === 'accepted')
  const [candidates, stages, receivedPackage, candidateList] = await Promise.all([
    trigger.canManageContributors ? listContributorCandidates(supabase, trigger.id) : Promise.resolve([]),
    hasResearch && trigger.projectId ? listResearchStages(supabase, trigger.projectId) : Promise.resolve([]),
    acceptedHandoff?.destinationWorkstreamId ? listWorkstreamFindings(supabase, acceptedHandoff.destinationWorkstreamId) : Promise.resolve([]),
    trigger.access === 'full' ? listCandidateCustomers(supabase, trigger.id) : Promise.resolve(null),
  ])
  const acceptedCandidateCount = candidateList?.candidates.filter((c) => c.status === 'accepted').length ?? 0
  const showCandidates = !!candidateList && (candidateList.canEdit || candidateList.candidates.length > 0)
  const researchOptions = stages.flatMap((st) => st.findings.map((f) => ({ id: f.id, title: f.title, stage: st.name })))
  const showHandoffs =
    !!trigger.handoffInfo &&
    ((trigger.handoffInfo.handoffs?.length ?? 0) > 0 || !!trigger.handoffInfo.canPropose || !!trigger.handoffInfo.canSendBack)

  const limited = trigger.access === 'summary'

  return (
    <div className="space-y-8">
      <div>
        <Link href="/sli/discovery" className="text-sm text-zinc-600 underline">Discovery</Link>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-zinc-500">
          <span className="font-mono">{trigger.code}</span>
          <StageBadge stage={trigger.stage} />
          {trigger.archived && <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700">Archived</span>}
          <span>{trigger.triggerTypeLabel ?? trigger.triggerType}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold">{trigger.title}</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Raised by {trigger.raisedByMe ? 'you' : trigger.raisedByName}
          {trigger.sourceDepartment ? ` (${trigger.sourceDepartment})` : ''} on {when(trigger.createdAt)}
          {trigger.sponsorName ? ` · Sponsor: ${trigger.sponsoredByMe ? 'you' : trigger.sponsorName}` : ' · No sponsor yet'}
        </p>
      </div>

      <TriggerActions triggerId={trigger.id} actions={trigger.allowedActions} />

      {limited ? (
        <p className="rounded border border-zinc-200 bg-white p-4 text-sm text-zinc-600">
          The Discovery team is handling this Trigger. Its details and research are visible to the Discovery team only.
        </p>
      ) : (
        <div className="grid gap-6 md:grid-cols-3">
          <section className="space-y-4 md:col-span-2">
            <div>
              <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Summary</h2>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800">{trigger.summary || 'No summary given.'}</p>
            </div>
            {trigger.strategicObjective && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Objective it could serve</h2>
                <p className="mt-2 text-sm text-zinc-800">{trigger.strategicObjective}</p>
              </div>
            )}
            {trigger.archived && trigger.archiveReason && (
              <div>
                <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Why it was archived</h2>
                <p className="mt-2 text-sm text-zinc-800">{trigger.archiveReason}</p>
              </div>
            )}
          </section>
          <aside className="space-y-3 text-sm">
            {trigger.eventDate && (
              <p>
                <span className="text-zinc-500">Event date:</span> {trigger.eventDate}
              </p>
            )}
            {trigger.eventReference && (
              <p className="break-words">
                <span className="text-zinc-500">Source:</span>{' '}
                {/^https?:\/\//.test(trigger.eventReference) ? (
                  <a href={trigger.eventReference} target="_blank" rel="noopener noreferrer" className="underline">
                    {trigger.eventReference}
                  </a>
                ) : (
                  trigger.eventReference
                )}
              </p>
            )}
            <p>
              <span className="text-zinc-500">Sensitivity:</span> {trigger.informationSensitivity}
            </p>
          </aside>
        </div>
      )}

      {trigger.decisionInfo &&
        (trigger.stage === 'under_review' || (trigger.decisionInfo.decisions?.length ?? 0) > 0) &&
        (trigger.access === 'full' || (trigger.decisionInfo.decisions?.length ?? 0) > 0) && (
          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Decision</h2>
            <TriggerDecision
              triggerId={trigger.id}
              info={trigger.decisionInfo}
              evidenceOptions={researchOptions}
              candidateCount={acceptedCandidateCount}
            />
          </section>
        )}

      {showCandidates && candidateList && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Candidate customers</h2>
          {trigger.stage === 'approved' && (
            <p className="text-sm text-zinc-600">Use Start Targeting to settle the list before handing off to Marketing.</p>
          )}
          <CandidateCustomers triggerId={trigger.id} list={candidateList} />
        </section>
      )}

      {showHandoffs && trigger.handoffInfo && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Handoff</h2>
          <TriggerHandoffs triggerId={trigger.id} info={trigger.handoffInfo} researchOptions={researchOptions} receivedPackage={receivedPackage} />
        </section>
      )}

      {(trigger.access === 'full' || trigger.access === 'contributor' || trigger.access === 'raiser') && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Research</h2>
            {ctx?.isPlatformAdmin && trigger.projectId && trigger.workstreamId && (
              <a href={`/projects/${trigger.projectId}/workstreams/${trigger.workstreamId}`} className="text-sm text-zinc-600 underline">
                Open in Ember
              </a>
            )}
          </div>
          {hasResearch && trigger.projectId ? (
            <>
              <p className="max-w-3xl text-sm text-zinc-600">
                Talk the idea through with Ember. Start with the fit check: Ember answers from Sandz&rsquo;s knowledge and the web, cites its
                sources and lists what it couldn&rsquo;t find. Attach files to bring in your own material. Only the Discovery team and the
                colleagues invited below can see this.
              </p>
              {trigger.archived ? (
                <p className="text-sm text-zinc-500">This Trigger is archived. Unarchive it to continue the research.</p>
              ) : (
                <TriggerResearchChat projectId={trigger.projectId} projectName={`${trigger.code} · ${trigger.title}`} />
              )}
              <div className="space-y-4">
                <h3 className="text-sm font-medium">Saved to the research</h3>
                {stages.map((stage) => {
                  const missing = stage.deliverables.filter((d) => !stage.findings.some((f) => f.title.toLowerCase() === d.toLowerCase()))
                  return (
                    <div key={stage.workstreamId} className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{stage.name}</h4>
                      {missing.length > 0 && (
                        <p className="text-sm text-zinc-500">
                          Still to write: {missing.join(', ')}. Use the suggestion in the conversation to have Ember draft it.
                        </p>
                      )}
                      {stage.findings.length === 0 ? (
                        missing.length === 0 && (
                          <p className="text-sm text-zinc-500">Nothing saved yet. Ask Ember to save the fit check, or save attached files when you send them.</p>
                        )
                      ) : (
                        <ul className="space-y-2">
                          {stage.findings.map((f) => (
                            <li key={f.id} className="rounded border border-zinc-200 bg-white text-sm">
                              <details>
                                <summary className="flex cursor-pointer flex-wrap justify-between gap-2 px-3 py-2">
                                  <span className="font-medium">{f.title}</span>
                                  <span className="text-xs text-zinc-500">{when(f.createdAt)}</span>
                                </summary>
                                {f.content && <div className="whitespace-pre-wrap border-t border-zinc-100 px-3 py-2 text-zinc-800">{f.content}</div>}
                              </details>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )
                })}
              </div>
              <div className="space-y-2">
                <h3 className="text-sm font-medium">Invited colleagues</h3>
                <TriggerContributors
                  triggerId={trigger.id}
                  contributors={trigger.contributors ?? []}
                  candidates={candidates}
                  canManage={!!trigger.canManageContributors}
                />
              </div>
            </>
          ) : (
            <p className="rounded border border-dashed border-zinc-300 p-4 text-sm text-zinc-500">
              {trigger.access === 'raiser'
                ? 'The Discovery team researches this Trigger in a private space. You’ll see its stage and the outcome here.'
                : 'The research space opens when a Discovery sponsor accepts this Trigger.'}
            </p>
          )}
        </section>
      )}

      {trigger.history.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">History</h2>
          <ol className="mt-2 space-y-2 text-sm">
            {trigger.history.map((h, i) => (
              <li key={i} className="rounded border border-zinc-200 bg-white p-3">
                <div className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{describe(h)}</span>
                  <span className="text-xs text-zinc-500">
                    {h.changedByName} · {when(h.changedAt)}
                  </span>
                </div>
                {h.reason && <p className="mt-1 whitespace-pre-wrap text-zinc-700">{h.reason}</p>}
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
