import { describe, it, expect } from 'vitest'
import { estimateTokens, composeWorkingContext } from './context'
import type { ChatMessage } from '@/lib/ai'
import type { ConversationSummary } from '@/types/database'

const SUMMARY: ConversationSummary = {
  objective: 'Set up a Refactoring Plan workstream',
  confirmedRequirements: ['Has source code', 'No OpenAPI spec yet'],
  decisions: ['Use Document-First Engineering'],
  openQuestions: [],
  createdRecords: ['project:proj-1'],
  referencedEvidence: ['wiki:openapi-discovery'],
  nextAction: 'Run OpenAPI Discovery first',
}

function userTurn(text: string): ChatMessage[] {
  return [{ role: 'user', content: text }]
}

function toolTurn(userText: string, toolName: string, replyText: string): ChatMessage[] {
  return [
    { role: 'user', content: userText },
    { role: 'assistant', content: '', toolCalls: [{ id: 'c1', name: toolName, arguments: {} }] },
    { role: 'tool', content: '{}', toolCallId: 'c1', toolName },
    { role: 'assistant', content: replyText },
  ]
}

describe('estimateTokens', () => {
  it('estimates roughly 4 characters per token', () => {
    expect(estimateTokens('a'.repeat(400))).toBe(100)
  })

  it('rounds up so a short non-empty string never estimates to zero tokens', () => {
    expect(estimateTokens('hi')).toBe(1)
  })
})

describe('composeWorkingContext', () => {
  it('returns everything unchanged when the whole history comfortably fits the budget', () => {
    const history: ChatMessage[] = [...userTurn('hello'), { role: 'assistant', content: 'hi there' }]

    const result = composeWorkingContext({ history, summary: null })

    expect(result).toEqual({ messages: history, wasTruncated: false, omittedMessageCount: 0, summaryIncluded: false })
  })

  it('never splits a tool-call/tool-result pair, even when the budget only fits part of that turn', () => {
    const history = toolTurn('search for x', 'search_wiki', 'found it')

    // A budget too small even for the single (newest) turn's own messages --
    // the newest turn must still be kept whole.
    const result = composeWorkingContext({ history, summary: null, contextWindow: 100, maxOutputTokens: 10 })

    expect(result.messages).toEqual(history)
  })

  it('keeps the newest turn and drops older turns once the budget is exceeded, substituting the summary', () => {
    const oldTurn = toolTurn('old question', 'search_wiki', 'old reply'.repeat(1000))
    const newTurn = userTurn('new question')
    const history = [...oldTurn, ...newTurn]

    const result = composeWorkingContext({ history, summary: SUMMARY, contextWindow: 4000, maxOutputTokens: 512 })

    expect(result.wasTruncated).toBe(true)
    expect(result.summaryIncluded).toBe(true)
    // Summary note first, then only the newest turn -- the old turn's
    // messages must not appear at all.
    expect(result.messages[0].content).toContain('Run OpenAPI Discovery first')
    expect(result.messages.slice(1)).toEqual(newTurn)
  })

  it('drops older turns without a summary substitute when none exists yet', () => {
    const oldTurn = toolTurn('old question', 'search_wiki', 'old reply'.repeat(1000))
    const newTurn = userTurn('new question')
    const history = [...oldTurn, ...newTurn]

    const result = composeWorkingContext({ history, summary: null, contextWindow: 4000, maxOutputTokens: 512 })

    expect(result.wasTruncated).toBe(true)
    expect(result.summaryIncluded).toBe(false)
    expect(result.messages).toEqual(newTurn)
  })

  it('returns an empty result for empty history', () => {
    expect(composeWorkingContext({ history: [], summary: null })).toEqual({
      messages: [],
      wasTruncated: false,
      omittedMessageCount: 0,
      summaryIncluded: false,
    })
  })

  // Just over 1000 tokens per turn against an 18k budget: 17 turns fit.
  const bigTurn = (i: number) => userTurn(`q${i} ` + 'x'.repeat(4000))
  const historyOf = (n: number) => Array.from({ length: n }, (_, i) => bigTurn(i)).flat()

  it('cuts at a multiple of CUT_STEP_TURNS, so the start of the history holds for several turns', () => {
    const starts = [20, 21, 22, 23, 24].map((n) => composeWorkingContext({ history: historyOf(n), summary: null }).messages[0].content.split(' ')[0])
    // A one-turn-at-a-time cut would start at q3, q4, q5, q6, q7.
    expect(starts).toEqual(['q4', 'q4', 'q8', 'q8', 'q8'])
  })

  it('reports how many messages it cut and stays within the budget', () => {
    const result = composeWorkingContext({ history: historyOf(23), summary: null })
    expect(result.wasTruncated).toBe(true)
    expect(result.omittedMessageCount).toBe(8)
    expect(result.messages).toHaveLength(15)
  })
})
