'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { AgencyAttention, AgencyBuilderRow, AgencyDashboard, AgencyProjectRow } from '@/lib/workbench/agency-dashboard'
import type { ProjectStatus } from '@/types/database'
import { AssignAgencySelect } from './AssignAgencySelect'

// Same display relabeling as ProjectStatusSection.tsx's own pipeline.
const STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Initial Draft',
  active: 'Working on it',
  review: 'For Approval',
  completed: 'Approved',
  archived: 'Archived',
}
const STATUS_STYLES: Record<ProjectStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  active: 'bg-amber-100 text-amber-800',
  review: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  archived: 'bg-zinc-200 text-zinc-500',
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

function ProjectRow({ project, linkable }: { project: AgencyProjectRow; linkable: boolean }) {
  const u = project.latestUpdate
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
          {project.activeWorkstreamCount} active of {project.workstreamCount} workstream{project.workstreamCount === 1 ? '' : 's'}
        </div>
      </td>
      <td className="py-2 pr-3">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[project.status]}`}>
          {STATUS_LABELS[project.status]}
        </span>
      </td>
      <td className="py-2 pr-3 text-xs">
        {u ? (
          <div className="flex flex-col gap-0.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium text-zinc-700">{u.currentStage}</span>
              <span className={`rounded-full px-2 py-0.5 ${CONFIDENCE_STYLES[u.confidence]}`}>{CONFIDENCE_LABELS[u.confidence]}</span>
            </div>
            <span className="text-zinc-600">{u.progress}</span>
            <span className="text-zinc-500">Next: {u.nextStep}</span>
            {u.helpRequested && <span className="text-red-700">Help: {u.helpRequested}</span>}
          </div>
        ) : (
          <span className="text-zinc-400">No update shared</span>
        )}
      </td>
      <td className="whitespace-nowrap py-2 text-right text-xs text-zinc-500">{formatDate(project.lastActivityAt)}</td>
    </tr>
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
          {builder.attention && (
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ATTENTION_STYLES[builder.attention]}`}>
              {ATTENTION_LABELS[builder.attention]}
            </span>
          )}
          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${builder.isActive ? 'bg-green-100 text-green-800' : 'bg-zinc-200 text-zinc-600'}`}>
            {builder.isActive ? 'Active' : 'Inactive'}
          </span>
          {viewerIsAdmin && <AssignAgencySelect builderId={builder.builderId} agencyId={builder.agencyId} options={agencyOptions} />}
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {builder.projects.length} client project{builder.projects.length === 1 ? '' : 's'} · last activity {formatDate(builder.lastActivityAt)}
      </p>
      {builder.projects.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-zinc-500">
              <tr>
                <th className="pb-1 pr-3 font-medium">Client project</th>
                <th className="pb-1 pr-3 font-medium">Status</th>
                <th className="pb-1 pr-3 font-medium">Latest shared update</th>
                <th className="pb-1 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {builder.projects.map((p) => (
                <ProjectRow key={p.id} project={p} linkable={viewerIsAdmin} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </li>
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
  const { viewerIsAdmin, agencies, unassigned } = dashboard

  const allBuilders = [...agencies.flatMap((a) => a.builders), ...unassigned]
  const allProjects = allBuilders.flatMap((b) => b.projects)
  const agencyOptions = agencies.map((a) => ({ id: a.agencyId, label: a.fullName || a.email || a.agencyId }))
  const visible = (builders: AgencyBuilderRow[]) => (attentionOnly ? builders.filter((b) => b.attention) : builders)

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
        <Stat label="Client projects" value={allProjects.length} />
        <Stat label="Working on it" value={allProjects.filter((p) => p.status === 'active').length} />
        <Stat label="For approval" value={allProjects.filter((p) => p.status === 'review').length} />
        <Stat label="Builders needing attention" value={allBuilders.filter((b) => b.attention).length} />
      </div>

      <label className="flex w-fit items-center gap-2 text-sm text-zinc-600">
        <input type="checkbox" checked={attentionOnly} onChange={(e) => setAttentionOnly(e.target.checked)} />
        Only builders who are blocked, at risk or asking for help
      </label>

      {sections.length === 0 && <p className="text-sm text-zinc-500">No agencies yet. Create a curator account for each builder agency.</p>}

      {sections.map((section) => {
        const builders = visible(section.builders)
        return (
          <section key={section.key} className="flex flex-col gap-2">
            <div>
              <h2 className="text-base font-semibold">{section.title}</h2>
              {section.subtitle && <p className="text-xs text-zinc-500">{section.subtitle}</p>}
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
