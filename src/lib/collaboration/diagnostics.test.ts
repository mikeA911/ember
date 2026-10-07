import { describe, expect, it } from 'vitest'
import { MAX_SAMPLES, emptySamples, formatDuration, percentile, pushSample, rate, resultsText, summarize } from './diagnostics'

describe('connection check', () => {
  it('computes percentiles over the samples', () => {
    expect(percentile([], 50)).toBeNull()
    expect(percentile([300, 100, 200], 50)).toBe(200)
    expect(percentile([100, 200, 300, 400, 1000], 90)).toBe(1000)
  })

  it('keeps only the latest samples', () => {
    const list: number[] = []
    for (let i = 0; i < MAX_SAMPLES + 50; i++) pushSample(list, i)
    expect(list).toHaveLength(MAX_SAMPLES)
    expect(list[0]).toBe(50)
  })

  it('rates the connection from round trips and failures', () => {
    expect(rate(300, 0)).toBe('good')
    expect(rate(900, 0.05)).toBe('fair')
    expect(rate(400, 0.25)).toBe('poor')
    expect(rate(null, null)).toBe('unknown')
  })

  it('summarizes, and says unknown until there are a few polls', () => {
    const s = emptySamples(0)
    expect(summarize(s, 0).rating).toBe('unknown')
    for (const v of [120, 140, 160, 900]) pushSample(s.pollRoundTripsMs, v)
    s.pollSuccesses = 4
    s.pollFailures = 1
    pushSample(s.changeSeenWithinMs, 1800)
    const summary = summarize(s, 5 * 60_000)
    expect(summary).toMatchObject({ polls: 5, failureRate: 0.2, pollMedianMs: 140, pollP90Ms: 900, rating: 'poor', minutes: 5, changesSeen: 1 })
  })

  it('writes results without any content, only timings and the browser', () => {
    const s = emptySamples(0)
    s.pollSuccesses = 3
    for (const v of [100, 110, 120]) pushSample(s.pollRoundTripsMs, v)
    const text = resultsText(summarize(s, 60_000), { who: 'Hana Host', role: 'host', browser: 'Firefox 131', screen: '1280x800', at: '7 Oct 2026' })
    expect(text).toContain('Connection: good')
    expect(text).toContain('Poll round trip: median 110 ms')
    expect(text).toContain('Browser: Firefox 131')
    expect(formatDuration(1500)).toBe('1.5 s')
  })
})
