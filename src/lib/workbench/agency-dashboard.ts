import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type {
  BuilderProgressConfidence,
  FeeBillingPeriod,
  FeeCurrency,
  PresentationStatus,
  ProjectStatus,
  WorkstreamPromotionStatus,
  WorkstreamStatus,
} from '@/types/database'
import type { WorkbenchCallerContext } from './context'
import { shapePendingPromotions, type PendingWorkstreamPromotionRow } from './workstream-promotions'
import { getPlatformRatePct, monthlyEquivalent } from './client-billing'

// Builder agency dashboard (/agency, 2026-10-01, Mike): the platform owner
// is the admin, each builder agency is a curator, each builder is a
// consultant. A builder works from one workspace Project; each client
// proposal is a Workstream on it. When a client accepts, the builder
// requests promotion and the agency (or admin) approves it, which creates
// the client Project (workstream-promotions.ts). A curator sees their own
// builders (agency_builders roster); the admin sees every agency plus any
// builder not yet assigned to one, and assigns them. Each approved
// promotion is a "client project created" event, and each client Project's
// maintenance fee (client_project_fees) carries the platform's share --
// the billing view.
//
// Same consent-based, metadata-only posture as Builder Operations
// (builder-progress-updates.ts, docs/dev-request-builder-operations-and-
// progress-updates.md): names, statuses, counts, dates, and whatever
// progress update the builder chose to share. Never goal/details/
// objective, notebooks, conversations, artifacts or slides. The admin
// client is the query engine only -- every query below is scoped to the
// builders the caller is entitled to see before anything is read.

export type AgencyAttention = 'blocked' | 'help_requested' | 'at_risk'

export interface AgencySharedUpdate {
  workstreamName: string
  currentStage: string
  progress: string
  nextStep: string
  helpRequested: string | null
  confidence: BuilderProgressConfidence
  updatedAt: string
}

// A Workstream in the builder's workspace -- one client proposal.
export interface AgencyProposalRow {
  workstreamId: string
  name: string
  status: WorkstreamStatus
  presentationStatus: PresentationStatus | null
  promotionStatus: WorkstreamPromotionStatus | null
  lastActivityAt: string
  latestUpdate: AgencySharedUpdate | null
}

export interface AgencyClientFee {
  amount: number
  currency: FeeCurrency
  period: FeeBillingPeriod
  // The rate recorded with this fee, not necessarily today's.
  platformRatePct: number
  monthlyAmount: number
  platformMonthly: number
}

// A Project created from an approved promotion -- one paying client.
export interface AgencyClientProjectRow {
  id: string
  name: string
  status: ProjectStatus
  clientViewerCount: number
  fee: AgencyClientFee | null
  createdAt: string
  workstreamCount: number
  activeWorkstreamCount: number
  lastActivityAt: string
  latestUpdate: AgencySharedUpdate | null
}

export interface AgencyBuilderRow {
  builderId: string
  email: string | null
  fullName: string | null
  isActive: boolean
  agencyId: string | null
  proposals: AgencyProposalRow[]
  clientProjects: AgencyClientProjectRow[]
  pendingPromotions: PendingWorkstreamPromotionRow[]
  lastActivityAt: string | null
  attention: AgencyAttention | null
}

export interface AgencyGroup {
  agencyId: string
  email: string | null
  fullName: string | null
  builders: AgencyBuilderRow[]
}

export interface AgencyDashboard {
  viewerIsAdmin: boolean
  // Today's platform rate, applied to fees recorded from now on.
  platformRatePct: number
  agencies: AgencyGroup[]
  // Admin only -- builders with no agency_builders row yet.
  unassigned: AgencyBuilderRow[]
}

interface ProfileRow {
  id: string
  email: string | null
  full_name: string | null
  is_active: boolean
}

export interface AgencyDashboardInput {
  viewerIsAdmin: boolean
  agencies: ProfileRow[]
  builders: ProfileRow[]
  roster: { builder_id: string; agency_id: string }[]
  projects: { id: string; name: string; status: ProjectStatus; owner_id: string | null; updated_at: string }[]
  workstreams: { id: string; project_id: string; name: string; status: WorkstreamStatus; updated_at: string }[]
  updates: {
    workstream_id: string
    current_stage: string
    progress: string
    next_step: string
    help_requested: string | null
    confidence: BuilderProgressConfidence
    updated_at: string
  }[]
  presentations: { workstream_id: string; status: PresentationStatus }[]
  promotions: {
    id: string
    workstream_id: string
    submitted_by: string
    status: WorkstreamPromotionStatus
    client_emails: string[] | null
    proposed_fee_amount: number | null
    proposed_fee_currency: FeeCurrency | null
    proposed_fee_period: FeeBillingPeriod | null
    created_project_id: string | null
    decided_at: string | null
    created_at: string
  }[]
  viewerMembers: { project_id: string }[]
  fees: { project_id: string; amount: number; currency: FeeCurrency; billing_period: FeeBillingPeriod; platform_rate_pct: number }[]
  pendingPromotionRows: PendingWorkstreamPromotionRow[]
  platformRatePct: number
}

function laterOf(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return b > a ? b : a
}

function attentionFor(updates: AgencySharedUpdate[]): AgencyAttention | null {
  if (updates.some((u) => u.confidence === 'blocked')) return 'blocked'
  if (updates.some((u) => u.helpRequested)) return 'help_requested'
  if (updates.some((u) => u.confidence === 'at_risk')) return 'at_risk'
  return null
}

function byEmail(a: { email: string | null }, b: { email: string | null }) {
  return (a.email ?? '').localeCompare(b.email ?? '')
}

function newestFirst(a: { lastActivityAt: string }, b: { lastActivityAt: string }) {
  return b.lastActivityAt.localeCompare(a.lastActivityAt)
}

// Pure shaping, separate from the queries so it's testable on its own.
export function assembleAgencyDashboard(input: AgencyDashboardInput): AgencyDashboard {
  const updateByWorkstream = new Map(input.updates.map((u) => [u.workstream_id, u]))
  const presentationStatusByWorkstream = new Map(input.presentations.map((p) => [p.workstream_id, p.status]))

  function sharedUpdate(w: AgencyDashboardInput['workstreams'][number]): AgencySharedUpdate | null {
    const u = updateByWorkstream.get(w.id)
    if (!u) return null
    return {
      workstreamName: w.name,
      currentStage: u.current_stage,
      progress: u.progress,
      nextStep: u.next_step,
      helpRequested: u.help_requested,
      confidence: u.confidence,
      updatedAt: u.updated_at,
    }
  }

  // Latest promotion per workstream (a rejected one can be resubmitted).
  const promotionByWorkstream = new Map<string, AgencyDashboardInput['promotions'][number]>()
  for (const p of input.promotions) {
    const existing = promotionByWorkstream.get(p.workstream_id)
    if (!existing || p.created_at > existing.created_at) promotionByWorkstream.set(p.workstream_id, p)
  }
  const promotedAtByProject = new Map<string, string>()
  for (const p of input.promotions) {
    if (p.status === 'approved' && p.created_project_id) promotedAtByProject.set(p.created_project_id, p.decided_at ?? p.created_at)
  }

  const feeByProject = new Map<string, AgencyClientFee>()
  for (const f of input.fees) {
    // numeric columns can arrive as strings from PostgREST.
    const amount = Number(f.amount)
    const platformRatePct = Number(f.platform_rate_pct)
    const monthlyAmount = monthlyEquivalent(amount, f.billing_period)
    feeByProject.set(f.project_id, {
      amount,
      currency: f.currency,
      period: f.billing_period,
      platformRatePct,
      monthlyAmount,
      platformMonthly: (monthlyAmount * platformRatePct) / 100,
    })
  }

  const viewerCountByProject = new Map<string, number>()
  for (const m of input.viewerMembers) viewerCountByProject.set(m.project_id, (viewerCountByProject.get(m.project_id) ?? 0) + 1)

  const workstreamsByProject = new Map<string, AgencyDashboardInput['workstreams']>()
  for (const w of input.workstreams) {
    const list = workstreamsByProject.get(w.project_id) ?? []
    list.push(w)
    workstreamsByProject.set(w.project_id, list)
  }

  const proposalsByOwner = new Map<string, AgencyProposalRow[]>()
  const clientProjectsByOwner = new Map<string, AgencyClientProjectRow[]>()
  for (const p of input.projects) {
    if (!p.owner_id) continue
    const workstreams = workstreamsByProject.get(p.id) ?? []
    const promotedAt = promotedAtByProject.get(p.id)

    if (promotedAt) {
      let lastActivityAt = p.updated_at
      let latestUpdate: AgencySharedUpdate | null = null
      for (const w of workstreams) {
        lastActivityAt = laterOf(lastActivityAt, w.updated_at)!
        const u = sharedUpdate(w)
        if (u && (!latestUpdate || u.updatedAt > latestUpdate.updatedAt)) latestUpdate = u
      }
      const list = clientProjectsByOwner.get(p.owner_id) ?? []
      list.push({
        id: p.id,
        name: p.name,
        status: p.status,
        clientViewerCount: viewerCountByProject.get(p.id) ?? 0,
        fee: feeByProject.get(p.id) ?? null,
        createdAt: promotedAt,
        workstreamCount: workstreams.length,
        activeWorkstreamCount: workstreams.filter((w) => w.status === 'active').length,
        lastActivityAt,
        latestUpdate,
      })
      clientProjectsByOwner.set(p.owner_id, list)
    } else {
      // The builder's workspace: each non-archived workstream is a proposal.
      const list = proposalsByOwner.get(p.owner_id) ?? []
      for (const w of workstreams) {
        if (w.status === 'archived') continue
        list.push({
          workstreamId: w.id,
          name: w.name,
          status: w.status,
          presentationStatus: presentationStatusByWorkstream.get(w.id) ?? null,
          promotionStatus: promotionByWorkstream.get(w.id)?.status ?? null,
          lastActivityAt: w.updated_at,
          latestUpdate: sharedUpdate(w),
        })
      }
      proposalsByOwner.set(p.owner_id, list)
    }
  }

  const promotionSubmitterById = new Map(input.promotions.map((p) => [p.id, p.submitted_by]))
  const pendingByBuilder = new Map<string, PendingWorkstreamPromotionRow[]>()
  for (const row of input.pendingPromotionRows) {
    const builderId = promotionSubmitterById.get(row.id)
    if (!builderId) continue
    const list = pendingByBuilder.get(builderId) ?? []
    list.push(row)
    pendingByBuilder.set(builderId, list)
  }

  const agencyByBuilder = new Map(input.roster.map((r) => [r.builder_id, r.agency_id]))

  const builderRows: AgencyBuilderRow[] = input.builders.map((b) => {
    const proposals = (proposalsByOwner.get(b.id) ?? []).sort(newestFirst)
    const clientProjects = (clientProjectsByOwner.get(b.id) ?? []).sort(newestFirst)
    const all = [...proposals, ...clientProjects]
    return {
      builderId: b.id,
      email: b.email,
      fullName: b.full_name,
      isActive: b.is_active,
      agencyId: agencyByBuilder.get(b.id) ?? null,
      proposals,
      clientProjects,
      pendingPromotions: pendingByBuilder.get(b.id) ?? [],
      lastActivityAt: all.reduce<string | null>((latest, r) => laterOf(latest, r.lastActivityAt), null),
      attention: attentionFor(all.flatMap((r) => (r.latestUpdate ? [r.latestUpdate] : []))),
    }
  })
  builderRows.sort(byEmail)

  const agencies: AgencyGroup[] = [...input.agencies].sort(byEmail).map((a) => ({
    agencyId: a.id,
    email: a.email,
    fullName: a.full_name,
    builders: builderRows.filter((b) => b.agencyId === a.id),
  }))

  return {
    viewerIsAdmin: input.viewerIsAdmin,
    platformRatePct: input.platformRatePct,
    agencies,
    unassigned: input.viewerIsAdmin ? builderRows.filter((b) => !b.agencyId) : [],
  }
}

export async function getAgencyDashboard(ctx: WorkbenchCallerContext): Promise<AgencyDashboard> {
  const viewerIsAdmin = ctx.profile.role === 'admin'
  if (!viewerIsAdmin && ctx.profile.role !== 'curator') {
    throw new AuthError('Requires curator or admin role to view the agency dashboard')
  }

  const admin = createAdminClient()
  const profileColumns = 'id, email, full_name, is_active'

  const rosterQuery = admin.from('agency_builders').select('builder_id, agency_id')
  const { data: roster, error: rosterError } = viewerIsAdmin ? await rosterQuery : await rosterQuery.eq('agency_id', ctx.user.id)
  if (rosterError) throw rosterError

  let agencies: ProfileRow[]
  let builders: ProfileRow[]
  if (viewerIsAdmin) {
    const [{ data: curatorRows, error: curatorError }, { data: builderRows, error: builderError }] = await Promise.all([
      // The platform admin can run an agency too (agency_builders).
      admin.from('profiles').select(profileColumns).in('role', ['curator', 'admin']),
      admin.from('profiles').select(profileColumns).eq('role', 'consultant'),
    ])
    if (curatorError) throw curatorError
    if (builderError) throw builderError
    agencies = curatorRows ?? []
    builders = builderRows ?? []
  } else {
    agencies = [{ id: ctx.user.id, email: ctx.profile.email, full_name: ctx.profile.full_name, is_active: ctx.profile.is_active }]
    const builderIds = (roster ?? []).map((r) => r.builder_id)
    if (builderIds.length === 0) {
      builders = []
    } else {
      const { data, error } = await admin.from('profiles').select(profileColumns).eq('role', 'consultant').in('id', builderIds)
      if (error) throw error
      builders = data ?? []
    }
  }

  const builderIds = builders.map((b) => b.id)
  let projects: AgencyDashboardInput['projects'] = []
  let promotions: AgencyDashboardInput['promotions'] = []
  if (builderIds.length > 0) {
    const [{ data: projectRows, error: projectError }, { data: promotionRows, error: promotionError }] = await Promise.all([
      admin.from('projects').select('id, name, status, owner_id, updated_at').in('owner_id', builderIds).neq('status', 'archived'),
      admin
        .from('workstream_promotions')
        .select(
          'id, workstream_id, submitted_by, status, client_emails, proposed_fee_amount, proposed_fee_currency, proposed_fee_period, created_project_id, decided_at, created_at'
        )
        .in('submitted_by', builderIds),
    ])
    if (projectError) throw projectError
    if (promotionError) throw promotionError
    projects = projectRows ?? []
    promotions = promotionRows ?? []
  }

  const projectIds = projects.map((p) => p.id)
  let workstreams: AgencyDashboardInput['workstreams'] = []
  let viewerMembers: AgencyDashboardInput['viewerMembers'] = []
  let fees: AgencyDashboardInput['fees'] = []
  if (projectIds.length > 0) {
    const [{ data: workstreamRows, error: workstreamError }, { data: memberRows, error: memberError }, { data: feeRows, error: feeError }] =
      await Promise.all([
        admin.from('project_workstreams').select('id, project_id, name, status, updated_at').in('project_id', projectIds),
        admin.from('project_members').select('project_id').in('project_id', projectIds).eq('role', 'viewer').eq('status', 'active'),
        admin.from('client_project_fees').select('project_id, amount, currency, billing_period, platform_rate_pct').in('project_id', projectIds),
      ])
    if (workstreamError) throw workstreamError
    if (memberError) throw memberError
    if (feeError) throw feeError
    workstreams = workstreamRows ?? []
    viewerMembers = memberRows ?? []
    fees = feeRows ?? []
  }

  const workstreamIds = workstreams.map((w) => w.id)
  let updates: AgencyDashboardInput['updates'] = []
  let presentations: AgencyDashboardInput['presentations'] = []
  if (workstreamIds.length > 0) {
    const [{ data: updateRows, error: updateError }, { data: presentationRows, error: presentationError }] = await Promise.all([
      admin
        .from('builder_progress_updates')
        .select('workstream_id, current_stage, progress, next_step, help_requested, confidence, updated_at')
        .in('workstream_id', workstreamIds)
        .eq('status', 'active'),
      admin.from('presentations').select('workstream_id, status').in('workstream_id', workstreamIds),
    ])
    if (updateError) throw updateError
    if (presentationError) throw presentationError
    updates = updateRows ?? []
    presentations = presentationRows ?? []
  }

  const [pendingPromotionRows, platformRatePct] = await Promise.all([
    shapePendingPromotions(promotions.filter((p) => p.status === 'pending')),
    getPlatformRatePct(admin),
  ])

  return assembleAgencyDashboard({
    viewerIsAdmin,
    agencies,
    builders,
    roster: roster ?? [],
    projects,
    workstreams,
    updates,
    presentations,
    promotions,
    viewerMembers,
    fees,
    pendingPromotionRows,
    platformRatePct,
  })
}

// Admin only. agencyId null removes the builder from their agency.
export async function assignBuilderToAgency(ctx: WorkbenchCallerContext, builderId: string, agencyId: string | null): Promise<void> {
  if (ctx.profile.role !== 'admin') throw new AuthError('Only the platform admin can assign builders to agencies')

  if (agencyId === null) {
    const { error } = await ctx.supabase.from('agency_builders').delete().eq('builder_id', builderId)
    if (error) throw error
    return
  }

  const { data: people, error: peopleError } = await ctx.supabase.from('profiles').select('id, role').in('id', [builderId, agencyId])
  if (peopleError) throw peopleError
  const roleById = new Map((people ?? []).map((p) => [p.id, p.role]))
  if (roleById.get(builderId) !== 'consultant') throw new ProjectValidationError('Only a builder (consultant) account can join an agency')
  const agencyRole = roleById.get(agencyId)
  if (agencyRole !== 'curator' && agencyRole !== 'admin') throw new ProjectValidationError('An agency must be a curator or admin account')

  const { error } = await ctx.supabase
    .from('agency_builders')
    .upsert({ builder_id: builderId, agency_id: agencyId, assigned_by: ctx.user.id }, { onConflict: 'builder_id' })
  if (error) throw error
}
