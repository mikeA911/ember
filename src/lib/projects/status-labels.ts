import type { ProjectStatus } from '@/types/database'

// Display names for projects.status, shared by every screen that shows it.
// The stored values predate the labels (see
// 20260828100001_project_status_pipeline.sql and
// 20261004100002_project_live_status.sql): 'active' is "Working on it",
// 'review' is "For Approval", 'completed' is "Approved" and now waits for
// the client's approval before the project goes 'live'.
export const PROJECT_STATUS_LABELS: Record<ProjectStatus, string> = {
  draft: 'Initial Draft',
  active: 'Working on it',
  review: 'For Approval',
  completed: 'Approved · awaiting client',
  live: 'Live · maintenance',
  archived: 'Archived',
}

export const PROJECT_STATUS_STYLES: Record<ProjectStatus, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  active: 'bg-amber-100 text-amber-800',
  review: 'bg-blue-100 text-blue-800',
  completed: 'bg-green-100 text-green-800',
  live: 'bg-emerald-600 text-white',
  archived: 'bg-zinc-200 text-zinc-500',
}

export function projectStatusLabel(status: string): string {
  return PROJECT_STATUS_LABELS[status as ProjectStatus] ?? status
}

export function projectStatusStyle(status: string): string {
  return PROJECT_STATUS_STYLES[status as ProjectStatus] ?? 'bg-zinc-100 text-zinc-700'
}
