// How often the browser asks Supabase for the session state. Phase 1
// transport is polling, straight from the browser to Supabase (never
// through the app server): private Realtime channels on the live backend
// returned MissingPartition in Phase 0 and that is unresolved. The poll is
// also the presence heartbeat, so a tab in a session must poll well
// inside the database's 90-second presence window (browsers slow a
// background tab's timers to about once a minute).
//
// Realtime can replace this later as a "something changed, fetch now"
// hint; the poll stays as the fallback and the authority stays the same
// database call.

export const POLL = {
  sessionVisibleMs: 2_000,
  sessionHiddenMs: 10_000,
  // Not in a session: fast while the person is using Ember, so an
  // invitation shows up within seconds; slow once they've stopped.
  idleActiveVisibleMs: 5_000,
  idleVisibleMs: 30_000,
  idleHiddenMs: 30_000,
  maxBackoffMs: 30_000,
  // In a session (or about to be), or while the person is using Ember:
  // back off less, so a dropping connection still catches up (or shows an
  // invitation) within seconds once a poll gets through.
  sessionMaxBackoffMs: 10_000,
  // "Using Ember" = any input this recently.
  recentlyActiveMs: 10 * 60_000,
}

// waiting: this person sent an invitation that is still pending, so the
// session may start any moment -- poll as if in one.
// recentlyActive: input in this tab within POLL.recentlyActiveMs.
export function nextPollDelay(input: {
  inSession: boolean
  waiting?: boolean
  recentlyActive?: boolean
  hidden: boolean
  consecutiveFailures: number
}): number {
  const base =
    input.inSession || input.waiting
      ? input.hidden
        ? POLL.sessionHiddenMs
        : POLL.sessionVisibleMs
      : input.hidden
        ? POLL.idleHiddenMs
        : input.recentlyActive
          ? POLL.idleActiveVisibleMs
          : POLL.idleVisibleMs
  // One failed poll is retried at the normal rate (a dropping connection
  // loses odd requests); back off only from the second failure in a row.
  if (input.consecutiveFailures <= 1) return base
  const cap = (input.inSession || input.waiting || input.recentlyActive) && !input.hidden ? POLL.sessionMaxBackoffMs : POLL.maxBackoffMs
  return Math.min(cap, base * 2 ** Math.min(input.consecutiveFailures - 1, 5))
}
