import 'server-only'
import { z } from 'zod'
import type { ToolSpec } from '@/lib/ai'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'
import { sliEnabled } from '@/lib/sli/flag'
import { getSliContext, sliRpc } from '@/lib/sli/api'
import type { CustomerListItem, SliContext, SliProposal, TriggerType } from '@/lib/sli/types'

// Ember SLI tools for the conversation (docs/design-notes/ember-sli-calm-
// workspace.md §3, "Ember suggests, the person confirms"). Ember can look
// companies up, but every change is only a proposal: sli_create_proposal
// stores it and the person confirms or cancels it on a card
// (SliProposalCard). The Trigger always comes from the conversation's own
// Project, never from the model.

export const SLI_PROPOSE_PREFIX = 'sli_propose_'

type Supabase = WorkbenchCallerContext['supabase']
type SliTrigger = { id: string; code: string; title: string; stage: string; archived: boolean }

export type SliChatContext = { sli: SliContext; trigger: SliTrigger | null; triggerTypes: TriggerType[] }

// Offered only to members of an SLI department, when SLI is on. Never
// throws: a failure here just means no SLI tools this turn.
export async function loadSliChatContext(supabase: Supabase, projectId: string | null): Promise<SliChatContext | null> {
  if (!sliEnabled()) return null
  try {
    const client = supabase as Parameters<typeof getSliContext>[0]
    const sli = await getSliContext(client)
    if (!sli?.isMember || !sli.isDepartmentMember) return null
    const [trigger, triggerTypes] = await Promise.all([
      projectId ? sliRpc<SliTrigger | null>(client, 'sli_trigger_for_project', { p_project: projectId }) : Promise.resolve(null),
      sliRpc<TriggerType[]>(client, 'sli_list_trigger_types'),
    ])
    return { sli, trigger, triggerTypes }
  } catch (err) {
    console.error('SLI tools unavailable this turn', err)
    return null
  }
}

const Optional = z.string().max(2000).optional()
const Tier = z.enum(['existing_customer', 'related_company', 'new_prospect'])
const Fit = z.enum(['strong', 'partial', 'poor', 'unknown'])
const Priority = z.enum(['low', 'medium', 'high'])

const FindCustomersInput = z.object({
  search: z.string().max(200).optional().describe('Part of the company name, website or phone number'),
  technology: z.string().max(200).optional().describe('A vendor or product the company runs, for example "VMware"'),
})
const ProposeTriggerInput = z.object({
  title: z.string().min(3).max(200),
  triggerType: z.string().max(60).describe('One of the Trigger type codes listed in your instructions'),
  summary: z.string().max(4000).describe('What happened and why it may matter, in the person’s words'),
  eventDate: z.string().max(10).optional().describe('YYYY-MM-DD, when known'),
  eventReference: Optional.describe('A link or reference for the event'),
  strategicObjective: Optional,
})
const CandidateFields = {
  tier: Tier,
  fitRationale: z.string().min(3).max(2000).describe('Why this company is a candidate'),
  solutionFit: Fit.optional(),
  priority: Priority.optional(),
}
const ProposeCandidateInput = z.object({
  customerId: z.string().max(60).describe('The company id from sli_find_customers'),
  ...CandidateFields,
  relationshipPath: Optional,
  targetIndustry: Optional,
  knownRelationships: Optional,
  evidenceReference: Optional,
})
const ProposeNewCustomerInput = z.object({
  name: z.string().min(2).max(200),
  website: z.string().max(300).optional(),
  mainPhone: z.string().max(60).optional(),
  industry: z.string().max(120).optional(),
  subIndustry: z.string().max(120).optional(),
  region: z.string().max(120).optional(),
  overrideReason: Optional.describe('Only when the person says to save despite a shared main phone number'),
  candidate: z
    .object(CandidateFields)
    .optional()
    .describe('Also add it as a candidate customer of this conversation’s Trigger (only in a Trigger’s conversation)'),
})
const ProposeRecommendationInput = z.object({
  recommendation: z.enum(['approve', 'revise', 'defer', 'reject']),
  destination: z.string().max(120).optional().describe('With approve: the department to hand it to, by name'),
  comments: Optional,
})

const TOOLS = {
  sli_find_customers: {
    description:
      'Look up companies in the SLI company registry by name, website, phone or technology they run. Read-only. Use it before proposing a candidate customer, to get the company id, and before proposing a new company, to avoid duplicates.',
    schema: FindCustomersInput,
    triggerOnly: false,
  },
  sli_propose_trigger: {
    description:
      'Propose raising a new Trigger. Does not save anything: the person sees a card and confirms or cancels. Only propose once you know the title, the type and a short summary.',
    schema: ProposeTriggerInput,
    triggerOnly: false,
  },
  sli_propose_new_customer: {
    description:
      'Propose adding a company to the SLI company registry (and, in a Trigger’s conversation, optionally as a candidate customer). Does not save anything until the person confirms. Check with sli_find_customers first.',
    schema: ProposeNewCustomerInput,
    triggerOnly: false,
  },
  sli_propose_candidate_customer: {
    description:
      'Propose adding a registry company to this Trigger’s candidate customers. Does not save anything until the person confirms. Get customerId from sli_find_customers.',
    schema: ProposeCandidateInput,
    triggerOnly: true,
  },
  sli_propose_recommendation: {
    description:
      'Propose recording the person’s recommendation on this Trigger while it is under review (approve, revise, defer or reject). Does not save anything until the person confirms. Only when the person has said what they recommend.',
    schema: ProposeRecommendationInput,
    triggerOnly: true,
  },
} as const

type SliToolName = keyof typeof TOOLS

const KIND: Record<Exclude<SliToolName, 'sli_find_customers'>, SliProposal['kind']> = {
  sli_propose_trigger: 'raise_trigger',
  sli_propose_new_customer: 'create_customer',
  sli_propose_candidate_customer: 'add_candidate',
  sli_propose_recommendation: 'record_recommendation',
}

export function isSliToolName(name: string): name is SliToolName {
  return Object.hasOwn(TOOLS, name)
}

export function sliToolSpecs(context: SliChatContext): ToolSpec[] {
  return (Object.entries(TOOLS) as [SliToolName, (typeof TOOLS)[SliToolName]][])
    .filter(([, t]) => !t.triggerOnly || context.trigger)
    .map(([name, t]) => ({ name, description: t.description, parameters: z.toJSONSchema(t.schema) }))
}

export function buildSliPromptAddendum(context: SliChatContext): string {
  const types = context.triggerTypes.map((t) => `${t.code} (${t.label})`).join(', ')
  const trigger = context.trigger
    ? `\n\nThis conversation is the research conversation of Trigger ${context.trigger.code}, "${context.trigger.title}", now at stage ${context.trigger.stage.replace('_', ' ')}. Candidate customers and recommendations you propose apply to this Trigger.`
    : ''
  return `\n\nYou are also working in ${context.sli.productName} (${context.sli.byline}) for ${context.sli.organizationName}. Be calm and brief, and ask one question at a time rather than a list of questions.

You can look companies up with sli_find_customers. You can never change an SLI record yourself: the sli_propose_* tools only create a proposal, which the person sees as a card with Confirm and Cancel. Nothing is saved until they confirm. So never say a Trigger was raised, a company added, a candidate added or a recommendation recorded unless a tool result in this conversation says its status is "confirmed". After proposing, say in one short sentence what you proposed and that it is waiting for them to confirm on the card. If a proposal is refused, say why in plain words and ask what they would like to do. Don't propose with guesses: ask for anything you need first (for a Trigger: a title, its type and a short summary of what happened).

Trigger types: ${types || '(none set up)'}.${trigger}`
}

function briefCustomer(c: CustomerListItem) {
  return { id: c.id, name: c.name, domain: c.domain, industry: c.industry, group: c.group, accountRep: c.accountRep, technologies: c.technologies }
}

export async function runSliTool(
  supabase: Supabase,
  name: SliToolName,
  rawInput: unknown,
  opts: { conversationId: string; toolCallId: string; context: SliChatContext }
): Promise<{ resultForModel: unknown; proposal?: SliProposal }> {
  const client = supabase as Parameters<typeof getSliContext>[0]
  const tool = TOOLS[name]
  if (tool.triggerOnly && !opts.context.trigger) {
    return { resultForModel: { error: `${name} is only available in a Trigger’s conversation.` } }
  }
  const parsed = tool.schema.safeParse(rawInput)
  if (!parsed.success) {
    return { resultForModel: { error: `Invalid input: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'input'} ${i.message}`).join('; ')}` } }
  }

  if (name === 'sli_find_customers') {
    const input = parsed.data as z.infer<typeof FindCustomersInput>
    const found = await sliRpc<CustomerListItem[]>(client, 'sli_list_customers', {
      p_search: input.search ?? null,
      p_technology: input.technology ?? null,
      p_limit: 10,
    })
    return { resultForModel: { companies: found.map(briefCustomer), note: found.length === 10 ? 'Showing the first 10 matches.' : undefined } }
  }

  const proposal = await sliRpc<SliProposal>(client, 'sli_create_proposal', {
    p_kind: KIND[name],
    p_payload: parsed.data,
    p_conversation: opts.conversationId,
    p_tool_call: opts.toolCallId,
    p_trigger: opts.context.trigger?.id ?? null,
  })
  return {
    resultForModel: {
      proposalId: proposal.id,
      status: 'waiting_for_confirmation',
      summary: proposal.summary,
      message: 'Shown to the person as a card with Confirm and Cancel. Nothing is saved until they confirm.',
    },
    proposal,
  }
}

// A conversation's proposals when it is reopened: the proposal ids its
// SLI tool rows carry, as they stand now.
export function proposalIdFromToolRow(toolName: string, content: string): string | null {
  if (!toolName.startsWith(SLI_PROPOSE_PREFIX)) return null
  try {
    const parsed = JSON.parse(content) as { proposalId?: unknown }
    return typeof parsed.proposalId === 'string' ? parsed.proposalId : null
  } catch {
    return null
  }
}

export async function getSliProposals(supabase: Supabase, ids: string[]): Promise<SliProposal[]> {
  if (ids.length === 0 || !sliEnabled()) return []
  try {
    return await sliRpc<SliProposal[]>(supabase as Parameters<typeof getSliContext>[0], 'sli_get_proposals', { p_ids: ids })
  } catch (err) {
    console.error('Could not read SLI proposals for this conversation', err)
    return []
  }
}
