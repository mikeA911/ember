'use client'

import { useState } from 'react'
import Link from 'next/link'
import type {
  AgencyAttention,
  AgencyBuilderRow,
  AgencyClientProjectRow,
  AgencyDashboard,
  AgencyProposalRow,
  AgencySharedUpdate,
} from '@/lib/workbench/agency-dashboard'
import type { PresentationStatus, WorkstreamPromotionStatus, WorkstreamStatus } from '@/types/database'
import { WorkstreamPromotionsReview } from '@/components/projects/WorkstreamPromotionsReview'
import { AssignAgencySelect } from './AssignAgencySelect'
import { PROJECT_STATUS_LABELS, PROJECT_STATUS_STYLES } from '@/lib/projects/status-labels'
import { ClientFeeEditor } from './ClientFeeEditor'
import { PlatformRateForm } from './PlatformRateForm'
import { formatMoney, monthlyTotals } from './money'


const WORKSTREAM_STATUS_LABELS: Record<WorkstreamStatus, string> = {
  draft: 'Draft',
  active: 'In progress',
  completed: 'Completed',
  archived: 'Archived',
}

const PRESENTATION_LABELS: Record<PresentationStatus, string> = {
  draft: 'Proposal drafted',
  review_open: 'Proposal in review',
  review_closed: 'Review closed',
  builder_revision: 'Revising proposal',
  curator_review: 'Proposal with curator',
  approved: 'Proposal approved',
}

const PROMOTION_LABELS: Record<WorkstreamPromotionStatus, string> = {
  pending: 'Client project requested',
  approved: 'Client project created',
  rejected: 'Request declined',
}
const PROMOTION_STYLES: Record<WorkstreamPromotionStatus, string> = {
  pending: 'bg-blue-100 text-blue-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-zinc-200 text-zinc-600',
}

const CONFIDENCE_LABELS: Record<string, string> = { on_track: 'On track', at_risk: 'At risk', blocked: 'Blocked' }
const CONFIDENCE_STYLES: Record<string, string> = {
  on_track: 'bg-green-100 text-green-800',
  at_risk: 'bg-amber-100 text-amber-800',
  blocked: 'bg-red-100 text-red-800',
}

const ATTENTION_LABELS: Record<AgencyAttention, string> = { blocked: 'Blocked', help_requested: 'Help requested', at_risk: 'At risk' }
const ATTENTION_STYLES: Record<AgencyAttention, string> = {
  blocked: 'bg-red-100 text-red-800',
  help_requested: 'bg-red-100 text-red-800',
  at_risk: 'bg-amber-100 text-amber-800',
}

function formatDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString() : '—'
}

function isThisMonth(iso: string) {
  const d = new Date(iso)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

function Pill({ className, children }: { className: string; children: React.ReactNode }) {
  return <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>{children}</span>
}

function SharedUpdate({ update }: { update: AgencySharedUpdate | null }) {
  if (!update) return <span className="text-zinc-400">No update shared</span>
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-medium text-zinc-700">{update.currentStage}</span>
        <span className={`rounded-full px-2 py-0.5 ${CONFIDENCE_STYLES[update.confidence]}`}>{CONFIDENCE_LABELS[update.confidence]}</span>
      </div>
      <span className="text-zinc-600">{update.progress}</span>
      <span className="text-zinc-500">Next: {update.nextStep}</span>
      {update.helpRequested && <span className="text-red-700">Help: {update.helpRequested}</span>}
    </div>
  )
}

function ProposalRow({ proposal }: { proposal: AgencyProposalRow }) {
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="py-2 pr-3 font-medium">{proposal.name}</td>
      <td className="py-2 pr-3">
        <div className="flex flex-col items-start gap-1">
          {proposal.promotionStatus ? (
            <Pill className={PROMOTION_STYLES[proposal.promotionStatus]}>{PROMOTION_LABELS[proposal.promotionStatus]}</Pill>
          ) : proposal.presentationStatus ? (
            <Pill className="bg-zinc-100 text-zinc-700">{PRESENTATION_LABELS[proposal.presentationStatus]}</Pill>
          ) : (
            <Pill className="bg-zinc-100 text-zinc-700">{WORKSTREAM_STATUS_LABELS[proposal.status]}</Pill>
          )}
        </div>
      </td>
      <td className="py-2 pr-3 text-xs">
        <SharedUpdate update={proposal.latestUpdate} />
      </td>
      <td className="whitespace-nowrap py-2 text-right text-xs text-zinc-500">{formatDate(proposal.lastActivityAt)}</td>
    </tr>
  )
}

function ClientProjectRow({ project, linkable }: { project: AgencyClientProjectRow; linkable: boolean }) {
  return (
    <tr className="border-t border-zinc-100 align-top">
      <td className="py-2 pr-3">
        {linkable ? (
          <Link href={`/projects/${project.id}`} className="font-medium underline">
            {project.name}
          </Link>
        ) : (
          <span className="font-medium">{project.name}</span>
        )}
        <div className="mt-0.5 text-xs text-zinc-500">
          Created {formatDate(project.createdAt)} · {project.clientViewerCount} client viewer{project.clientViewerCount === 1 ? '' : 's'} ·{' '}
          {project.activeWorkstreamCount} of {project.workstreamCount} workstream{project.workstreamCount === 1 ? '' : 's'} active
        </div>
      </td>
      <td className="py-2 pr-3">
        <Pill className={PROJECT_STATUS_STYLES[project.status]}>{PROJECT_STATUS_LABELS[project.status]}</Pill>
      </td>
      <td className="py-2 pr-3">
        <ClientFeeEditor projectId={project.id} fee={project.fee} />
      </td>
      <td className="py-2 pr-3 text-xs">
        <SharedUpdate update={project.latestUpdate} />
      </td>
      <td className="whitespace-nowrap py-2 text-right text-xs text-zinc-500">{formatDate(project.lastActivityAt)}</td>
    </tr>
  )
}

function RowTable({ heading, withFee = false, children }: { heading: string; withFee?: boolean; children: React.ReactNode }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr>
            <th className="w-1/3 pb-1 pr-3 font-medium">{heading}</th>
            <th className="pb-1 pr-3 font-medium">Status</th>
            {withFee && <th className="pb-1 pr-3 font-medium">Maintenance fee</th>}
            <th className="pb-1 pr-3 font-medium">Latest shared update</th>
            <th className="pb-1 text-right font-medium">Updated</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

function BuilderCard({
  builder,
  viewerIsAdmin,
  agencyOptions,
}: {
  builder: AgencyBuilderRow
  viewerIsAdmin: boolean
  agencyOptions: { id: string; label: string }[]
}) {
  return (
    <li className="rounded border border-zinc-200 bg-white p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-medium">{builder.fullName || builder.email || builder.builderId}</div>
          {builder.fullName && builder.email && <div className="truncate text-xs text-zinc-500">{builder.email}</div>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {builder.attention && <Pill className={ATTENTION_STYLES[builder.attention]}>{ATTENTION_LABELS[builder.attention]}</Pill>}
          <Pill className={builder.isActive ? 'bg-green-100 text-green-800' : 'bg-zinc-200 text-zinc-600'}>{builder.isActive ? 'Active' : 'Inactive'}</Pill>
          {viewerIsAdmin && <AssignAgencySelect builderId={builder.builderId} agencyId={builder.agencyId} options={agencyOptions} />}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {builder.proposals.length} proposal{builder.proposals.length === 1 ? '' : 's'} · {builder.clientProjects.length} client project
        {builder.clientProjects.length === 1 ? '' : 's'} · last activity {formatDate(builder.lastActivityAt)}
      </p>

      {builder.pendingPromotions.length > 0 && (
        <div className="mt-2 flex flex-col gap-1">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-blue-700">Waiting for a client project</h4>
          <WorkstreamPromotionsReview promotions={builder.pendingPromotions} />
        </div>
      )}

      {builder.clientProjects.length > 0 && (
        <RowTable heading="Client project" withFee>
          {builder.clientProjects.map((p) => (
            <ClientProjectRow key={p.id} project={p} linkable={viewerIsAdmin} />
          ))}
        </RowTable>
      )}
      {builder.proposals.length > 0 && (
        <RowTable heading="Proposal (workspace)">
          {builder.proposals.map((p) => (
            <ProposalRow key={p.workstreamId} proposal={p} />
          ))}
        </RowTable>
      )}
    </li>
  )
}

// Monthly client fees and the platform's share, one line per currency --
// annual fees count as a twelfth per month.
function FeeTotals({ projects }: { projects: AgencyClientProjectRow[] }) {
  const totals = monthlyTotals(projects.flatMap((p) => (p.fee ? [p.fee] : [])))
  const unpriced = projects.filter((p) => !p.fee).length
  if (totals.length === 0 && unpriced === 0) return null
  return (
    <div className="flex flex-col gap-1 rounded border border-zinc-200 bg-white px-3 py-2 text-sm">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Maintenance fees per month</h2>
      {totals.map(([currency, t]) => (
        <div key={currency} className="flex flex-wrap gap-x-4">
          <span>
            Client fees <span className="font-semibold">{formatMoney(t.clientMonthly, currency)}</span>
          </span>
          <span>
            Platform share <span className="font-semibold">{formatMoney(t.platformMonthly, currency)}</span>
          </span>
        </div>
      ))}
      {unpriced > 0 && (
        <p className="text-xs text-zinc-500">
          {unpriced} client project{unpriced === 1 ? ' has' : 's have'} no fee recorded yet.
        </p>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-zinc-200 bg-white px-3 py-2">
      <div className="text-xl font-semibold">{value}</div>
      <div className="text-xs text-zinc-500">{label}</div>
    </div>
  )
}

export function AgencyDashboardView({ dashboard }: { dashboard: AgencyDashboard }) {
  const [attentionOnly, setAttentionOnly] = useState(false)
  const { viewerIsAdmin, agencies, unassigned, platformRatePct } = dashboard

  const allBuilders = [...agencies.flatMap((a) => a.builders), ...unassigned]
  const allClientProjects = allBuilders.flatMap((b) => b.clientProjects)
  const agencyOptions = agencies.map((a) => ({ id: a.agencyId, label: a.fullName || a.email || a.agencyId }))
  const needsAction = (b: AgencyBuilderRow) => !!b.attention || b.pendingPromotions.length > 0
  const visible = (builders: AgencyBuilderRow[]) => (attentionOnly ? builders.filter(needsAction) : builders)

  const sections = [
    ...agencies.map((a) => ({ key: a.agencyId, title: a.fullName || a.email || 'Agency', subtitle: a.fullName ? a.email : null, builders: a.builders })),
    ...(viewerIsAdmin && unassigned.length > 0
      ? [{ key: 'unassigned', title: 'Not assigned to an agency', subtitle: null, builders: unassigned }]
      : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Stat label="Builders" value={allBuilders.length} />
        <Stat label="Open proposals" value={allBuilders.flatMap((b) => b.proposals).filter((p) => p.promotionStatus !== 'approved').length} />
        <Stat label="Client project requests" value={allBuilders.reduce((n, b) => n + b.pendingPromotions.length, 0)} />
        <Stat label="Client projects created this month" value={allClientProjects.filter((p) => isThisMonth(p.createdAt)).length} />
        <Stat label="Client projects in total" value={allClientProjects.length} />
      </div>

      <FeeTotals projects={allClientProjects} />
      {viewerIsAdmin && <PlatformRateForm current={platformRatePct} />}

      <label className="flex w-fit items-center gap-2 text-sm text-zinc-600">
        <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
        Only builders waiting on a decision, blocked, at risk or asking for help
      </label>

      {sections.length === 0 && <p className="text-sm text-zinc-500">No agencies yet. Create a curator account for each builder agency.</p>}

      {sections.map((section) => {
        const builders = visible(section.builders)
        const created = section.builders.flatMap((b) => b.clientProjects)
        return (
          <section key={section.key} className="flex flex-col gap-2">
            <div>
              <h2 className="text-base font-semibold">{section.title}</h2>
              <p className="text-xs text-zinc-500">
                {section.subtitle ? `${section.subtitle} · ` : ''}
                {created.length} client project{created.length === 1 ? '' : 's'} created, {created.filter((p) => isThisMonth(p.createdAt)).length} this month
                {monthlyTotals(created.flatMap((p) => (p.fee ? [p.fee] : []))).map(
                  ([currency, t]) =>
                    ` · ${formatMoney(t.clientMonthly, currency)}/mo in fees, platform share ${formatMoney(t.platformMonthly, currency)}/mo`
                )}
              </p>
            </div>
            {builders.length === 0 ? (
              <p className="text-sm text-zinc-500">
                {section.builders.length === 0
                  ? viewerIsAdmin
                    ? 'No builders assigned yet.'
                    : 'No builders assigned to your agency yet -- ask the platform admin to add them.'
                  : 'Nobody here needs attention right now.'}
              </p>
            ) : (
              <ul className="flex flex-col gap-2">
                {builders.map((b) => (
                  <BuilderCard key={b.builderId} builder={b} viewerIsAdmin={viewerIsAdmin} agencyOptions={agencyOptions} />
                ))}
              </ul>
            )}
          </section>
        )
      })}
    </div>
  )
}
