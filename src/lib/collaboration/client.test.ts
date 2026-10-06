import { describe, expect, it } from 'vitest'
import { toCollaborationError } from './errors'
import { minutesLabel } from './format'
import { decideFollow } from './follow'
import { parseSharedLocation, sharedPath } from './locations'
import { nextPollDelay, POLL } from './transport'
import type { SessionSnapshot } from './types'

const P = '11111111-1111-4111-8111-111111111111'
const W = '22222222-2222-4222-8222-222222222222'
const OTHER = '33333333-3333-4333-8333-333333333333'
const me = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const them = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

function session(over: Partial<SessionSnapshot> = {}): SessionSnapshot {
  return {
    id: 's',
    conversationId: 'c',
    projectId: P,
    projectName: 'P',
    status: 'active',
    endReason: null,
    myRole: 'host',
    host: { id: me, name: 'Me', present: true, left: false, away: false, inactiveSeconds: 0 },
    guest: { id: them, name: 'Them', present: true, left: false, away: false, inactiveSeconds: 0 },
    controllerId: me,
    controlGeneration: 1,
    stateRevision: 1,
    controlRequestedBy: null,
    location: { workstreamId: null, workstreamName: null },
    thisTabJoined: true,
    otherTabActive: false,
    iLeft: false,
    endsInSeconds: 1800,
    endingReason: 'inactive',
    canTakeControl: false,
    ...over,
  }
}

describe('shared locations', () => {
  it('recognizes only the bound Project page and its workstream pages', () => {
    expect(parseSharedLocation(`/projects/${P}`, P)).toEqual({ workstreamId: null })
    expect(parseSharedLocation(`/projects/${P}/`, P)).toEqual({ workstreamId: null })
    expect(parseSharedLocation(`/projects/${P}/workstreams/${W}`, P)).toEqual({ workstreamId: W })
    expect(parseSharedLocation(`/projects/${P}/workstreams/${W}/presentation`, P)).toBeNull()
    expect(parseSharedLocation(`/projects/${P}/members`, P)).toBeNull()
    expect(parseSharedLocation(`/projects/${OTHER}`, P)).toBeNull()
    expect(parseSharedLocation(`/projects/${OTHER}/workstreams/${W}`, P)).toBeNull()
    expect(parseSharedLocation('/admin', P)).toBeNull()
  })

  it('builds paths only from ids, never arbitrary strings', () => {
    expect(sharedPath(P, null)).toBe(`/projects/${P}`)
    expect(sharedPath(P, W)).toBe(`/projects/${P}/workstreams/${W}`)
    expect(() => sharedPath('javascript:alert(1)', null)).toThrow()
    expect(() => sharedPath(P, '../../admin')).toThrow()
  })
})

describe('following', () => {
  it('the controller reports a move to another shared page, and nothing for an unshared page', () => {
    expect(decideFollow({ session: session(), userId: me, pathname: `/projects/${P}/workstreams/${W}`, following: true })).toEqual({
      kind: 'report',
      workstreamId: W,
    })
    expect(decideFollow({ session: session(), userId: me, pathname: `/projects/${P}`, following: true })).toEqual({ kind: 'none' })
    expect(decideFollow({ session: session(), userId: me, pathname: '/dashboard', following: true })).toEqual({ kind: 'none' })
  })

  it('a following observer goes to the shared page; one who stepped away stays put', () => {
    const s = session({ controllerId: them, myRole: 'guest', location: { workstreamId: W, workstreamName: 'Intake' } })
    expect(decideFollow({ session: s, userId: me, pathname: `/projects/${P}`, following: true })).toEqual({
      kind: 'go',
      path: `/projects/${P}/workstreams/${W}`,
    })
    expect(decideFollow({ session: s, userId: me, pathname: `/projects/${P}/workstreams/${W}`, following: true })).toEqual({ kind: 'none' })
    expect(decideFollow({ session: s, userId: me, pathname: '/dashboard', following: false })).toEqual({ kind: 'none' })
  })

  it('a tab that is not the joined tab, or an ended session, does nothing', () => {
    expect(decideFollow({ session: session({ thisTabJoined: false }), userId: me, pathname: `/projects/${P}/workstreams/${W}`, following: true }).kind).toBe('none')
    expect(decideFollow({ session: session({ status: 'ended' }), userId: me, pathname: `/projects/${P}/workstreams/${W}`, following: true }).kind).toBe('none')
    expect(decideFollow({ session: null, userId: me, pathname: '/', following: true }).kind).toBe('none')
  })
})

describe('errors', () => {
  it('shows authored messages and hides everything else', () => {
    expect(toCollaborationError({ code: 'EC001', message: 'Only the host can end the session' })).toMatchObject({
      message: 'Only the host can end the session',
      kind: 'general',
    })
    expect(toCollaborationError({ code: 'EC002', message: 'open in another tab' }).kind).toBe('other_tab')
    expect(toCollaborationError({ code: 'EC003', message: 'Control changed' }).kind).toBe('stale')
    expect(toCollaborationError({ code: '42501', message: 'Collaboration access denied' }).kind).toBe('denied')
    const hidden = toCollaborationError({ code: '23505', message: 'duplicate key value violates unique constraint "x"' })
    expect(hidden.kind).toBe('unavailable')
    expect(hidden.message).not.toMatch(/duplicate key/)
  })
})

describe('polling', () => {
  it('polls fast in a visible session or while waiting on an invitation, and backs off after failures', () => {
    expect(nextPollDelay({ inSession: true, hidden: false, consecutiveFailures: 0 })).toBe(POLL.sessionVisibleMs)
    expect(nextPollDelay({ inSession: true, hidden: true, consecutiveFailures: 0 })).toBe(POLL.sessionHiddenMs)
    expect(nextPollDelay({ inSession: false, waiting: true, hidden: false, consecutiveFailures: 0 })).toBe(POLL.sessionVisibleMs)
    expect(nextPollDelay({ inSession: true, hidden: false, consecutiveFailures: 2 })).toBe(POLL.sessionVisibleMs * 4)
    expect(nextPollDelay({ inSession: false, hidden: true, consecutiveFailures: 9 })).toBe(POLL.maxBackoffMs)
  })

  it('outside a session, polls every 5 seconds while the person is using Ember and every 30 once they stop', () => {
    expect(nextPollDelay({ inSession: false, recentlyActive: true, hidden: false, consecutiveFailures: 0 })).toBe(5_000)
    expect(nextPollDelay({ inSession: false, recentlyActive: false, hidden: false, consecutiveFailures: 0 })).toBe(30_000)
    expect(nextPollDelay({ inSession: false, recentlyActive: true, hidden: true, consecutiveFailures: 0 })).toBe(30_000)
  })

  it('a session tab heartbeats well inside the 90-second presence window, even throttled to once a minute', () => {
    expect(POLL.sessionVisibleMs * 3).toBeLessThan(90_000)
    expect(POLL.sessionHiddenMs * 3).toBeLessThan(90_000)
    expect(60_000).toBeLessThan(90_000)
  })
})

describe('labels', () => {
  it('says how long someone has been inactive', () => {
    expect(minutesLabel(30)).toBe('1 min')
    expect(minutesLabel(12 * 60 + 59)).toBe('12 min')
    expect(minutesLabel(60 * 60)).toBe('1 h')
    expect(minutesLabel(65 * 60)).toBe('1 h 5 min')
  })
})
