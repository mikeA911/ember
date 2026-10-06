import { parseSharedLocation, sameLocation, sharedPath } from './locations'
import type { SessionSnapshot } from './types'

// What this tab should do about navigation, given the session and where
// the tab is:
//   - the controller's tab, on a shared page that isn't the shared
//     location yet, reports it (moving both browsers);
//   - a following observer's tab, anywhere but the shared location, goes
//     there;
//   - otherwise nothing. A controller on a page that isn't shared moves
//     nobody: unsupported pages are never mirrored.
export type FollowDecision = { kind: 'report'; workstreamId: string | null } | { kind: 'go'; path: string } | { kind: 'none' }

export function decideFollow(input: {
  session: SessionSnapshot | null
  userId: string
  pathname: string
  following: boolean
}): FollowDecision {
  const { session, userId, pathname, following } = input
  if (!session || session.status !== 'active' || !session.thisTabJoined) return { kind: 'none' }
  if (session.controllerId === userId) {
    const here = parseSharedLocation(pathname, session.projectId)
    if (here && !sameLocation(here, session.location)) return { kind: 'report', workstreamId: here.workstreamId }
    return { kind: 'none' }
  }
  if (!following) return { kind: 'none' }
  const target = sharedPath(session.projectId, session.location.workstreamId)
  return normalize(pathname) === target.toLowerCase() ? { kind: 'none' } : { kind: 'go', path: target }
}

// Where this tab should be while it follows the controller, or null when it
// isn't following (it's the controller, not the joined tab, or the person
// stepped away). Deliberately independent of the current path: an
// observer is moved when this changes, never in reaction to their own
// navigation -- that only decides whether they're still following.
export function followTarget(session: SessionSnapshot | null, userId: string, following: boolean): string | null {
  if (!session || session.status !== 'active' || !session.thisTabJoined || session.controllerId === userId || !following) return null
  return sharedPath(session.projectId, session.location.workstreamId)
}

export function isAtSharedLocation(session: SessionSnapshot, pathname: string): boolean {
  const here = parseSharedLocation(pathname, session.projectId)
  return !!here && sameLocation(here, session.location)
}

function normalize(pathname: string): string {
  return (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname).toLowerCase()
}
