'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AuthError, requireUser } from '@/lib/auth'
import { SliError, sliRpc } from '@/lib/sli/api'
import { sliEnabled } from '@/lib/sli/flag'
import { TRIGGER_STAGES } from '@/lib/sli/types'

// Ember SLI, S2: Trigger writes. Each runs as the signed-in person through
// a security-definer function that resolves their organisation, checks
// what they may do and records history
// (supabase/migrations/20261101100002_sli_triggers.sql).

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))

const RaiseSchema = z.object({
  title: z.string().trim().min(3, 'Give the Trigger a title of at least three characters').max(200),
  triggerType: z.string().min(1, 'Choose a Trigger type').max(41),
  summary: z.string().trim().max(8000).default(''),
  eventDate: z
    .string()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date'),
  eventReference: optionalText(1000),
  strategicObjective: optionalText(2000),
  sourceDepartmentId: z.string().uuid().optional().or(z.literal('')).transform((v) => (v ? v : null)),
})

const TransitionSchema = z.object({
  triggerId: z.string().uuid(),
  toStage: z.enum(TRIGGER_STAGES),
  reason: optionalText(2000),
})

const ArchiveSchema = z.object({
  triggerId: z.string().uuid(),
  archived: z.boolean(),
  reason: optionalText(1000),
})

const ContributorSchema = z.object({
  triggerId: z.string().uuid(),
  userId: z.string().uuid(),
  add: z.boolean(),
})

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof SliError || err instanceof AuthError) return { ok: false, error: err.message }
  return { ok: false, error: 'Something went wrong. Try again in a moment.' }
}

function refresh(code?: string) {
  revalidatePath('/sli')
  revalidatePath('/sli/discovery')
  if (code) revalidatePath(`/sli/discovery/${code}`)
}

export async function raiseTriggerAction(input: z.input<typeof RaiseSchema>): Promise<Result<{ code: string }>> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = RaiseSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const { code } = await sliRpc<{ id: string; code: string }>(supabase, 'sli_raise_trigger', {
      p_title: v.title,
      p_trigger_type: v.triggerType,
      p_summary: v.summary,
      p_event_date: v.eventDate,
      p_event_reference: v.eventReference,
      p_strategic_objective: v.strategicObjective,
      p_source_department: v.sourceDepartmentId,
    })
    refresh(code)
    return { ok: true, code }
  } catch (err) {
    return failure(err)
  }
}

export async function transitionTriggerAction(input: z.input<typeof TransitionSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = TransitionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That change isn’t valid.' }
  try {
    const { supabase } = await requireUser()
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_transition_trigger', {
      p_trigger: parsed.data.triggerId,
      p_to_stage: parsed.data.toStage,
      p_reason: parsed.data.reason,
    })
    refresh(code)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

export async function setTriggerArchivedAction(input: z.input<typeof ArchiveSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = ArchiveSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That change isn’t valid.' }
  try {
    const { supabase } = await requireUser()
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_set_trigger_archived', {
      p_trigger: parsed.data.triggerId,
      p_archived: parsed.data.archived,
      p_reason: parsed.data.reason,
    })
    refresh(code)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

export async function setTriggerContributorAction(input: z.input<typeof ContributorSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = ContributorSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That change isn’t valid.' }
  try {
    const { supabase } = await requireUser()
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_set_trigger_contributor', {
      p_trigger: parsed.data.triggerId,
      p_user: parsed.data.userId,
      p_add: parsed.data.add,
    })
    refresh(code)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const OUTCOMES = ['approve', 'revise', 'defer', 'reject'] as const

const RecommendationSchema = z.object({
  triggerId: z.string().uuid(),
  recommendation: z.enum(OUTCOMES),
  destinationId: z.string().uuid().optional().or(z.literal('')).transform((v) => (v ? v : null)),
  comments: optionalText(4000),
})

export async function recordRecommendationAction(input: z.input<typeof RecommendationSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = RecommendationSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Check the recommendation.' }
  try {
    const { supabase } = await requireUser()
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_record_recommendation', {
      p_trigger: parsed.data.triggerId,
      p_recommendation: parsed.data.recommendation,
      p_destination: parsed.data.destinationId,
      p_comments: parsed.data.comments,
    })
    refresh(code)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const DecisionSchema = z.object({
  triggerId: z.string().uuid(),
  outcome: z.enum(OUTCOMES),
  rationale: z.string().trim().min(3, 'Give the rationale for the decision').max(8000),
  destinationId: z.string().uuid().optional().or(z.literal('')).transform((v) => (v ? v : null)),
  returnToStage: z.enum(['researching', 'concept', 'feasibility']).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  conditions: optionalText(4000),
  evidence: z.array(z.string().uuid()).max(50).default([]),
  shareWithRaiser: z.boolean().default(false),
})

export async function recordDecisionAction(input: z.input<typeof DecisionSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = DecisionSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the decision.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_record_decision', {
      p_trigger: v.triggerId,
      p_outcome: v.outcome,
      p_rationale: v.rationale,
      p_destination: v.destinationId,
      p_return_to_stage: v.returnToStage,
      p_conditions: v.conditions,
      p_evidence: v.evidence,
      p_share_with_raiser: v.shareWithRaiser,
    })
    refresh(code)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const DelegateSchema = z.object({
  userId: z.string().uuid().nullable(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  until: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export async function setDecisionDelegateAction(input: z.input<typeof DelegateSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = DelegateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Choose a delegate and both dates.' }
  try {
    const { supabase } = await requireUser()
    await sliRpc(supabase, 'sli_set_decision_delegate', { p_user: parsed.data.userId, p_from: parsed.data.from, p_until: parsed.data.until })
    refresh()
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}
