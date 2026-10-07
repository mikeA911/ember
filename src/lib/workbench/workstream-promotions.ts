import 'server-only'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import { getActiveProjectRole, type WorkbenchCallerContext } from './context'
import { enrollInOrganizationHome } from './projects'
import { getFeeSplit, validateFee, type FeeInput } from './client-billing'

// Workstream promotion (business-process handoff): a completed Workstream
// is submitted for review by any active member of its Project; that
// Project's own owner/curator (or a platform admin) decides, and on
// approval a NEW Project is created -- the original Project is never
// exposed to the new team. Works identically whether the submitting
// Project is a KB Sandbox Builder's solo Project (the operator/admin
// decides) or an ordinary Enterprise team Project (that team's own
// curator decides, e.g. an HR Manager reviewing a staff member's
// completed vacation-leave-policy workstream) -- generalized in
// 20260906100002 after shipping Builder-only in 20260906100001; see that
// migration's own comment for why platform-level is_curator_or_admin was
// wrong for the Enterprise case. Distinct from
// docs/dev-request-builder-capability-promotion-evaluation-templates.md's
// separate technical certification ladder for a *built capability*
// (builder_integrations) -- nothing here touches that system.
//
// Deciding a promotion is gated on can_curate_project(project_id, uid) AND
// submitted_by != auth.uid() together -- can_curate_project alone would let
// a Builder (owner of their own solo Project) approve their own promotion;
// submitted_by != auth.uid() alone would still exclude an ordinary team's
// own curator. Both together generalize correctly to both cases.

function slugify(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Trimmed, lowercased, de-duplicated; throws on anything not email-shaped
// so a typo is caught at submission, not discovered at approval.
export function normalizeClientEmails(raw: string[] | undefined): string[] {
  const emails = [...new Set((raw ?? []).map((e) => e.trim().toLowerCase()).filter(Boolean))]
  const invalid = emails.filter((e) => !EMAIL_LIKE.test(e))
  if (invalid.length > 0) throw new ProjectValidationError(`Not a valid email address: ${invalid.join(', ')}`)
  return emails
}

// For a builder's accepted client proposal: clientEmails are the client
// people to add as viewers on the new client Project once it's approved,
// fee is the maintenance fee agreed with the client (client-billing.ts),
// and clientAgreed is the builder's confirmation that the client has
// agreed to the project -- a builder's workstream becomes a project only
// then (20261028100001_builder_edition_agency_rules.sql).
//
// On a builder's Project (builder_lab -- their workspace, or a client
// Project they built) only the builder of record requests promotion: they
// alone are paid for it, and sharing with anyone they invited is up to
// them. The platform admin's own requests (Ember-sourced work) are
// approved straight away -- there's no one above them to decide.
export async function submitWorkstreamForPromotion(
  ctx: WorkbenchCallerContext,
  workstreamId: string,
  clientEmails?: string[],
  fee?: FeeInput | null,
  clientAgreed = false
): Promise<{ promotionId: string; createdProjectId?: string; clientViewers?: ClientViewerResult[] }> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Create an account to submit a workstream for promotion')
  const normalizedClientEmails = normalizeClientEmails(clientEmails)
  const proposedFee = fee ? validateFee(fee) : null
  const isAdmin = ctx.profile.role === 'admin'

  const { data: workstream, error: workstreamError } = await ctx.supabase
    .from('project_workstreams')
    .select('id, project_id, status')
    .eq('id', workstreamId)
    .single()
  if (workstreamError || !workstream) throw workstreamError ?? new ProjectValidationError('Workstream not found')

  const role = await getActiveProjectRole(ctx, workstream.project_id)
  if (!role && !isAdmin) throw new AuthError('You must be an active member of this workstream\'s project to submit it for promotion')

  const { data: project } = await ctx.supabase
    .from('projects')
    .select('owner_id, builder_id, portfolio_category')
    .eq('id', workstream.project_id)
    .maybeSingle()
  const isBuilderWork = project?.portfolio_category === 'builder_lab'
  if (isBuilderWork && !isAdmin && (project.builder_id ?? project.owner_id) !== ctx.user.id) {
    throw new AuthError('Only the builder who owns this work can request its promotion')
  }
  if ((isBuilderWork || isAdmin) && !clientAgreed) {
    throw new ProjectValidationError('Confirm your client has agreed to this project before requesting its promotion')
  }
  if (workstream.status !== 'completed') {
    throw new ProjectValidationError('Only a completed workstream can be submitted for promotion')
  }

  const { data: approvedArtifacts, error: artifactsError } = await ctx.supabase
    .from('workstream_artifacts')
    .select('id')
    .eq('workstream_id', workstreamId)
    .eq('status', 'approved')
  if (artifactsError) throw artifactsError
  if (!approvedArtifacts || approvedArtifacts.length === 0) {
    throw new ProjectValidationError('At least one approved artifact is required before submitting for promotion')
  }

  const { data: existing, error: existingError } = await ctx.supabase
    .from('workstream_promotions')
    .select('id')
    .eq('workstream_id', workstreamId)
    .in('status', ['pending', 'approved'])
    .maybeSingle()
  if (existingError) throw existingError
  if (existing) throw new ProjectValidationError('This workstream already has a pending or approved promotion')

  const { data: promotion, error } = await ctx.supabase
    .from('workstream_promotions')
    .insert({
      workstream_id: workstreamId,
      submitted_by: ctx.user.id,
      client_emails: normalizedClientEmails,
      proposed_fee_amount: proposedFee?.amount ?? null,
      proposed_fee_currency: proposedFee?.currency ?? null,
      proposed_fee_period: proposedFee?.period ?? null,
      client_agreed_at: clientAgreed ? new Date().toISOString() : null,
    })
    .select('id')
    .single()
  if (error || !promotion) throw error ?? new ProjectValidationError('Failed to submit workstream for promotion')

  if (isAdmin) {
    const approved = await approveWorkstreamPromotion(ctx, promotion.id)
    return { promotionId: promotion.id, ...approved }
  }
  return { promotionId: promotion.id }
}

export interface PendingWorkstreamPromotionRow {
  id: string
  workstreamName: string
  projectName: string
  submitterEmail: string | null
  approvedArtifactCount: number
  clientEmails: string[]
  proposedFee: FeeInput | null
  createdAt: string
}

export async function shapePendingPromotions(
  promotions: {
    id: string
    workstream_id: string
    submitted_by: string
    client_emails: string[] | null
    proposed_fee_amount: number | null
    proposed_fee_currency: FeeInput['currency'] | null
    proposed_fee_period: FeeInput['period'] | null
    created_at: string
  }[]
): Promise<PendingWorkstreamPromotionRow[]> {
  if (promotions.length === 0) return []

  const admin = createAdminClient()
  const workstreamIds = [...new Set(promotions.map((p) => p.workstream_id))]
  const { data: workstreams } = await admin.from('project_workstreams').select('id, name, project_id').in('id', workstreamIds)
  const workstreamById = new Map((workstreams ?? []).map((w) => [w.id, w]))

  const projectIds = [...new Set((workstreams ?? []).map((w) => w.project_id))]
  const { data: projects } = projectIds.length > 0 ? await admin.from('projects').select('id, name').in('id', projectIds) : { data: [] }
  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]))

  const submitterIds = [...new Set(promotions.map((p) => p.submitted_by))]
  const { data: profiles } = await admin.from('profiles').select('id, email').in('id', submitterIds)
  const emailById = new Map((profiles ?? []).map((p) => [p.id, p.email]))

  const artifactCountByWorkstreamId = new Map<string, number>()
  if (workstreamIds.length > 0) {
    const { data: artifacts } = await admin.from('workstream_artifacts').select('workstream_id').in('workstream_id', workstreamIds).eq('status', 'approved')
    for (const a of artifacts ?? []) artifactCountByWorkstreamId.set(a.workstream_id, (artifactCountByWorkstreamId.get(a.workstream_id) ?? 0) + 1)
  }

  return promotions.map((p) => {
    const workstream = workstreamById.get(p.workstream_id)
    return {
      id: p.id,
      workstreamName: workstream?.name ?? 'Unknown workstream',
      projectName: workstream ? (projectNameById.get(workstream.project_id) ?? 'Unknown project') : 'Unknown project',
      submitterEmail: emailById.get(p.submitted_by) ?? null,
      approvedArtifactCount: artifactCountByWorkstreamId.get(p.workstream_id) ?? 0,
      clientEmails: p.client_emails ?? [],
      proposedFee:
        p.proposed_fee_amount !== null && p.proposed_fee_currency && p.proposed_fee_period
          ? { amount: Number(p.proposed_fee_amount), currency: p.proposed_fee_currency, period: p.proposed_fee_period }
          : null,
      createdAt: p.created_at,
    }
  })
}

// Platform-wide -- RLS (workstream_promotions_select_own_or_curator) is the
// real gate, which for a platform admin means every pending promotion
// everywhere. Workstream/Project names are looked up via the admin client
// (safe, narrow metadata only -- never content), same "safe metadata query"
// pattern as getOrganizationPortfolio/listDiscoverableProjects. Kept as the
// secondary, admin-only cross-Project overview now that the primary review
// path is the Project page itself (listPendingWorkstreamPromotionsForProject
// below), which an ordinary team curator can reach without /admin access.
export async function listPendingWorkstreamPromotions(ctx: WorkbenchCallerContext): Promise<PendingWorkstreamPromotionRow[]> {
  const { data: promotions, error } = await ctx.supabase
    .from('workstream_promotions')
    .select('id, workstream_id, submitted_by, client_emails, proposed_fee_amount, proposed_fee_currency, proposed_fee_period, created_at')
    .eq('status', 'pending')
    .order('created_at', { ascending: false })
  if (error) throw error
  return shapePendingPromotions(promotions ?? [])
}

// Project-scoped -- the primary review path for an ordinary team's own
// curator (e.g. an HR Manager), who may have no /admin access at all
// (that page is platform-admin-only). RLS still narrows this to promotions
// the caller can actually see (own submissions, or can_curate_project on
// the workstream's Project) -- the .eq('project_id', ...) below is this
// query's own scoping, not a second authorization layer.
export async function listPendingWorkstreamPromotionsForProject(ctx: WorkbenchCallerContext, projectId: string): Promise<PendingWorkstreamPromotionRow[]> {
  const { data: workstreams } = await ctx.supabase.from('project_workstreams').select('id').eq('project_id', projectId)
  const workstreamIds = (workstreams ?? []).map((w) => w.id)
  if (workstreamIds.length === 0) return []

  const { data: promotions, error } = await ctx.supabase
    .from('workstream_promotions')
    .select('id, workstream_id, submitted_by, client_emails, proposed_fee_amount, proposed_fee_currency, proposed_fee_period, created_at')
    .eq('status', 'pending')
    .in('workstream_id', workstreamIds)
    .order('created_at', { ascending: false })
  if (error) throw error
  return shapePendingPromotions(promotions ?? [])
}

// Mirrors requireProjectCuratorOrAdmin (source-submissions.ts) -- admin
// passes outright, otherwise the caller must hold owner/curator on the
// workstream's OWN Project. This is what makes an ordinary team's own
// curator (platform role merely 'consultant') able to decide, which the
// platform-level hasRequiredRole(role, 'curator') check used before
// 20260906100002 could never allow. A builder's agency (agency_builders)
// also passes for that builder's promotions -- it's never a member of the
// builder's private workspace, so the project-role check alone would
// leave only the platform admin able to decide them.
//
// A builder's own work (a builder_lab Project) is decided by their agency
// or the platform admin only -- never by another curator on that Project,
// such as a builder they invited (20261028100001).
async function requirePromotionDecider(ctx: WorkbenchCallerContext, promotion: { workstream_id: string; submitted_by: string }): Promise<void> {
  if (ctx.profile.role === 'admin') return
  if (ctx.profile.role === 'curator') {
    const { data: agencyLink } = await ctx.supabase
      .from('agency_builders')
      .select('builder_id')
      .eq('builder_id', promotion.submitted_by)
      .eq('agency_id', ctx.user.id)
      .maybeSingle()
    if (agencyLink) return
  }
  const { data: workstream, error } = await ctx.supabase.from('project_workstreams').select('project_id').eq('id', promotion.workstream_id).single()
  if (error || !workstream) throw error ?? new ProjectValidationError('Workstream not found')
  const { data: project } = await ctx.supabase.from('projects').select('portfolio_category').eq('id', workstream.project_id).maybeSingle()
  if (project?.portfolio_category === 'builder_lab') {
    throw new AuthError("Only the builder's agency or the platform admin can decide a builder's promotion")
  }
  const role = await getActiveProjectRole(ctx, workstream.project_id)
  if (role !== 'owner' && role !== 'curator') {
    throw new AuthError('Requires this workstream\'s own Project owner or curator role, the builder\'s agency, or platform admin to decide a promotion')
  }
}

export interface ClientViewerResult {
  email: string
  status: 'added' | 'created' | 'failed'
  // Only for a newly created account -- shown once to the approver to
  // hand to the client, same as bulkAddProjectMembers.
  password?: string
  error?: string
}

// Admin client throughout: the decider is already authorized above, and an
// agency curator can't read arbitrary profiles by email or add members to
// a Project it doesn't yet curate. New client accounts get the least-
// privileged 'member' platform role -- they only ever view their own
// client Project (plus the Organization Home, like every new account).
async function addClientViewers(admin: ReturnType<typeof createAdminClient>, projectId: string, emails: string[]): Promise<ClientViewerResult[]> {
  const results: ClientViewerResult[] = []
  for (const email of emails) {
    try {
      const { data: existing, error: lookupError } = await admin.from('profiles').select('id').ilike('email', email.replace(/[\\%_]/g, '\\$&')).maybeSingle()
      if (lookupError) throw lookupError
      let userId = existing?.id
      let password: string | undefined
      if (!userId) {
        password = crypto.randomUUID().replace(/-/g, '').slice(0, 12)
        const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
        if (createError) throw createError
        userId = created.user.id
        const { error: profileError } = await admin
          .from('profiles')
          .insert({ id: userId, email, full_name: null, role: 'member', is_active: true, assigned_kbs: [] })
        if (profileError) throw profileError
        await enrollInOrganizationHome(admin, userId)
      }
      const { error: memberError } = await admin
        .from('project_members')
        .upsert({ project_id: projectId, user_id: userId, role: 'viewer', status: 'active' }, { onConflict: 'project_id,user_id', ignoreDuplicates: true })
      if (memberError) throw memberError
      results.push(password ? { email, status: 'created', password } : { email, status: 'added' })
    } catch (err) {
      results.push({ email, status: 'failed', error: err instanceof Error ? err.message : 'Failed to add client' })
    }
  }
  return results
}

export async function approveWorkstreamPromotion(
  ctx: WorkbenchCallerContext,
  promotionId: string
): Promise<{ createdProjectId: string; clientViewers: ClientViewerResult[] }> {
  const { data: promotion, error: fetchError } = await ctx.supabase
    .from('workstream_promotions')
    .select('*')
    .eq('id', promotionId)
    .single()
  if (fetchError || !promotion) throw fetchError ?? new ProjectValidationError('Promotion not found')
  if (promotion.status !== 'pending') throw new ProjectValidationError('This promotion has already been decided')
  // The platform admin's own (Ember-sourced) work needs no further approval.
  const selfApproved = promotion.submitted_by === ctx.user.id
  if (selfApproved && ctx.profile.role !== 'admin') throw new AuthError('You cannot decide a promotion you submitted yourself')

  await requirePromotionDecider(ctx, promotion)

  const admin = createAdminClient()

  const { data: workstream, error: workstreamError } = await admin
    .from('project_workstreams')
    .select('id, name, project_id')
    .eq('id', promotion.workstream_id)
    .single()
  if (workstreamError || !workstream) throw workstreamError ?? new ProjectValidationError('Original workstream is missing')

  const { data: sourceProject, error: sourceProjectError } = await admin
    .from('projects')
    .select('owner_id, builder_id, portfolio_category, client_source')
    .eq('id', workstream.project_id)
    .single()
  if (sourceProjectError || !sourceProject) throw sourceProjectError ?? new ProjectValidationError('Original project is missing')
  // A builder's accepted client proposal: promoted by its builder of record
  // from their builder_lab workspace, or from a client Project they built
  // and now maintain as curator after the agency took it over at go-live.
  // The platform admin's own work is treated the same way: they own and
  // build the new Project.
  const isBuilderProposal =
    selfApproved ||
    (sourceProject.portfolio_category === 'builder_lab' && (sourceProject.builder_id ?? sourceProject.owner_id) === promotion.submitted_by)
  // Who found the client: the platform admin's own work is Ember-found; a
  // builder's proposal is builder-found; more work on an existing client
  // Project keeps that client's source.
  const clientSource = selfApproved ? 'ember' : (sourceProject.client_source ?? 'builder')

  const { data: approvedArtifacts, error: artifactsError } = await admin
    .from('workstream_artifacts')
    .select('artifact_type, title, external_tool, content, external_url, notes, created_by')
    .eq('workstream_id', workstream.id)
    .eq('status', 'approved')
  if (artifactsError) throw artifactsError

  // 1. A new Project, named after the workstream alone.
  //    - Builder proposal: the builder owns their client Project, tagged
  //      builder_lab so their metering/BYOLLM covers it too; their agency
  //      joins as curator to oversee it.
  //    - Otherwise: the deciding curator/admin becomes its owner (matches
  //      "the rest of the team is added manually" afterward) and the
  //      submitter joins as consultant -- direct access to the person who
  //      did the work, not just the documents.
  //    projects_create_owner_membership adds the owner automatically.
  const { data: newProject, error: projectError } = await admin
    .from('projects')
    .insert(
      isBuilderProposal
        ? {
            name: workstream.name,
            project_type: 'consulting',
            owner_id: promotion.submitted_by,
            builder_id: promotion.submitted_by,
            portfolio_category: sourceProject.portfolio_category,
            client_source: clientSource,
          }
        : { name: workstream.name, project_type: 'consulting', owner_id: ctx.user.id }
    )
    .select('id')
    .single()
  if (projectError || !newProject) throw projectError ?? new ProjectValidationError('Failed to create the new project')

  // 2. The second member: the builder's agency, or the original submitter.
  let secondMember: { user_id: string; role: 'curator' | 'consultant' } | null = null
  if (isBuilderProposal) {
    const { data: agencyLink, error: agencyError } = await admin
      .from('agency_builders')
      .select('agency_id')
      .eq('builder_id', promotion.submitted_by)
      .maybeSingle()
    if (agencyError) throw agencyError
    if (agencyLink && agencyLink.agency_id !== promotion.submitted_by) secondMember = { user_id: agencyLink.agency_id, role: 'curator' }
  } else {
    secondMember = { user_id: promotion.submitted_by, role: 'consultant' }
  }
  if (secondMember) {
    const { error: memberError } = await admin
      .from('project_members')
      .insert({ project_id: newProject.id, user_id: secondMember.user_id, role: secondMember.role, status: 'active' })
    if (memberError) throw memberError
  }

  // 3. One new Workstream carrying the same name, holding copies of only
  // the already-approved artifacts -- draft/unreviewed content (and, for
  // a Builder, their private Working Knowledge notebook) never leaves the
  // original Project.
  const { data: newWorkstream, error: newWorkstreamError } = await admin
    .from('project_workstreams')
    .insert({ project_id: newProject.id, name: workstream.name, slug: slugify(workstream.name) || 'promoted' })
    .select('id')
    .single()
  if (newWorkstreamError || !newWorkstream) throw newWorkstreamError ?? new ProjectValidationError('Failed to create the new workstream')

  if (approvedArtifacts && approvedArtifacts.length > 0) {
    const { error: copyError } = await admin.from('workstream_artifacts').insert(
      approvedArtifacts.map((a) => ({
        workstream_id: newWorkstream.id,
        artifact_type: a.artifact_type,
        title: a.title,
        external_tool: a.external_tool,
        content: a.content,
        external_url: a.external_url,
        notes: a.notes,
        created_by: a.created_by,
        status: 'approved' as const,
        reviewed_by: ctx.user.id,
        reviewed_at: new Date().toISOString(),
      }))
    )
    if (copyError) throw copyError
  }

  // 4. The agreed maintenance fee, split by who found the client at this
  // builder's rates -- the billing record for this client (client-billing.ts).
  if (promotion.proposed_fee_amount !== null && promotion.proposed_fee_currency && promotion.proposed_fee_period) {
    const split = await getFeeSplit(admin, promotion.submitted_by, clientSource)
    const { error: feeError } = await admin.from('client_project_fees').insert({
      project_id: newProject.id,
      amount: Number(promotion.proposed_fee_amount),
      currency: promotion.proposed_fee_currency,
      billing_period: promotion.proposed_fee_period,
      platform_rate_pct: split.platformRatePct,
      builder_share_pct: split.builderSharePct,
      set_by: ctx.user.id,
    })
    if (feeError) throw feeError
  }

  // 5. The client, as viewers. Per-email results rather than all-or-nothing:
  // the Project already exists at this point, and the approver can add a
  // missed client from its Members page.
  const clientViewers = await addClientViewers(admin, newProject.id, promotion.client_emails ?? [])

  // Decision update through the caller's own RLS-scoped client, not the
  // admin client -- if the checks above were ever wrong, RLS
  // (workstream_promotions_decide_curator) is the backstop, same "zero
  // rows updated = no permission" pattern as approveSourceSubmission.
  // The admin's own promotion goes through the admin client: RLS never lets
  // a submitter decide their own, and selfApproved is already limited to
  // the platform admin above.
  const { data: updated, error: updateError } = await (selfApproved ? admin : ctx.supabase)
    .from('workstream_promotions')
    .update({ status: 'approved', decided_by: ctx.user.id, decided_at: new Date().toISOString(), created_project_id: newProject.id })
    .eq('id', promotionId)
    .select('id')
  if (updateError) throw updateError
  if (!updated || updated.length === 0) throw new ProjectValidationError('You do not have permission to decide this promotion')

  return { createdProjectId: newProject.id, clientViewers }
}

export async function rejectWorkstreamPromotion(ctx: WorkbenchCallerContext, promotionId: string, reason?: string): Promise<void> {
  const { data: promotion, error: fetchError } = await ctx.supabase
    .from('workstream_promotions')
    .select('id, workstream_id, submitted_by, status')
    .eq('id', promotionId)
    .single()
  if (fetchError || !promotion) throw fetchError ?? new ProjectValidationError('Promotion not found')
  if (promotion.submitted_by === ctx.user.id) throw new AuthError('You cannot decide a promotion you submitted yourself')

  await requirePromotionDecider(ctx, promotion)

  const { data: updated, error } = await ctx.supabase
    .from('workstream_promotions')
    .update({ status: 'rejected', decided_by: ctx.user.id, decided_at: new Date().toISOString(), decision_reason: reason?.trim() || null })
    .eq('id', promotionId)
    .eq('status', 'pending')
    .select('id')
  if (error) throw error
  if (!updated || updated.length === 0) throw new ProjectValidationError('This promotion is not pending, or you do not have permission to decide it')
}
