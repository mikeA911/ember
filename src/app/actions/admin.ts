'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireActiveKnowledgeBase } from '@/lib/knowledge-bases'
import { setBuilderKnowledgeBases } from '@/lib/workbench/builder-knowledge-bases'
import { enrollInOrganizationHome, provisionBuilderProject } from '@/lib/workbench/projects'

// Every action here requires admin first (using the caller's own RLS-scoped
// session), then switches to the service-role client for the actual write --
// the same two-step pattern the old app's admin-api edge function used, just
// living in this app's server runtime instead of a separate Edge Function.

// Curator-creatable (per Mike, 2026-08-28 -- creation moved off the admin
// page and into the /upload flow); always inserted as 'pending' regardless
// of caller, since only kb_admin_manage's RLS policy can move it to
// 'approved'/'rejected' -- see approveKnowledgeBaseAction/rejectKnowledgeBaseAction.
export async function createKnowledgeBase(id: string, name: string, description: string) {
  await requireRole('curator')
  const admin = createAdminClient()
  const { error } = await admin.from('knowledge_bases').insert({ id, name, description: description || null, status: 'pending' })
  if (error) throw error
  revalidatePath('/admin')
  revalidatePath('/upload')
}

export async function approveKnowledgeBaseAction(id: string) {
  await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin.from('knowledge_bases').update({ status: 'approved' }).eq('id', id)
  if (error) throw error
  revalidatePath('/admin')
}

export async function rejectKnowledgeBaseAction(id: string) {
  await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin.from('knowledge_bases').update({ status: 'rejected' }).eq('id', id)
  if (error) throw error
  revalidatePath('/admin')
}

export async function deleteKnowledgeBase(id: string) {
  await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin.from('knowledge_bases').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/admin')
}

export async function addCurationQueueItem(kbId: string, title: string, url: string) {
  const { user, supabase } = await requireRole('curator')
  await requireActiveKnowledgeBase(supabase, kbId)
  const admin = createAdminClient()
  const { error } = await admin.from('curation_queue').insert({ kb_id: kbId, title, url, status: 'pending', added_by: user.id })
  if (error) throw error
  revalidatePath('/admin')
}

export async function deleteCurationQueueItem(id: string) {
  await requireRole('curator')
  const admin = createAdminClient()
  const { error } = await admin.from('curation_queue').delete().eq('id', id)
  if (error) throw error
  revalidatePath('/admin')
}

export async function listAllProfiles() {
  await requireRole('admin')
  const admin = createAdminClient()
  const { data, error } = await admin.from('profiles').select('*').order('email')
  if (error) throw error
  return data
}

export async function updateUserRole(userId: string, role: 'member' | 'consultant' | 'curator' | 'admin') {
  await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ role }).eq('id', userId)
  if (error) throw error
  revalidatePath('/admin')
}

export async function updateUserActive(userId: string, isActive: boolean) {
  await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin.from('profiles').update({ is_active: isActive }).eq('id', userId)
  if (error) throw error
  revalidatePath('/admin')
}

export async function assignKBsToCurator(userId: string, kbIds: string[]) {
  const ctx = await requireRole('admin')
  const { supabase } = ctx
  await Promise.all(kbIds.map((id) => requireActiveKnowledgeBase(supabase, id)))
  const admin = createAdminClient()
  // A builder's assigned knowledge bases are also attached to their
  // workspace so they can actually see them (builder-knowledge-bases.ts).
  const { data: target } = await admin.from('profiles').select('role').eq('id', userId).maybeSingle()
  if (target?.role === 'consultant') {
    await setBuilderKnowledgeBases(ctx, userId, kbIds)
    revalidatePath('/admin')
    revalidatePath('/agency')
    return
  }
  const { error } = await admin.from('profiles').update({ assigned_kbs: kbIds }).eq('id', userId)
  if (error) throw error
  revalidatePath('/admin')
}

// Self-serve registration (/register) is removed -- admin is the only way to
// create an account now. Sets a real password directly (email_confirm: true,
// same as scripts/seed-test-users.mjs) rather than an email invite, since
// this environment has no email delivery configured.
//
// No DB trigger creates a profiles row on auth.users insert -- that only
// happens here, and ensureProfile() (src/app/actions/auth.ts) never creates
// one for a real account -- self-registration is off. So the profile is
// inserted directly, with the role picked here.
export async function createUserAction(input: { email: string; password: string; role: 'member' | 'consultant' | 'curator' | 'admin' }) {
  const { user } = await requireRole('admin')
  if (input.password.length < 8) throw new Error('Password must be at least 8 characters')

  const admin = createAdminClient()
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
  })
  if (createError) throw createError

  const { error: profileError } = await admin.from('profiles').insert({
    id: created.user.id,
    email: input.email,
    full_name: null,
    role: input.role,
    is_active: true,
    assigned_kbs: [],
  })
  if (profileError) throw profileError

  await enrollInOrganizationHome(admin, created.user.id)
  // A new consultant-role account is a builder -- give them a workspace
  // Project immediately, so there's nothing to set up before they can start
  // working. Any other platform role gets no such project (an ordinary
  // member's home is the Organization Home Project alone; curator/admin are
  // the agency's own staff, not builders).
  if (input.role === 'consultant') {
    await provisionBuilderProject(admin, created.user.id, input.email)
    // Builder edition: the platform owner is every builder's agency
    // (20261028100001_builder_edition_agency_rules.sql) -- they approve the
    // builder's promotions and take over Live projects. Reassign from
    // /agency for a deployment with its own agencies.
    const { error: agencyError } = await admin
      .from('agency_builders')
      .insert({ builder_id: created.user.id, agency_id: user.id, assigned_by: user.id })
    if (agencyError) throw agencyError
  }

  revalidatePath('/admin')
}

export async function updateAIProviderSetting(provider: 'openai' | 'gemini') {
  const { user } = await requireRole('admin')
  const admin = createAdminClient()
  const { error } = await admin
    .from('settings')
    .upsert({ key: 'ai_provider', value: provider, updated_by: user.id, updated_at: new Date().toISOString() })
  if (error) throw error
  revalidatePath('/admin')
}

// Final admin sign-off: marks the document (and its curation_queue source
// item, if any) complete. Mirrors the old admin-api edge function's
// approve-document action.
export async function approveDocument(documentId: string) {
  await requireRole('admin')
  const admin = createAdminClient()

  const { error: docError } = await admin.from('documents').update({ processing_status: 'completed', processing_stage: 'completed' }).eq('id', documentId)
  if (docError) throw docError

  const { data: doc } = await admin.from('documents').select('doc_type, source_url').eq('id', documentId).single()
  if (doc?.source_url) {
    await admin.from('curation_queue').update({ status: 'completed' }).eq('kb_id', doc.doc_type).eq('url', doc.source_url)
  }

  revalidatePath('/admin')
  revalidatePath('/dashboard')
}
