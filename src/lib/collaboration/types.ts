// DTOs returned by the collaboration_* database functions
// (supabase/migrations/20261023100001_collaboration_sessions.sql). Shapes
// only -- the database is the authority for every field.

export interface CollaborationPerson {
  id: string
  name: string
  // This person's tab polled within the presence window.
  present: boolean
  // They pressed Leave (and haven't rejoined).
  left: boolean
  // No input or command for 10 minutes (connected or not).
  away: boolean
  inactiveSeconds: number
}

export interface CollaborationViewer {
  userId: string
  name: string
  addedByName: string | null
  addedAt: string
}

export interface SessionSnapshot {
  id: string
  conversationId: string
  projectId: string
  projectName: string
  status: 'active' | 'ended'
  endReason: 'ended_by_host' | 'everyone_left' | 'inactive' | 'participant_inactive' | 'expired' | 'access_revoked' | null
  myRole: 'host' | 'guest'
  host: CollaborationPerson
  guest: CollaborationPerson
  controllerId: string
  controlGeneration: number
  stateRevision: number
  controlRequestedBy: string | null
  // workstreamId null = the Project page.
  location: { workstreamId: string | null; workstreamName: string | null }
  thisTabJoined: boolean
  otherTabActive: boolean
  iLeft: boolean
  // While live: seconds until the session ends on its own, and which rule.
  endsInSeconds: number | null
  endingReason: 'inactive' | 'participant_inactive' | 'expired' | null
  // The controller is away or not connected, so the caller may take control.
  canTakeControl: boolean
  // Viewers added to the conversation, and those watching right now.
  viewers: CollaborationViewer[]
  watching: { userId: string; name: string }[]
}

// A live session on a conversation the caller views, which they may watch.
export interface WatchableSession {
  sessionId: string
  conversationId: string
  projectId: string
  projectName: string
  hostName: string
  guestName: string
}

// What a watcher's tab sees.
export interface WatchSnapshot {
  id: string
  conversationId: string
  projectId: string
  projectName: string
  status: 'active' | 'ended'
  endReason: SessionSnapshot['endReason']
  host: Omit<CollaborationPerson, 'inactiveSeconds'>
  guest: Omit<CollaborationPerson, 'inactiveSeconds'>
  controllerId: string
  stateRevision: number
  location: { workstreamId: string | null; workstreamName: string | null }
  thisTabWatching: boolean
}

export interface CollaborationInvitation {
  id: string
  projectId: string
  projectName: string
  conversationId: string | null
  inviterId: string
  inviterName: string
  inviteeId: string
  inviteeName: string
  status: 'pending' | 'accepted' | 'declined' | 'cancelled' | 'expired'
  expiresAt: string
  sessionId: string | null
}

export interface CollaborationStatus {
  session: SessionSnapshot | null
  incoming: CollaborationInvitation[]
  outgoing: CollaborationInvitation[]
  watchable: WatchableSession[]
}

export interface CollaborationCandidate {
  userId: string
  name: string
  role: string
}

export interface SharedConversationSummary {
  id: string
  projectId: string
  projectName: string
  myRole: 'participant' | 'viewer'
  // The other person, for one of the pair; null for a viewer.
  otherUserId: string | null
  // The other person's name, or "A & B" for a viewer.
  otherName: string
  createdAt: string
  lastActivityAt: string
  liveSessionId: string | null
}

export interface SharedConversationShell {
  id: string
  projectId: string
  projectName: string
  myRole: 'participant' | 'viewer'
  participants: { userId: string; name: string }[]
  viewers: CollaborationViewer[]
  otherUserId: string | null
  otherName: string | null
  createdAt: string
  lastActivityAt: string
  pendingInvitation: CollaborationInvitation | null
  sessions: {
    id: string
    hostName: string
    status: 'active' | 'ended'
    endReason: SessionSnapshot['endReason']
    startedAt: string
    endedAt: string | null
  }[]
}
