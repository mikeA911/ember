import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type {
  BuilderProgressConfidence,
  FeeBillingPeriod,
  FeeCurrency,
  PortfolioCategory,
  PresentationStatus,
  ProjectStatus,
  WorkstreamPromotionStatus,
  WorkstreamDeliverable,
  WorkstreamStatus,
} from '@/types/database'
import type { WorkbenchCallerContext } from './context'
import { shapePendingPromotions, type PendingWorkstreamPromotionRow } from './workstream-promotions'
import { DEFAULT_BUILDER_SHARE_PCT, getBillingRates, monthlyEquivalent } from './client-billing'
import { CATEGORY_ORDER } from '@/lib/projects/portfolio-categories'
import { getBuilderSpendSummaries, type BuilderSpendSummary } from '@/lib/ai'

// Builder agency dashboard (/agency, 2026-10-01, Mike): the platform owner
// is the admin, each builder agency is a curator, each builder is a
// consultant. A builder works from a workspace Project; each client
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
// progress update the builder chose to share -- plus, for the management
// view (2026-10-03), each project's workstreams, the knowledge bases
// attached to them (names only) and a completion percentage computed from
// deliverable checklist counts, never the deliverable labels -- and each
// builder's AI budget (allowance, credits, spend this period), which the
// agency manages (metering.ts). Never goal/details/
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

// Share of the work checked off. Each deliverable on a workstream's
// checklist is one item; a workstream with no checklist counts as a single
// item, done once the workstream is completed. pct is null with no items.
export interface AgencyCompletion {
  done: number
  total: number
  pct: number | null
}

export interface AgencyWorkstreamRow {
  id: string
  name: string
  status: WorkstreamStatus
  completion: AgencyCompletion
  // Names of knowledge bases attached to this workstream itself.
  knowledgeBases: string[]
}

// A Workstream in the builder's workspace -- one client proposal.
export interface AgencyProposalRow {
  workstreamId: string
  name: string
  status: WorkstreamStatus
  presentationStatus: PresentationStatus | null
  promotionStatus: WorkstreamPromotionStatus | null
  // The builder workspace's own portfolio category.
  category: PortfolioCategory
  completion: AgencyCompletion
  knowledgeBases: string[]
  lastActivityAt: string
  latestUpdate: AgencySharedUpdate | null
}

export interface AgencyClientFee {
  amount: number
  currency: FeeCurrency
  period: FeeBillingPeriod
  // The rate recorded with this fee, not necessarily today's.
  platformRatePct: number
  // The builder's share -- an employee's bonus -- recorded with this fee.
  builderSharePct: number
  monthlyAmount: number
  platformMonthly: number
  builderMonthly: number
}

// A Project created from an approved promotion -- one paying client.
export interface AgencyClientProjectRow {
  id: string
  name: string
  status: ProjectStatus
  category: PortfolioCategory
  clientViewerCount: number
  fee: AgencyClientFee | null
  createdAt: string
  workstreamCount: number
  activeWorkstreamCount: number
  // Non-archived workstreams, in name order.
  workstreams: AgencyWorkstreamRow[]
  // Names of knowledge bases attached at the project level.
  knowledgeBases: string[]
  completion: AgencyCompletion
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
  // null when the dashboard was assembled without spend (tests, fixtures).
  spend: BuilderSpendSummary | null
  // This builder's own share of maintenance fees (builder_billing_shares);
  // null means the deployment default.
  sharePct: number | null
}

export interface AgencyGroup {
  agencyId: string
  email: string | null
  fullName: string | null
  builders: AgencyBuilderRow[]
}

// Completion rolled up per portfolio category (Foundation, Builder Lab,
// ...) across every client project and proposal on the dashboard.
export interface AgencyCategoryCompletion {
  category: PortfolioCategory
  clientProjectCount: number
  proposalCount: number
  workstreamCount: number
  completion: AgencyCompletion
}

export interface AgencyDashboard {
  viewerIsAdmin: boolean
  // Today's platform rate and builder's share, applied to fees recorded
  // from now on.
  platformRatePct: number
  builderSharePct: number
  agencies: AgencyGroup[]
  // Admin only -- builders with no agency_builders row yet.
  unassigned: AgencyBuilderRow[]
  // In category order; only categories with work in them.
  completionByCategory: AgencyCategoryCompletion[]
  overallCompletion: AgencyCompletion
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
  projects: {
    id: string
    name: string
    status: ProjectStatus
    owner_id: string | null
    updated_at: string
    // Optional so fixtures can omit it; missing reads as 'other'.
    portfolio_category?: PortfolioCategory | null
  }[]
  workstreams: {
    id: string
    project_id: string
    name: string
    status: WorkstreamStatus
    updated_at: string
    deliverables?: WorkstreamDeliverable[] | null
  }[]
  projectKnowledgeBases: { project_id: string; knowledge_base_id: string }[]
  workstreamKnowledgeBases: { workstream_id: string; knowledge_base_id: string }[]
  knowledgeBases: { id: string; name: string }[]
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
  fees: {
    project_id: string
    amount: number
    currency: FeeCurrency
    billing_period: FeeBillingPeriod
    platform_rate_pct: number
    // Optional so fixtures can omit it; missing reads as 0.
    builder_share_pct?: number
  }[]
  pendingPromotionRows: PendingWorkstreamPromotionRow[]
  platformRatePct: number
  builderSharePct?: number
  spendByBuilder?: Map<string, BuilderSpendSummary>
  // Optional so fixtures can omit it.
  builderShares?: { builder_id: string; share_pct: number }[]
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

function completionOf(items: { done: number; total: number }[]): AgencyCompletion {
  const done = items.reduce((n, i) => n + i.done, 0)
  const total = items.reduce((n, i) => n + i.total, 0)
  return { done, total, pct: total > 0 ? Math.round((done / total) * 100) : null }
}

export function workstreamCompletion(w: { status: WorkstreamStatus; deliverables?: WorkstreamDeliverable[] | null }): AgencyCompletion {
  const deliverables = w.deliverables ?? []
  if (deliverables.length === 0) return completionOf([{ done: w.status === 'completed' ? 1 : 0, total: 1 }])
  return completionOf([{ done: deliverables.filter((d) => d.completed).length, total: deliverables.length }])
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

  const kbNameById = new Map(input.knowledgeBases.map((kb) => [kb.id, kb.name]))
  function kbNames<K extends string>(links: ({ knowledge_base_id: string } & Record<K, string>)[], key: K): Map<string, string[]> {
    const byOwner = new Map<string, string[]>()
    for (const l of links) {
      const name = kbNameById.get(l.knowledge_base_id)
      if (!name) continue
      const list = byOwner.get(l[key]) ?? []
      if (!list.includes(name)) list.push(name)
      byOwner.set(l[key], list)
    }
    for (const list of byOwner.values()) list.sort((a, b) => a.localeCompare(b))
    return byOwner
  }
  const kbNamesByProject = kbNames(input.projectKnowledgeBases, 'project_id')
  const kbNamesByWorkstream = kbNames(input.workstreamKnowledgeBases, 'workstream_id')

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
    const builderSharePct = Number(f.builder_share_pct ?? 0)
    const monthlyAmount = monthlyEquivalent(amount, f.billing_period)
    feeByProject.set(f.project_id, {
      amount,
      currency: f.currency,
      period: f.billing_period,
      platformRatePct,
      builderSharePct,
      monthlyAmount,
      platformMonthly: (monthlyAmount * platformRatePct) / 100,
      builderMonthly: (monthlyAmount * builderSharePct) / 100,
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
      const liveWorkstreams = workstreams.filter((w) => w.status !== 'archived').sort((a, b) => a.name.localeCompare(b.name))
      const workstreamRows = liveWorkstreams.map((w) => ({
        id: w.id,
        name: w.name,
        status: w.status,
        completion: workstreamCompletion(w),
        knowledgeBases: kbNamesByWorkstream.get(w.id) ?? [],
      }))
      const list = clientProjectsByOwner.get(p.owner_id) ?? []
      list.push({
        id: p.id,
        name: p.name,
        status: p.status,
        category: p.portfolio_category ?? 'other',
        clientViewerCount: viewerCountByProject.get(p.id) ?? 0,
        fee: feeByProject.get(p.id) ?? null,
        createdAt: promotedAt,
        workstreamCount: workstreams.length,
        activeWorkstreamCount: workstreams.filter((w) => w.status === 'active').length,
        workstreams: workstreamRows,
        knowledgeBases: kbNamesByProject.get(p.id) ?? [],
        completion: completionOf(workstreamRows.map((w) => w.completion)),
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
          category: p.portfolio_category ?? 'other',
          completion: workstreamCompletion(w),
          // The workspace's own KBs back every proposal in it.
          knowledgeBases: [...new Set([...(kbNamesByProject.get(p.id) ?? []), ...(kbNamesByWorkstream.get(w.id) ?? [])])].sort((a, b) =>
            a.localeCompare(b)
          ),
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

  const shareByBuilder = new Map((input.builderShares ?? []).map((r) => [r.builder_id, Number(r.share_pct)]))
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
      spend: input.spendByBuilder?.get(b.id) ?? null,
      sharePct: shareByBuilder.get(b.id) ?? null,
    }
  })
  builderRows.sort(byEmail)

  const agencies: AgencyGroup[] = [...input.agencies].sort(byEmail).map((a) => ({
    agencyId: a.id,
    email: a.email,
    fullName: a.full_name,
    builders: builderRows.filter((b) => b.agencyId === a.id),
  }))

  const unassigned = input.viewerIsAdmin ? builderRows.filter((b) => !b.agencyId) : []
  const shown = [...agencies.flatMap((a) => a.builders), ...unassigned]
  const byCategory = new Map<PortfolioCategory, { clientProjectCount: number; proposalCount: number; workstreamCount: number; items: AgencyCompletion[] }>()
  const bucket = (c: PortfolioCategory) => {
    const b = byCategory.get(c) ?? { clientProjectCount: 0, proposalCount: 0, workstreamCount: 0, items: [] }
    byCategory.set(c, b)
    return b
  }
  for (const b of shown) {
    for (const p of b.clientProjects) {
      const cat = bucket(p.category)
      cat.clientProjectCount++
      cat.workstreamCount += p.workstreams.length
      cat.items.push(p.completion)
    }
    for (const p of b.proposals) {
      const cat = bucket(p.category)
      cat.proposalCount++
      cat.workstreamCount++
      cat.items.push(p.completion)
    }
  }
  const completionByCategory = CATEGORY_ORDER.flatMap((category) => {
    const b = byCategory.get(category)
    return b ? [{ category, clientProjectCount: b.clientProjectCount, proposalCount: b.proposalCount, workstreamCount: b.workstreamCount, completion: completionOf(b.items) }] : []
  })

  return {
    viewerIsAdmin: input.viewerIsAdmin,
    platformRatePct: input.platformRatePct,
    builderSharePct: input.builderSharePct ?? DEFAULT_BUILDER_SHARE_PCT,
    agencies,
    unassigned,
    completionByCategory,
    overallCompletion: completionOf(completionByCategory.map((c) => c.completion)),
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
      // A builder's own Projects, plus Live ones their agency took over
      // (builder_id, 20261008100001).
      admin
        .from('projects')
        .select('id, name, status, owner_id, builder_id, updated_at, portfolio_category')
        .or(`owner_id.in.(${builderIds.join(',')}),builder_id.in.(${builderIds.join(',')})`)
        .neq('status', 'archived'),
      admin
        .from('workstream_promotions')
        .select(
          'id, workstream_id, submitted_by, status, client_emails, proposed_fee_amount, proposed_fee_currency, proposed_fee_period, created_project_id, decided_at, created_at'
        )
        .in('submitted_by', builderIds),
    ])
    if (projectError) throw projectError
    if (promotionError) throw promotionError
    // Shown on the builder of record's card, whoever owns it now.
    projects = (projectRows ?? []).map(({ builder_id, ...p }) => ({ ...p, owner_id: builder_id ?? p.owner_id }))
    promotions = promotionRows ?? []
  }

  const projectIds = projects.map((p) => p.id)
  let workstreams: AgencyDashboardInput['workstreams'] = []
  let viewerMembers: AgencyDashboardInput['viewerMembers'] = []
  let fees: AgencyDashboardInput['fees'] = []
  let projectKnowledgeBases: AgencyDashboardInput['projectKnowledgeBases'] = []
  if (projectIds.length > 0) {
    const [
      { data: workstreamRows, error: workstreamError },
      { data: memberRows, error: memberError },
      { data: feeRows, error: feeError },
      { data: projectKbRows, error: projectKbError },
    ] = await Promise.all([
      admin.from('project_workstreams').select('id, project_id, name, status, updated_at, deliverables').in('project_id', projectIds),
      admin.from('project_members').select('project_id').in('project_id', projectIds).eq('role', 'viewer').eq('status', 'active'),
      admin
        .from('client_project_fees')
        .select('project_id, amount, currency, billing_period, platform_rate_pct, builder_share_pct')
        .in('project_id', projectIds),
      admin.from('project_knowledge_bases').select('project_id, knowledge_base_id').in('project_id', projectIds),
    ])
    if (workstreamError) throw workstreamError
    if (memberError) throw memberError
    if (feeError) throw feeError
    if (projectKbError) throw projectKbError
    workstreams = workstreamRows ?? []
    viewerMembers = memberRows ?? []
    fees = feeRows ?? []
    projectKnowledgeBases = projectKbRows ?? []
  }

  const workstreamIds = workstreams.map((w) => w.id)
  let updates: AgencyDashboardInput['updates'] = []
  let presentations: AgencyDashboardInput['presentations'] = []
  let workstreamKnowledgeBases: AgencyDashboardInput['workstreamKnowledgeBases'] = []
  if (workstreamIds.length > 0) {
    const [
      { data: updateRows, error: updateError },
      { data: presentationRows, error: presentationError },
      { data: workstreamKbRows, error: workstreamKbError },
    ] = await Promise.all([
      admin
        .from('builder_progress_updates')
        .select('workstream_id, current_stage, progress, next_step, help_requested, confidence, updated_at')
        .in('workstream_id', workstreamIds)
        .eq('status', 'active'),
      admin.from('presentations').select('workstream_id, status').in('workstream_id', workstreamIds),
      admin.from('workstream_knowledge_bases').select('workstream_id, knowledge_base_id').in('workstream_id', workstreamIds),
    ])
    if (updateError) throw updateError
    if (presentationError) throw presentationError
    if (workstreamKbError) throw workstreamKbError
    updates = updateRows ?? []
    presentations = presentationRows ?? []
    workstreamKnowledgeBases = workstreamKbRows ?? []
  }

  const knowledgeBaseIds = [...new Set([...projectKnowledgeBases, ...workstreamKnowledgeBases].map((l) => l.knowledge_base_id))]
  let knowledgeBases: AgencyDashboardInput['knowledgeBases'] = []
  if (knowledgeBaseIds.length > 0) {
    const { data, error } = await admin.from('knowledge_bases').select('id, name').in('id', knowledgeBaseIds)
    if (error) throw error
    knowledgeBases = data ?? []
  }

  const [pendingPromotionRows, rates, spendByBuilder, { data: builderShares, error: sharesError }] = await Promise.all([
    shapePendingPromotions(promotions.filter((p) => p.status === 'pending')),
    getBillingRates(admin),
    getBuilderSpendSummaries(admin, builderIds),
    builderIds.length > 0
      ? admin.from('builder_billing_shares').select('builder_id, share_pct').in('builder_id', builderIds)
      : Promise.resolve({ data: [], error: null }),
  ])
  if (sharesError) throw sharesError

  return assembleAgencyDashboard({
    viewerIsAdmin,
    agencies,
    builders,
    roster: roster ?? [],
    projects,
    workstreams,
    projectKnowledgeBases,
    workstreamKnowledgeBases,
    knowledgeBases,
    updates,
    presentations,
    promotions,
    viewerMembers,
    fees,
    pendingPromotionRows,
    platformRatePct: rates.platformRatePct,
    builderSharePct: rates.builderSharePct,
    spendByBuilder,
    builderShares: builderShares ?? [],
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
