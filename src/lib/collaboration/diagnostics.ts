// Shared workspace sessions, Phase 4 pilot: what one browser can measure
// about its own connection to a live session, for the pilot's Connection
// check (the session bar). Everything is measured on this browser's own
// clock -- no clock agreement between the two people's computers is
// needed:
// - round trip: how long each poll and command took to come back;
// - failures: polls that didn't come back;
// - change seen within: when a poll brings a change made by someone else,
//   it happened after the previous poll left this browser, so the time
//   since then is an upper bound on how long the change took to arrive;
// - Ember answer: from asking (in this tab) to the answer showing here.
// Pure functions over a bounded sample, so they are unit-tested.

export const MAX_SAMPLES = 200

export interface DiagnosticSamples {
  startedAt: number
  pollRoundTripsMs: number[]
  pollFailures: number
  pollSuccesses: number
  commandRoundTripsMs: number[]
  changeSeenWithinMs: number[]
  emberAnswerMs: number[]
}

export function emptySamples(now: number): DiagnosticSamples {
  return { startedAt: now, pollRoundTripsMs: [], pollFailures: 0, pollSuccesses: 0, commandRoundTripsMs: [], changeSeenWithinMs: [], emberAnswerMs: [] }
}

// Appends to a sample list, keeping the latest MAX_SAMPLES.
export function pushSample(list: number[], value: number) {
  list.push(Math.max(0, Math.round(value)))
  if (list.length > MAX_SAMPLES) list.splice(0, list.length - MAX_SAMPLES)
}

export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const rank = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[rank]
}

export type ConnectionRating = 'good' | 'fair' | 'poor' | 'unknown'

export interface DiagnosticSummary {
  rating: ConnectionRating
  minutes: number
  polls: number
  failureRate: number | null
  pollMedianMs: number | null
  pollP90Ms: number | null
  commandMedianMs: number | null
  commandP90Ms: number | null
  changeSeenMedianMs: number | null
  changeSeenP90Ms: number | null
  changesSeen: number
  emberAnswerMedianMs: number | null
  emberAnswers: number
}

// good: polls come back fast and almost never fail; poor: slow or often
// failing (what people see may lag by several seconds).
export function rate(p90Ms: number | null, failureRate: number | null): ConnectionRating {
  if (p90Ms === null || failureRate === null) return 'unknown'
  if (p90Ms <= 600 && failureRate <= 0.02) return 'good'
  if (p90Ms <= 1500 && failureRate <= 0.1) return 'fair'
  return 'poor'
}

export function summarize(s: DiagnosticSamples, now: number): DiagnosticSummary {
  const polls = s.pollSuccesses + s.pollFailures
  const failureRate = polls > 0 ? s.pollFailures / polls : null
  const pollP90Ms = percentile(s.pollRoundTripsMs, 90)
  return {
    rating: polls < 3 ? 'unknown' : rate(pollP90Ms, failureRate),
    minutes: Math.max(0, Math.round((now - s.startedAt) / 60_000)),
    polls,
    failureRate,
    pollMedianMs: percentile(s.pollRoundTripsMs, 50),
    pollP90Ms,
    commandMedianMs: percentile(s.commandRoundTripsMs, 50),
    commandP90Ms: percentile(s.commandRoundTripsMs, 90),
    changeSeenMedianMs: percentile(s.changeSeenWithinMs, 50),
    changeSeenP90Ms: percentile(s.changeSeenWithinMs, 90),
    changesSeen: s.changeSeenWithinMs.length,
    emberAnswerMedianMs: percentile(s.emberAnswerMs, 50),
    emberAnswers: s.emberAnswerMs.length,
  }
}

const ms = (v: number | null) => (v === null ? '—' : v >= 10_000 ? `${(v / 1000).toFixed(0)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`)
const pct = (v: number | null) => (v === null ? '—' : `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`)

export function formatDuration(v: number | null): string {
  return ms(v)
}

// The text "Copy results" puts on the clipboard, for the pilot's results
// template. Nothing about content: only timings and the browser.
export function resultsText(summary: DiagnosticSummary, context: { who: string; role: string; browser: string; screen: string; at: string }): string {
  return [
    `Ember live collaboration -- connection check`,
    `When: ${context.at}`,
    `Who: ${context.who} (${context.role})`,
    `Browser: ${context.browser}`,
    `Screen: ${context.screen}`,
    `Measured over: ${summary.minutes} min, ${summary.polls} polls`,
    `Connection: ${summary.rating}`,
    `Poll round trip: median ${ms(summary.pollMedianMs)}, 90th percentile ${ms(summary.pollP90Ms)}; failed ${pct(summary.failureRate)}`,
    `Commands (control, navigation, saves): median ${ms(summary.commandMedianMs)}, 90th percentile ${ms(summary.commandP90Ms)}`,
    `Others' changes seen within: median ${ms(summary.changeSeenMedianMs)}, 90th percentile ${ms(summary.changeSeenP90Ms)} (${summary.changesSeen} changes)`,
    `Ember answers asked here: median ${ms(summary.emberAnswerMedianMs)} (${summary.emberAnswers} answers)`,
  ].join('\n')
}
