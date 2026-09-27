import 'server-only'
import { z } from 'zod'
import type { AIProvider } from '@/lib/ai/provider'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { listMessages, toDisplayMessages } from '@/lib/chat/conversations'
import { createAdminClient } from '@/lib/supabase/admin'

// Defensive limits (docs/dev-request-private-work-journal.md: "Apply
// defensive limits to source count, source size..."). Ranges longer than
// HIERARCHICAL_THRESHOLD_DAYS go through the map-reduce path below instead
// of a single call, so these bind far less often than they did for the
// fixed-30-day MVP -- they exist so a pathologically heavy period gets an
// explicit truncation note rather than an unbounded prompt.
const MAX_CONVERSATIONS = 300
const MAX_EVIDENCE_CHARS = 60000
const MAX_MONTH_EVIDENCE_CHARS = 12000
const MAX_MONTHS = 12
const HIERARCHICAL_THRESHOLD_DAYS = 45
const SUMMARY_CONCURRENCY = 3
const MAX_CUSTOM_RANGE_DAYS = 366

export type JournalRange = 'last_30_days' | 'last_6_months' | 'this_year' | 'custom'
export type JournalDetail = 'brief' | 'standard' | 'detailed'
export type JournalStyle = 'reflective' | 'factual'

export interface JournalRequestOptions {
  range: JournalRange
  from?: string
  to?: string
  includeRelatedActivity: boolean
  detail: JournalDetail
  style: JournalStyle
  excludedConversationIds: string[]
  excludedProjectIds: string[]
}

export interface JournalSourceConversation {
  id: string
  title: string
  date: string
}

export interface JournalSource {
  conversations: JournalSourceConversation[]
  evidence: string
  truncated: boolean
}

// A single block of evidence text destined for one LLM prompt. `kind`/
// `conversationId` let trimBlocksToEvidence() report back exactly which
// conversations actually made it into the final evidence string (a
// conversation whose block got cut for budget reasons must not appear in
// the Source Appendix as if it were included).
interface EvidenceBlock {
  date: string
  text: string
  kind: 'conversation' | 'project'
  conversationId?: string
}

// User-scoped by construction (ctx.user.id + RLS both apply) -- there is no
// path here that can return another user's conversations. Feedback-intake
// conversations (kind: 'feedback') are never journal material -- see
// conversations.kind's own comment in the schema.
async function fetchConversationBlocks(
  ctx: WorkbenchCallerContext,
  sinceDate: Date,
  untilDate: Date,
  projectId: string | null | undefined,
  excludedConversationIds: string[]
): Promise<{ conversations: JournalSourceConversation[]; blocks: EvidenceBlock[]; cappedByCount: boolean }> {
  let query = ctx.supabase
    .from('conversations')
    .select('*')
    .eq('user_id', ctx.user.id)
    .eq('kind', 'chat')
    .gte('last_message_at', sinceDate.toISOString())
    .lte('last_message_at', untilDate.toISOString())
    .order('last_message_at', { ascending: true })
    .limit(MAX_CONVERSATIONS)
  if (projectId !== undefined) {
    query = projectId === null ? query.is('project_id', null) : query.eq('project_id', projectId)
  }
  const { data, error } = await query
  if (error) throw error
  const excluded = new Set(excludedConversationIds)
  const rows = (data ?? []).filter((c) => !excluded.has(c.id))

  const conversations: JournalSourceConversation[] = []
  const blocks: EvidenceBlock[] = []

  for (const conv of rows) {
    const messages = await listMessages(ctx.supabase, conv.id)
    const display = await toDisplayMessages(messages, new Map(), ctx)
    if (display.length === 0) continue

    const date = conv.last_message_at ?? conv.created_at
    const transcript = display.map((m) => `${m.role}: ${m.content}`).join('\n')
    const text = `[Conversation: ${conv.title ?? 'Untitled conversation'} -- ${date}]\n${transcript}\n\n`

    blocks.push({ date, text, kind: 'conversation', conversationId: conv.id })
    conversations.push({ id: conv.id, title: conv.title ?? 'Untitled conversation', date })
  }

  return { conversations, blocks, cappedByCount: (data ?? []).length >= MAX_CONVERSATIONS }
}

function trimBlocksToEvidence(blocks: EvidenceBlock[], conversations: JournalSourceConversation[], cappedByCount: boolean): JournalSource {
  let evidence = ''
  let truncated = cappedByCount
  const includedIds = new Set<string>()

  for (const block of blocks) {
    if (evidence.length + block.text.length > MAX_EVIDENCE_CHARS) {
      truncated = true
      break
    }
    evidence += block.text
    if (block.kind === 'conversation' && block.conversationId) includedIds.add(block.conversationId)
  }

  return { conversations: conversations.filter((c) => includedIds.has(c.id)), evidence, truncated }
}

// projectId omitted (the default) pulls every conversation across every
// project in range; projectId: null scopes to unbound (general) conversations
// only; a project id scopes to that project's conversations only. Kept as
// the narrow, directly-testable building block -- generateJournal() below is
// the full orchestration used by the real request flow.
export async function gatherJournalSource(
  ctx: WorkbenchCallerContext,
  sinceDate: Date,
  projectId?: string | null,
  opts: { untilDate?: Date; excludedConversationIds?: string[] } = {}
): Promise<JournalSource> {
  const untilDate = opts.untilDate ?? new Date()
  const { conversations, blocks, cappedByCount } = await fetchConversationBlocks(
    ctx,
    sinceDate,
    untilDate,
    projectId,
    opts.excludedConversationIds ?? []
  )
  return trimBlocksToEvidence(blocks, conversations, cappedByCount)
}

export interface MyProjectActivityItem {
  id: string
  date: string
  line: string
  projectId: string
  projectName: string
}

export interface RelatedActivityItem {
  id: string
  date: string
  actorName: string
  line: string
  projectId: string
  projectName: string
}

// "My activity" and "Related activity" are the same underlying tables
// (project_notes, project_workstreams, workstream_artifacts), scoped to
// projects the user is a *current, active* member of and split by actor.
// Deliberately does NOT reuse is_project_member/can_curate_project (both
// keep an admin bypass) -- mirrors is_project_member_strict's shape (see
// 20260824170001_project_wiki_strict_membership.sql) with a real
// project_members row, status = 'active', computed here in application code
// so an admin/curator viewing this journal for anyone but themselves is
// simply impossible, not just RLS-gated.
export async function gatherProjectActivity(
  ctx: WorkbenchCallerContext,
  sinceDate: Date,
  untilDate: Date,
  opts: { includeRelated: boolean; excludedProjectIds?: string[] }
): Promise<{ mine: MyProjectActivityItem[]; related: RelatedActivityItem[]; projects: { id: string; name: string }[] }> {
  const excluded = new Set(opts.excludedProjectIds ?? [])

  const { data: memberships, error: memberErr } = await ctx.supabase
    .from('project_members')
    .select('project_id')
    .eq('user_id', ctx.user.id)
    .eq('status', 'active')
  if (memberErr) throw memberErr

  const projectIds = [...new Set((memberships ?? []).map((m) => m.project_id as string))].filter((id) => !excluded.has(id))
  if (projectIds.length === 0) return { mine: [], related: [], projects: [] }

  const [{ data: projectRows }, { data: workstreams }, { data: notes }] = await Promise.all([
    ctx.supabase.from('projects').select('id, name').in('id', projectIds),
    ctx.supabase.from('project_workstreams').select('id, project_id, name, created_by, created_at').in('project_id', projectIds),
    ctx.supabase
      .from('project_notes')
      .select('id, project_id, author_id, subject, created_at')
      .in('project_id', projectIds)
      .gte('created_at', sinceDate.toISOString())
      .lte('created_at', untilDate.toISOString()),
  ])

  const workstreamRows = workstreams ?? []
  const workstreamIds = workstreamRows.map((w) => w.id as string)
  const { data: artifacts } = workstreamIds.length
    ? await ctx.supabase
        .from('workstream_artifacts')
        .select('id, workstream_id, title, created_by, created_at')
        .in('workstream_id', workstreamIds)
        .gte('created_at', sinceDate.toISOString())
        .lte('created_at', untilDate.toISOString())
    : { data: [] as { id: string; workstream_id: string; title: string; created_by: string | null; created_at: string }[] }

  const projectNameById = new Map((projectRows ?? []).map((p) => [p.id as string, p.name as string]))
  const workstreamById = new Map(workstreamRows.map((w) => [w.id as string, w]))

  const actorIds = new Set<string>()
  for (const n of notes ?? []) if (n.author_id) actorIds.add(n.author_id as string)
  for (const w of workstreamRows) if (w.created_by) actorIds.add(w.created_by as string)
  for (const a of artifacts ?? []) if (a.created_by) actorIds.add(a.created_by as string)

  // profiles RLS only lets a caller see their own row or staff see everyone
  // (profiles_select_own_or_staff) -- a consultant co-member can't read a
  // teammate's name through ctx.supabase. Same narrow admin-client pattern
  // as src/app/(app)/projects/[id]/members/page.tsx: id + display name only,
  // never anything else, and only for actors already surfaced by the
  // membership-scoped queries above (real authorization already happened).
  const { data: actorProfiles } = actorIds.size
    ? await createAdminClient().from('profiles').select('id, full_name, email').in('id', [...actorIds])
    : { data: [] as { id: string; full_name: string | null; email: string | null }[] }
  const actorNameById = new Map((actorProfiles ?? []).map((p) => [p.id as string, (p.full_name ?? p.email ?? 'Someone') as string]))

  const mine: MyProjectActivityItem[] = []
  const related: RelatedActivityItem[] = []
  const touchedProjects = new Map<string, string>()

  const sinceIso = sinceDate.toISOString()
  const untilIso = untilDate.toISOString()
  const inRangeWorkstreams = workstreamRows.filter((w) => (w.created_at as string) >= sinceIso && (w.created_at as string) <= untilIso)

  for (const w of inRangeWorkstreams) {
    const projectId = w.project_id as string
    const projectName = projectNameById.get(projectId) ?? 'a project'
    const createdBy = w.created_by as string | null
    if (createdBy === ctx.user.id) {
      touchedProjects.set(projectId, projectName)
      mine.push({ id: w.id as string, date: w.created_at as string, line: `Started the "${w.name}" workstream in ${projectName}.`, projectId, projectName })
    } else if (opts.includeRelated && createdBy) {
      const actor = actorNameById.get(createdBy) ?? 'Someone'
      touchedProjects.set(projectId, projectName)
      related.push({
        id: w.id as string,
        date: w.created_at as string,
        actorName: actor,
        line: `${actor} started the "${w.name}" workstream in ${projectName}.`,
        projectId,
        projectName,
      })
    }
  }

  for (const n of notes ?? []) {
    const projectId = n.project_id as string
    const projectName = projectNameById.get(projectId) ?? 'a project'
    const authorId = n.author_id as string | null
    if (authorId === ctx.user.id) {
      touchedProjects.set(projectId, projectName)
      mine.push({ id: n.id as string, date: n.created_at as string, line: `Wrote a note in ${projectName}: "${n.subject}".`, projectId, projectName })
    } else if (opts.includeRelated && authorId) {
      const actor = actorNameById.get(authorId) ?? 'Someone'
      touchedProjects.set(projectId, projectName)
      related.push({
        id: n.id as string,
        date: n.created_at as string,
        actorName: actor,
        line: `${actor} wrote a note in ${projectName}: "${n.subject}".`,
        projectId,
        projectName,
      })
    }
  }

  for (const a of artifacts ?? []) {
    const ws = workstreamById.get(a.workstream_id as string)
    const projectId = ws ? (ws.project_id as string) : undefined
    const projectName = projectId ? projectNameById.get(projectId) ?? 'a project' : 'a project'
    const createdBy = a.created_by as string | null
    if (!projectId) continue
    if (createdBy === ctx.user.id) {
      touchedProjects.set(projectId, projectName)
      mine.push({ id: a.id as string, date: a.created_at as string, line: `Added the "${a.title}" artifact in ${projectName}.`, projectId, projectName })
    } else if (opts.includeRelated && createdBy) {
      const actor = actorNameById.get(createdBy) ?? 'Someone'
      touchedProjects.set(projectId, projectName)
      related.push({
        id: a.id as string,
        date: a.created_at as string,
        actorName: actor,
        line: `${actor} added the "${a.title}" artifact in ${projectName}.`,
        projectId,
        projectName,
      })
    }
  }

  mine.sort((a, b) => a.date.localeCompare(b.date))
  related.sort((a, b) => a.date.localeCompare(b.date))
  const projects = [...touchedProjects.entries()].map(([id, name]) => ({ id, name }))

  return { mine, related, projects }
}

// The doc's own suggested document structure, trimmed to what a single
// generateStructured call can reliably produce. Title, the covered date
// range, and the Source Appendix (see docx.ts) are computed from real
// records, never model output -- only these fields are AI-generated.
export const JournalContentSchema = z.object({
  narrative: z.string(),
  projectsAndThemes: z.array(z.string()),
  decisionsAndMilestones: z.array(z.string()),
  lessonsAndChangedAssumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  itemsToRevisit: z.array(z.string()),
})
export type JournalContent = z.infer<typeof JournalContentSchema>

const EMPTY_CONTENT: JournalContent = {
  narrative: '',
  projectsAndThemes: [],
  decisionsAndMilestones: [],
  lessonsAndChangedAssumptions: [],
  openQuestions: [],
  itemsToRevisit: [],
}

const DETAIL_TOKENS: Record<JournalDetail, number> = { brief: 1024, standard: 4096, detailed: 8192 }
const STYLE_VOICE: Record<JournalStyle, string> = {
  reflective: 'Write in a warm, reflective voice that helps the user remember and make sense of their own work.',
  factual: 'Write as a plain factual activity summary -- clear and neutral, without reflective or emotional language.',
}

// This provider (src/lib/ai/openai-compatible-provider.ts) only requests
// generic `json_object` mode -- the zod schema is never sent to the model,
// so every field name must be spelled out in the prompt or the model
// invents its own. Same fix as the bug caught live in src/lib/chat/summary.ts.
export async function generateJournalContent(
  provider: AIProvider,
  source: JournalSource,
  rangeLabel: string,
  opts: { detail?: JournalDetail; style?: JournalStyle; maxOutputTokens?: number } = {}
): Promise<JournalContent> {
  if (source.conversations.length === 0 && !source.evidence.trim()) {
    return { ...EMPTY_CONTENT, narrative: `No activity was found for ${rangeLabel}.` }
  }

  const style = opts.style ?? 'reflective'
  const detail = opts.detail ?? 'standard'

  const { data } = await provider.generateStructured({
    system:
      "You write a private, reflective personal work journal from a user's own authorized activity in Ember -- their saved " +
      "Assistant conversations and their own project, workstream, artifact, and note activity. Write only from the evidence " +
      `provided -- do not invent achievements, decisions, or emotions the evidence does not support. This is for the user's own ` +
      `reflection, not a performance report. ${STYLE_VOICE[style]}`,
    prompt:
      `Covered period: ${rangeLabel}\n\nEvidence, chronological:\n${source.evidence}\n\n` +
      'Produce a journal as a single JSON object with exactly these fields:\n' +
      '- narrative: string, a reflective narrative of what the user worked on during this period\n' +
      '- projectsAndThemes: array of strings, projects and recurring themes explored\n' +
      '- decisionsAndMilestones: array of strings, decisions made and milestones reached\n' +
      '- lessonsAndChangedAssumptions: array of strings, things learned or assumptions that changed\n' +
      '- openQuestions: array of strings, unfinished threads and open questions\n' +
      '- itemsToRevisit: array of strings, things the user may want to revisit later\n' +
      'Use an empty array or empty string for any field the evidence does not support -- do not omit fields or invent other field names.',
    schema: JournalContentSchema,
    maxOutputTokens: opts.maxOutputTokens ?? DETAIL_TOKENS[detail],
  })

  return data
}

function monthKey(dateStr: string): string {
  const d = new Date(dateStr)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

// One smaller call per month, producing a compact factual digest rather
// than raw transcripts -- this is the "divide by month, create bounded
// intermediate summaries, synthesize from those" hierarchy the dev request
// asks for so a 6-month range never sends unbounded raw history to one
// prompt. Digests are transient generation state, held only in memory for
// the duration of this request -- never persisted.
async function summarizeMonth(provider: AIProvider, label: string, evidence: string): Promise<string> {
  if (!evidence.trim()) return ''

  const { data } = await provider.generateStructured({
    system:
      "You produce a compact, factual digest of one month of a user's own saved Assistant conversations and project activity, " +
      'for later synthesis into a longer reflective journal. Write only from the evidence provided.',
    prompt:
      `Month: ${label}\n\nEvidence:\n${evidence}\n\n` +
      'Produce a JSON object with exactly these fields: narrative (string, 2-4 sentences), projectsAndThemes (array of strings), ' +
      'decisionsAndMilestones (array of strings), lessonsAndChangedAssumptions (array of strings), openQuestions (array of strings), ' +
      'itemsToRevisit (array of strings). Use an empty array or empty string for anything the evidence does not support.',
    schema: JournalContentSchema,
    maxOutputTokens: 1024,
  })

  const lines = [
    data.narrative,
    ...data.projectsAndThemes,
    ...data.decisionsAndMilestones,
    ...data.lessonsAndChangedAssumptions,
    ...data.openQuestions,
    ...data.itemsToRevisit,
  ].filter(Boolean)

  return `[${label}]\n${lines.join('\n')}\n\n`
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function generateJournalContentHierarchical(
  provider: AIProvider,
  monthEntries: { label: string; evidence: string }[],
  rangeLabel: string,
  opts: { detail?: JournalDetail; style?: JournalStyle } = {}
): Promise<{ content: JournalContent; truncated: boolean }> {
  const capped = monthEntries.slice(0, MAX_MONTHS)
  const truncated = monthEntries.length > MAX_MONTHS

  const digests = await mapWithConcurrency(capped, SUMMARY_CONCURRENCY, (m) => summarizeMonth(provider, m.label, m.evidence))
  const digestText = digests.filter(Boolean).join('')

  if (!digestText.trim()) {
    return { content: { ...EMPTY_CONTENT, narrative: `No activity was found for ${rangeLabel}.` }, truncated }
  }

  const content = await generateJournalContent(provider, { conversations: [], evidence: digestText, truncated: false }, rangeLabel, opts)
  return { content, truncated }
}

export function resolveJournalRange(
  options: Pick<JournalRequestOptions, 'range' | 'from' | 'to'>,
  now: Date = new Date()
): { sinceDate: Date; untilDate: Date; rangeLabel: string } {
  if (options.range === 'last_30_days') {
    const sinceDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    return { sinceDate, untilDate: now, rangeLabel: `${sinceDate.toLocaleDateString()} – ${now.toLocaleDateString()} (last 30 days)` }
  }
  if (options.range === 'last_6_months') {
    const sinceDate = new Date(now)
    sinceDate.setMonth(sinceDate.getMonth() - 6)
    return { sinceDate, untilDate: now, rangeLabel: `${sinceDate.toLocaleDateString()} – ${now.toLocaleDateString()} (last 6 months)` }
  }
  if (options.range === 'this_year') {
    const sinceDate = new Date(now.getFullYear(), 0, 1)
    return { sinceDate, untilDate: now, rangeLabel: `${sinceDate.toLocaleDateString()} – ${now.toLocaleDateString()} (this year)` }
  }

  if (!options.from || !options.to) throw new Error('Custom range requires both from and to dates')
  let sinceDate = new Date(options.from)
  let untilDate = new Date(options.to)
  if (Number.isNaN(sinceDate.getTime()) || Number.isNaN(untilDate.getTime())) throw new Error('Invalid custom date range')
  if (untilDate > now) untilDate = now
  if (sinceDate > untilDate) throw new Error('Custom range start must be before its end')

  const maxSpanMs = MAX_CUSTOM_RANGE_DAYS * 24 * 60 * 60 * 1000
  if (untilDate.getTime() - sinceDate.getTime() > maxSpanMs) sinceDate = new Date(untilDate.getTime() - maxSpanMs)

  return { sinceDate, untilDate, rangeLabel: `${sinceDate.toLocaleDateString()} – ${untilDate.toLocaleDateString()} (custom range)` }
}

export interface JournalGenerationResult {
  content: JournalContent
  conversations: JournalSourceConversation[]
  relatedActivity: RelatedActivityItem[]
  projects: { id: string; name: string }[]
  truncated: boolean
  rangeLabel: string
}

// The single entry point the Server Action calls. Ties source gathering,
// exclusions, the hierarchical/direct generation split, and related-activity
// isolation together. Nothing here is written to the database -- see the
// dev request's "no implicit persistence" requirement.
export async function generateJournal(
  ctx: WorkbenchCallerContext,
  provider: AIProvider,
  options: JournalRequestOptions
): Promise<JournalGenerationResult> {
  const { sinceDate, untilDate, rangeLabel } = resolveJournalRange(options)

  const [{ conversations, blocks, cappedByCount }, projectActivity] = await Promise.all([
    fetchConversationBlocks(ctx, sinceDate, untilDate, undefined, options.excludedConversationIds),
    gatherProjectActivity(ctx, sinceDate, untilDate, { includeRelated: options.includeRelatedActivity, excludedProjectIds: options.excludedProjectIds }),
  ])

  const myActivityBlocks: EvidenceBlock[] = projectActivity.mine.map((m) => ({
    date: m.date,
    text: `[Project activity -- ${m.date}]\n${m.line}\n\n`,
    kind: 'project',
  }))
  const allBlocks = [...blocks, ...myActivityBlocks].sort((a, b) => a.date.localeCompare(b.date))

  const spanDays = (untilDate.getTime() - sinceDate.getTime()) / (24 * 60 * 60 * 1000)
  const genOpts = { detail: options.detail, style: options.style }

  if (spanDays <= HIERARCHICAL_THRESHOLD_DAYS) {
    const merged = trimBlocksToEvidence(allBlocks, conversations, cappedByCount)
    const content = await generateJournalContent(provider, merged, rangeLabel, genOpts)
    return {
      content,
      conversations: merged.conversations,
      relatedActivity: projectActivity.related,
      projects: projectActivity.projects,
      truncated: merged.truncated,
      rangeLabel,
    }
  }

  const byMonth = new Map<string, string>()
  for (const block of allBlocks) {
    const key = monthKey(block.date)
    const current = byMonth.get(key) ?? ''
    if (current.length + block.text.length <= MAX_MONTH_EVIDENCE_CHARS) byMonth.set(key, current + block.text)
  }
  const monthEntries = [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, evidence]) => ({ label: monthLabel(key), evidence }))

  const { content, truncated: monthsTruncated } = await generateJournalContentHierarchical(provider, monthEntries, rangeLabel, genOpts)

  return {
    content,
    conversations,
    relatedActivity: projectActivity.related,
    projects: projectActivity.projects,
    truncated: cappedByCount || monthsTruncated,
    rangeLabel,
  }
}
