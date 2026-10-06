// Solution conformance, Stage 4: which requirements a change probably
// affects, to preselect them when recording it. Shared by the server page
// and the client form; the person recording the change confirms the list.
//
// A change to a component affects requirements scoped to it or to any of
// its sub-components; a change in a workstream affects requirements scoped
// to that workstream.

export interface ScopedRequirement {
  id: string
  objectIds: string[]
  workstreamIds: string[]
}

export function descendantObjectIds(objectId: string, objects: { id: string; parentId: string | null }[]): Set<string> {
  const ids = new Set([objectId])
  let grew = true
  while (grew) {
    grew = false
    for (const o of objects) {
      if (o.parentId && ids.has(o.parentId) && !ids.has(o.id)) {
        ids.add(o.id)
        grew = true
      }
    }
  }
  return ids
}

export function requirementsAffectedBy(
  change: { objectId?: string | null; workstreamId?: string | null },
  requirements: ScopedRequirement[],
  objects: { id: string; parentId: string | null }[]
): string[] {
  const objectIds = change.objectId ? descendantObjectIds(change.objectId, objects) : new Set<string>()
  return requirements
    .filter((r) => r.objectIds.some((id) => objectIds.has(id)) || (!!change.workstreamId && r.workstreamIds.includes(change.workstreamId)))
    .map((r) => r.id)
}
