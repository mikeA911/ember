'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/lib/auth'
import * as workbench from '@/lib/workbench/workstreams'
import { cloneWorkstream } from '@/lib/workbench/project-cloning'
import type { ArtifactType, WorkstreamLifecycleStage } from '@/types/database'

export async function createWorkstreamAction(input: {
  projectId: string
  name: string
  slug: string
  repositoryScope: string[]
  goal?: string
  guardrail?: string
  deliverables: string[]
  lifecycleStage?: WorkstreamLifecycleStage | null
}) {
  const ctx = await requireUser()
  const result = await workbench.createWorkstream(ctx, input)
  revalidatePath(`/projects/${result.projectId}`)
  return { workstreamId: result.workstreamId }
}

// Builder Ontology, Part B: duplicates one workstream's own subtree within
// the same project, for comparison -- same owner/curator/admin bar as
// createWorkstream (cloneWorkstream's own check).
export async function cloneWorkstreamAction(workstreamId: string) {
  const ctx = await requireUser()
  const result = await cloneWorkstream(ctx, workstreamId)
  revalidatePath(`/projects/${result.projectId}`)
  return { workstreamId: result.workstreamId, projectId: result.projectId }
}

export async function toggleDeliverableAction(workstreamId: string, index: number) {
  const ctx = await requireUser()
  const { projectId } = await workbench.toggleDeliverable(ctx, workstreamId, index)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
}

export async function updateWorkstreamSummaryAction(workstreamId: string, summary: string) {
  const ctx = await requireUser()
  const { projectId } = await workbench.updateWorkstreamSummary(ctx, workstreamId, summary)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
}

export async function attachArtifactAction(input: {
  workstreamId: string
  artifactType: ArtifactType
  title: string
  externalTool?: string
  content?: string
  externalUrl?: string
  notes?: string
}) {
  const ctx = await requireUser()
  const { projectId } = await workbench.attachArtifact(ctx, input)
  revalidatePath(`/projects/${projectId}/workstreams/${input.workstreamId}`)
}

export async function reviewArtifactAction(artifactId: string, decision: 'approved' | 'rejected', projectId: string, workstreamId: string, notes?: string) {
  const ctx = await requireUser()
  await workbench.reviewArtifact(ctx, artifactId, decision, notes)
  revalidatePath(`/projects/${projectId}/workstreams/${workstreamId}`)
}
