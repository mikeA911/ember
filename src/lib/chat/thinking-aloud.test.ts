import { describe, expect, it } from 'vitest'
import { parseThinkingAloud, thinkingAloudMessage } from './thinking-aloud'

describe('thinking aloud messages', () => {
  it('round-trips the duration and transcript', () => {
    const msg = thinkingAloudMessage('  So the idea is a VMware exit package.\nFor mid-size firms. ', 252)
    expect(msg).toBe('[Thinking aloud · 4:12]\nSo the idea is a VMware exit package.\nFor mid-size firms.')
    expect(parseThinkingAloud(msg)).toEqual({ duration: '4:12', transcript: 'So the idea is a VMware exit package.\nFor mid-size firms.' })
  })

  it('leaves ordinary messages alone', () => {
    expect(parseThinkingAloud('Thinking aloud about pricing')).toBeNull()
  })
})
