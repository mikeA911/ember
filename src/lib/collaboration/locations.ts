// The pages a live session shares (Phase 1): the bound Project's own page
// and its workstream pages -- nothing else is ever mirrored. A shared
// location is a Project id plus an optional workstream id, never a URL
// taken from the other browser, so following can't be steered anywhere
// else.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const PROJECT_PAGE = new RegExp(`^/projects/(${UUID})/?$`, 'i')
const WORKSTREAM_PAGE = new RegExp(`^/projects/(${UUID})/workstreams/(${UUID})/?$`, 'i')
const UUID_ONLY = new RegExp(`^${UUID}$`, 'i')

export interface SharedLocation {
  // null = the Project page.
  workstreamId: string | null
}

// The shared location this path shows inside the given Project, or null
// if the path isn't a shared page of that Project.
export function parseSharedLocation(pathname: string, projectId: string): SharedLocation | null {
  const project = PROJECT_PAGE.exec(pathname)
  if (project) return project[1].toLowerCase() === projectId.toLowerCase() ? { workstreamId: null } : null
  const workstream = WORKSTREAM_PAGE.exec(pathname)
  if (workstream && workstream[1].toLowerCase() === projectId.toLowerCase()) return { workstreamId: workstream[2].toLowerCase() }
  return null
}

export function sharedPath(projectId: string, workstreamId: string | null): string {
  if (!UUID_ONLY.test(projectId) || (workstreamId !== null && !UUID_ONLY.test(workstreamId))) {
    throw new Error('Invalid shared location')
  }
  return workstreamId ? `/projects/${projectId}/workstreams/${workstreamId}` : `/projects/${projectId}`
}

export function sameLocation(a: SharedLocation, b: SharedLocation): boolean {
  return (a.workstreamId ?? '').toLowerCase() === (b.workstreamId ?? '').toLowerCase()
}
