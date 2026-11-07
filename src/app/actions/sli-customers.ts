'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AuthError, requireUser } from '@/lib/auth'
import { SliError, sliRpc } from '@/lib/sli/api'
import { sliEnabled } from '@/lib/sli/flag'
import type { CustomerListItem, DuplicateMatch } from '@/lib/sli/types'

// Ember SLI customer core and candidate customers (S3 part 3). Each call
// runs as the signed-in person through a security-definer function that
// checks their organisation and department
// (supabase/migrations/20261109100001_sli_customers_and_candidates.sql).

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null))
const uuidOrNull = z.string().uuid().optional().or(z.literal('')).transform((v) => (v ? v : null))
const dateOrNull = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^\d{4}-\d{2}-\d{2}$/.test(v), 'Use a valid date')

function failure(err: unknown): { ok: false; error: string } {
  if (err instanceof SliError || err instanceof AuthError) return { ok: false, error: err.message }
  return { ok: false, error: 'Something went wrong. Try again in a moment.' }
}

const CustomerSchema = z.object({
  id: uuidOrNull,
  name: z.string().trim().min(2, 'Give the company name').max(200),
  website: text(300),
  mainPhone: text(40),
  industry: text(100),
  subIndustry: text(100),
  region: text(100),
  parentId: uuidOrNull,
  lifecycleStatus: text(60),
  priority: z.enum(['low', 'medium', 'high']).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  overrideReason: text(1000),
})

export async function saveCustomerAction(input: z.input<typeof CustomerSchema>): Promise<Result<{ id: string }>> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = CustomerSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const { id } = await sliRpc<{ id: string }>(supabase, 'sli_save_customer', {
      p_id: v.id,
      p_name: v.name,
      p_website: v.website,
      p_main_phone: v.mainPhone,
      p_industry: v.industry,
      p_sub_industry: v.subIndustry,
      p_region: v.region,
      p_parent_id: v.parentId,
      p_lifecycle_status: v.lifecycleStatus,
      p_priority: v.priority,
      p_override_reason: v.overrideReason,
    })
    revalidatePath('/sli/customers')
    revalidatePath(`/sli/customers/${id}`)
    return { ok: true, id }
  } catch (err) {
    return failure(err)
  }
}

export async function findCustomerDuplicatesAction(input: { name: string; website?: string; mainPhone?: string; excludeId?: string }): Promise<DuplicateMatch[]> {
  if (!sliEnabled() || !input.name?.trim()) return []
  try {
    const { supabase } = await requireUser()
    return await sliRpc<DuplicateMatch[]>(supabase, 'sli_find_customer_duplicates', {
      p_name: input.name.slice(0, 200),
      p_website: input.website?.slice(0, 300) || null,
      p_phone: input.mainPhone?.slice(0, 40) || null,
      p_exclude: input.excludeId || null,
    })
  } catch {
    return []
  }
}

export async function searchCustomersAction(input: { search?: string; technology?: string }): Promise<CustomerListItem[]> {
  if (!sliEnabled()) return []
  try {
    const { supabase } = await requireUser()
    return await sliRpc<CustomerListItem[]>(supabase, 'sli_list_customers', {
      p_search: input.search?.slice(0, 200) || null,
      p_technology: input.technology?.slice(0, 100) || null,
      p_limit: 25,
    })
  } catch {
    return []
  }
}

const AssignSchema = z.object({
  customerId: z.string().uuid(),
  role: z.enum(['account_rep', 'isr_owner', 'account_owner']),
  userId: uuidOrNull,
})

export async function assignCustomerAction(input: z.input<typeof AssignSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = AssignSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'Check the assignment.' }
  try {
    const { supabase } = await requireUser()
    await sliRpc(supabase, 'sli_assign_customer', { p_customer: parsed.data.customerId, p_role: parsed.data.role, p_user: parsed.data.userId })
    revalidatePath(`/sli/customers/${parsed.data.customerId}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const RankingSchema = z.object({
  customerId: z.string().uuid(),
  type: z.enum(['top1000', 'bsp']),
  rank: z.coerce.number().int().positive('Give a rank above zero'),
  asOf: dateOrNull,
  source: text(200),
  reference: text(1000),
})

export async function recordRankingAction(input: z.input<typeof RankingSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = RankingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the ranking.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    await sliRpc(supabase, 'sli_record_customer_ranking', {
      p_customer: v.customerId,
      p_type: v.type,
      p_rank: v.rank,
      p_as_of: v.asOf,
      p_source: v.source,
      p_reference: v.reference,
    })
    revalidatePath(`/sli/customers/${v.customerId}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const TechnologySchema = z.object({
  customerId: z.string().uuid(),
  id: uuidOrNull,
  category: z.enum(['virtualisation', 'storage', 'backup_dr', 'cloud', 'network', 'security', 'database', 'other']),
  vendor: z.string().trim().max(100).default(''),
  product: text(100),
  status: z.enum(['in_use', 'evaluating', 'replacing', 'retired']).default('in_use'),
  suppliedBySandz: z.boolean().default(false),
  scale: text(200),
  renewalDate: dateOrNull,
  notes: text(2000),
  remove: z.boolean().default(false),
})

export async function saveTechnologyAction(input: z.input<typeof TechnologySchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = TechnologySchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the entry.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    await sliRpc(supabase, 'sli_save_customer_technology', {
      p_customer: v.customerId,
      p_id: v.id,
      p_category: v.category,
      p_vendor: v.vendor,
      p_product: v.product,
      p_status: v.status,
      p_supplied_by_sandz: v.suppliedBySandz,
      p_scale: v.scale,
      p_renewal_date: v.renewalDate,
      p_notes: v.notes,
      p_remove: v.remove,
    })
    revalidatePath(`/sli/customers/${v.customerId}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const CandidateSchema = z.object({
  triggerId: z.string().uuid(),
  customerId: z.string().uuid(),
  tier: z.enum(['existing_customer', 'related_company', 'new_prospect']),
  fitRationale: z.string().trim().min(3, 'Say why this company is a candidate').max(4000),
  solutionFit: z.enum(['strong', 'partial', 'poor', 'unknown']).default('unknown'),
  priority: z.enum(['low', 'medium', 'high']).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  relationshipPath: text(500),
  targetIndustry: text(100),
  knownRelationships: text(2000),
  evidenceReference: text(2000),
})

export async function addCandidateAction(input: z.input<typeof CandidateSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = CandidateSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the candidate.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_add_candidate_customer', {
      p_trigger: v.triggerId,
      p_customer: v.customerId,
      p_tier: v.tier,
      p_fit_rationale: v.fitRationale,
      p_solution_fit: v.solutionFit,
      p_priority: v.priority,
      p_relationship_path: v.relationshipPath,
      p_target_industry: v.targetIndustry,
      p_known_relationships: v.knownRelationships,
      p_evidence_reference: v.evidenceReference,
    })
    revalidatePath(`/sli/discovery/${code}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

export async function setCandidateStatusAction(input: { candidateId: string; status: 'accepted' | 'removed'; reason?: string }): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  if (!z.string().uuid().safeParse(input.candidateId).success) return { ok: false, error: 'That change isn’t valid.' }
  try {
    const { supabase } = await requireUser()
    const { code } = await sliRpc<{ code: string }>(supabase, 'sli_set_candidate_status', {
      p_candidate: input.candidateId,
      p_status: input.status,
      p_reason: input.reason?.slice(0, 1000) ?? null,
    })
    revalidatePath(`/sli/discovery/${code}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

// Company profile (the Lead Form's company fields) and contacts
// (supabase/migrations/20261113100001_sli_contacts.sql).

const ProfileSchema = z.object({
  customerId: z.string().uuid(),
  overview: text(4000),
  productsServices: text(4000),
  notableCustomers: text(2000),
  address: text(500),
  employeeCount: text(50),
  procurementType: z.enum(['local', 'global_mandate', 'local_and_global']).optional().or(z.literal('')).transform((v) => (v ? v : null)),
})

export async function saveCustomerProfileAction(input: z.input<typeof ProfileSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = ProfileSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    await sliRpc(supabase, 'sli_save_customer_profile', {
      p_customer: v.customerId,
      p_overview: v.overview,
      p_products_services: v.productsServices,
      p_notable_customers: v.notableCustomers,
      p_address: v.address,
      p_employee_count: v.employeeCount,
      p_procurement_type: v.procurementType,
    })
    revalidatePath(`/sli/customers/${v.customerId}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

const MethodSchema = z.object({
  kind: z.enum(['email', 'mobile', 'landline', 'viber', 'whatsapp', 'linkedin', 'other']),
  value: z.string().trim().max(300),
  isPrimary: z.boolean().default(false),
  optedOut: z.boolean().default(false),
})

const ContactSchema = z.object({
  id: uuidOrNull,
  firstName: z.string().trim().min(1, 'Give the first name').max(100),
  lastName: text(100),
  buyingRole: z.enum(['decision_maker', 'influencer', 'user', 'other']).optional().or(z.literal('')).transform((v) => (v ? v : null)),
  marketingConsent: z.enum(['unknown', 'given', 'withdrawn']).default('unknown'),
  consentSource: text(200),
  doNotContact: z.boolean().default(false),
  notes: text(4000),
  methods: z.array(MethodSchema).max(20),
  customerId: uuidOrNull,
  jobTitle: text(200),
  department: text(200),
  isPrimary: z.boolean().default(false),
})

export async function saveContactAction(input: z.input<typeof ContactSchema>): Promise<Result<{ id: string }>> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = ContactSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const { id } = await sliRpc<{ id: string }>(supabase, 'sli_save_contact', {
      p_id: v.id,
      p_first_name: v.firstName,
      p_last_name: v.lastName,
      p_buying_role: v.buyingRole,
      p_marketing_consent: v.marketingConsent,
      p_consent_source: v.consentSource,
      p_do_not_contact: v.doNotContact,
      p_notes: v.notes,
      p_methods: v.methods.filter((m) => m.value),
      p_customer: v.customerId,
      p_job_title: v.jobTitle,
      p_department: v.department,
      p_is_primary: v.isPrimary,
    })
    revalidatePath('/sli/contacts')
    revalidatePath(`/sli/contacts/${id}`)
    if (v.customerId) revalidatePath(`/sli/customers/${v.customerId}`)
    return { ok: true, id }
  } catch (err) {
    return failure(err)
  }
}

const LinkSchema = z.object({
  linkId: z.string().uuid(),
  jobTitle: text(200),
  department: text(200),
  isPrimary: z.boolean().default(false),
  endedOn: dateOrNull,
})

export async function updateContactLinkAction(input: z.input<typeof LinkSchema>): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  const parsed = LinkSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the form.' }
  try {
    const { supabase } = await requireUser()
    const v = parsed.data
    const r = await sliRpc<{ id: string; customerId: string }>(supabase, 'sli_update_contact_link', {
      p_link: v.linkId,
      p_job_title: v.jobTitle,
      p_department: v.department,
      p_is_primary: v.isPrimary,
      p_ended_on: v.endedOn,
    })
    revalidatePath(`/sli/contacts/${r.id}`)
    revalidatePath(`/sli/customers/${r.customerId}`)
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}

export async function archiveContactAction(input: { contactId: string; reason: string }): Promise<Result> {
  if (!sliEnabled()) return { ok: false, error: 'Not available.' }
  if (!z.string().uuid().safeParse(input.contactId).success) return { ok: false, error: 'Contact not found.' }
  try {
    const { supabase } = await requireUser()
    await sliRpc(supabase, 'sli_archive_contact', { p_contact: input.contactId, p_reason: input.reason.slice(0, 500) })
    revalidatePath('/sli/contacts')
    revalidatePath('/sli/customers', 'layout')
    return { ok: true }
  } catch (err) {
    return failure(err)
  }
}
