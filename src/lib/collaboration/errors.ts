// The collaboration functions raise person-facing messages with SQLSTATE
// class EC (see the migrations): EC001 general, EC002 "open in another of
// your tabs", EC003 "out of date", EC004 "changed outside the session".
// Those messages are shown as written; anything else (access denied, network, database details) is replaced
// with a fixed message so nothing internal reaches the page.

export type CollaborationErrorKind = 'general' | 'other_tab' | 'stale' | 'conflict' | 'denied' | 'unavailable'

export class CollaborationError extends Error {
  constructor(
    message: string,
    readonly kind: CollaborationErrorKind
  ) {
    super(message)
    this.name = 'CollaborationError'
  }
}

export function toCollaborationError(error: { code?: string | null; message?: string | null } | null | undefined): CollaborationError {
  const code = error?.code ?? ''
  const message = error?.message ?? ''
  if (code === 'EC001' && message) return new CollaborationError(message, 'general')
  if (code === 'EC002' && message) return new CollaborationError(message, 'other_tab')
  if (code === 'EC003' && message) return new CollaborationError(message, 'stale')
  if (code === 'EC004' && message) return new CollaborationError(message, 'conflict')
  if (code === '42501') return new CollaborationError('You don’t have access to this live session.', 'denied')
  return new CollaborationError('Collaboration is unavailable right now. Try again in a moment.', 'unavailable')
}
