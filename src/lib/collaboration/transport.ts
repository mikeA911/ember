// How often the browser asks Supabase for the session state. Phase 1
// transport is polling, straight from the browser to Supabase (never
// through the app server): private Realtime channels on the live backend
// returned MissingPartition in Phase 0 and that is unresolved. The poll is
// also the presence heartbeat, so a visible tab in a session must poll
// well inside the database's 30-second presence window.
//
// Realtime can replace this later as a "something changed, fetch now"
// hint; the poll stays as the fallback and the authority stays the same
// database call.

export const POLL = {
  sessionVisibleMs: 2_000,
  sessionHiddenMs: 10_000,
  idleVisibleMs: 15_000,
  idleHiddenMs: 60_000,
  maxBackoffMs: 30_000,
}

// waiting: this person has sent an invitation that is still pending, so the
// session may start any moment -- poll as if in one.
export function nextPollDelay(input: { inSession: boolean; waiting?: boolean; hidden: boolean; consecutiveFailures: number }): number {
  const base = input.inSession || input.waiting
    ? input.hidden
      ? POLL.sessionHiddenMs
      : POLL.sessionVisibleMs
    : input.hidden
      ? POLL.idleHiddenMs
      : POLL.idleVisibleMs
  if (input.consecutiveFailures <= 0) return base
  return Math.min(POLL.maxBackoffMs, base * 2 ** Math.min(input.consecutiveFailures, 5))
}
