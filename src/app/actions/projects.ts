'use server'

import { revalidatePath } from 'next/cache'
import { requireUser, requireRole, AuthError } from '@/lib/auth'
import { ProjectValidationError } from '@/lib/projects/errors'
import * as workbench from '@/lib/workbench/projects'
import { suggestProjectOntology } from '@/lib/workbench/project-ontology-suggestions'
import { cloneProject } from '@/lib/workbench/project-cloning'
import type {
  ApprovalType,
  ProjectRole,
  ProjectType,
  ProjectMemberStatus,
  PublicProjectProfile,
  PortfolioCategory,
  ProjectDiscoverability,
  WorkstreamLifecycleStage,
} from '@/types/database'

export async function createProjectAction(input: {
  name: string
  projectType: ProjectType
  objective: string
  details: Record<string, string>
  knowledgeBaseId: string | null
  evalDatasetId: string | null
  members: { email: string; role: ProjectRole }[]
  approvals?: { approvalType: ApprovalType; requirementStatus: 'required' | 'optional'; assigneeEmail: string | null }[]
  projectObjects?: { tempId: string; parentTempId: string | null; name: string; slug: string; description?: string }[]
  workstreams?: {
    tempId: string
    parentTempId: string | null
    name: string
    slug: string
    goal?: string
    lifecycleStage?: WorkstreamLifecycleStage
  }[]
}) {
  const ctx = await requireUser()
  const result = await workbench.createProject(ctx, input)
  revalidatePath('/projects')
  return { projectId: result.projectId }
}

// Builder Ontology, Part A: a one-shot "Ask Ember to suggest" call from the
// wizard's own "Domain objects & workstreams" step -- not a chat tool call,
// no confirmation gate needed beyond the wizard's own fully-editable staged
// state (see suggestProjectOntology's own comment for why).
export async function suggestProjectOntologyAction(input: { projectType: ProjectType; objective: string; details: Record<string, string> }) {
  const ctx = await requireUser()
  return suggestProjectOntology(ctx, input)
}

// Builder Ontology, Part B: duplicates a Project (its own project_objects/
// project_workstreams trees, none of its run history) so a builder can
// compare two options side by side. Same owner/curator/admin bar as every
// other structural write in this file (cloneProject's own check).
export async function cloneProjectAction(projectId: string) {
  const ctx = await requireUser()
  const result = await cloneProject(ctx, projectId)
  revalidatePath('/projects')
  return { projectId: result.projectId }
}

// Project owner/curator (or admin) -- checked inside workbench.*, matching
// project_knowledge_bases' RLS -- rather than platform curator role.
// Failures come back as { error } so the reason survives Next's production
// masking of thrown Server Action errors.
export async function attachKnowledgeBaseAction(projectId: string, knowledgeBaseId: string): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    await workbench.attachKnowledgeBase(ctx, projectId, knowledgeBaseId)
  } catch (err) {
    return { error: knowledgeBaseActionError(err, 'Could not attach the knowledge base') }
  }
  revalidatePath(`/projects/${projectId}`)
  return {}
}

export async function createAndAttachKnowledgeBaseAction(
  projectId: string,
  input: { name: string; description?: string }
): Promise<{ error?: string }> {
  const ctx = await requireUser()
  try {
    await workbench.createAndAttachKnowledgeBase(ctx, projectId, input)
  } catch (err) {
    return { error: knowledgeBaseActionError(err, 'Could not create the knowledge base') }
  }
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/upload')
  revalidatePath('/admin')
  return {}
}

export async function detachKnowledgeBaseAction(projectId: string, knowledgeBaseId: string) {
  const ctx = await requireUser()
  await workbench.detachKnowledgeBase(ctx, projectId, knowledgeBaseId)
  revalidatePath(`/projects/${projectId}`)
}

function knowledgeBaseActionError(err: unknown, fallback: string): string {
  if (err instanceof AuthError || err instanceof ProjectValidationError) return err.message
  if (err && typeof err === 'object' && 'code' in err) {
    if (err.code === '23505') return 'That knowledge base is already attached to this project'
    if (err.code === '42501') return "Requires this project's owner or curator role (or platform admin)"
  }
  return fallback
}

export async function attachEvalDatasetAction(projectId: string, datasetId: string) {
  const ctx = await requireRole('curator')
  await workbench.attachEvalDataset(ctx, projectId, datasetId)
  revalidatePath(`/projects/${projectId}`)
}

export async function updateProjectNotesAction(projectId: string, notes: string) {
  const ctx = await requireUser()
  await workbench.updateProjectNotes(ctx, projectId, notes)
  revalidatePath(`/projects/${projectId}`)
}

export async function approveProjectAction(projectId: string) {
  const ctx = await requireUser()
  await workbench.approveProject(ctx, projectId)
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
}

export async function startWorkingOnProjectAction(projectId: string) {
  const ctx = await requireUser()
  await workbench.startWorkingOnProject(ctx, projectId)
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
}

export async function submitProjectForApprovalAction(projectId: string) {
  const ctx = await requireUser()
  await workbench.submitProjectForApproval(ctx, projectId)
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
}

export async function sendProjectBackToWorkingAction(projectId: string) {
  const ctx = await requireUser()
  await workbench.sendProjectBackToWorking(ctx, projectId)
  revalidatePath('/projects')
  revalidatePath(`/projects/${projectId}`)
}

export async function updateProjectGoalAction(projectId: string, goal: string) {
  const ctx = await requireUser()
  await workbench.updateProjectGoal(ctx, projectId, goal)
  revalidatePath(`/projects/${projectId}`)
}

export async function updateProjectObjectiveAction(projectId: string, objective: string) {
  const ctx = await requireUser()
  await workbench.updateProjectObjective(ctx, projectId, objective)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
}

export async function updateProjectStarterPromptAction(projectId: string, starterPrompt: string) {
  const ctx = await requireUser()
  await workbench.updateProjectStarterPrompt(ctx, projectId, starterPrompt)
  revalidatePath(`/projects/${projectId}`)
}

export async function updateProjectPortfolioCategoryAction(projectId: string, category: PortfolioCategory) {
  const ctx = await requireUser()
  await workbench.updateProjectPortfolioCategory(ctx, projectId, category)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/projects')
}

export async function updateProjectDiscoverabilityAction(projectId: string, discoverability: ProjectDiscoverability) {
  const ctx = await requireUser()
  await workbench.updateProjectDiscoverability(ctx, projectId, discoverability)
  revalidatePath(`/projects/${projectId}`)
}

export async function searchProfilesByEmailAction(query: string): Promise<{ id: string; email: string }[]> {
  const ctx = await requireUser()
  return workbench.searchProfilesByEmail(ctx, query)
}

export async function addProjectMemberAction(projectId: string, email: string, role: ProjectRole) {
  const ctx = await requireUser()
  await workbench.addProjectMember(ctx, projectId, email, role)
  revalidatePath(`/projects/${projectId}/members`)
}

export async function createAndAddProjectMemberAction(input: {
  projectId: string
  email: string
  password: string
  projectRole: ProjectRole
  platformRole: 'member' | 'consultant' | 'curator' | 'admin'
}) {
  // Not admin-only -- a project owner/curator can also call this, capped to
  // platformRole 'member'/'consultant'. workbench.createAndAddProjectMember
  // is the real gate (it bypasses RLS via the service-role client to create
  // the auth user, so it can't rely on RLS the way addProjectMember does).
  const ctx = await requireUser()
  await workbench.createAndAddProjectMember(ctx, input)
  revalidatePath(`/projects/${input.projectId}/members`)
}

export async function bulkAddProjectMembersAction(input: {
  projectId: string
  emails: string[]
  projectRole: ProjectRole
  platformRoleForNew: 'member' | 'consultant' | 'curator' | 'admin'
}) {
  const ctx = await requireUser()
  const results = await workbench.bulkAddProjectMembers(ctx, input)
  revalidatePath(`/projects/${input.projectId}/members`)
  return results
}

export async function updateProjectMemberRoleAction(memberId: string, projectId: string, role: ProjectRole) {
  const ctx = await requireUser()
  await workbench.updateProjectMemberRole(ctx, memberId, role)
  revalidatePath(`/projects/${projectId}/members`)
}

export async function updateProjectMemberStatusAction(memberId: string, projectId: string, status: ProjectMemberStatus) {
  const ctx = await requireUser()
  await workbench.updateProjectMemberStatus(ctx, memberId, status)
  revalidatePath(`/projects/${projectId}/members`)
}

export async function transferOwnershipAction(projectId: string, newOwnerMemberId: string) {
  const ctx = await requireUser()
  await workbench.transferOwnership(ctx, projectId, newOwnerMemberId)
  revalidatePath(`/projects/${projectId}/members`)
}

export async function savePublicProfileDraftAction(projectId: string, profile: PublicProjectProfile) {
  const ctx = await requireUser()
  await workbench.savePublicProfileDraft(ctx, projectId, profile)
  revalidatePath(`/projects/${projectId}/publish`)
}

export async function publishProjectAction(projectId: string, publicSlug: string) {
  const ctx = await requireUser()
  await workbench.publishProject(ctx, projectId, publicSlug)
  revalidatePath(`/projects/${projectId}/publish`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/examples')
  revalidatePath(`/examples/${publicSlug}`)
}

export async function setPublicFullDetailAction(projectId: string, enabled: boolean) {
  const ctx = await requireUser()
  await workbench.setPublicFullDetail(ctx, projectId, enabled)
  revalidatePath(`/projects/${projectId}/publish`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/examples')
}

export async function unpublishProjectAction(projectId: string) {
  const ctx = await requireUser()
  await workbench.unpublishProject(ctx, projectId)
  revalidatePath(`/projects/${projectId}/publish`)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/examples')
}
