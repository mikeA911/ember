import { describe, it, expect } from 'vitest'
import { getAssistantDescriptor, getAssistantSystemPromptText } from './assistant-descriptor'
import { ASSISTANT_PROMPT_VERSION, MAX_TOOL_ITERATIONS, SEARCH_WIKI_LIMIT, getSystemPromptText } from '@/lib/chat/loop'
import { getToolSpecs } from '@/lib/mcp/tools'

describe('getAssistantDescriptor', () => {
  it('derives promptVersion and maxToolIterations from loop.ts, not a second literal', () => {
    const descriptor = getAssistantDescriptor()
    expect(descriptor.promptVersion).toBe(ASSISTANT_PROMPT_VERSION)
    expect(descriptor.maxToolIterations).toBe(MAX_TOOL_ITERATIONS)
  })

  it('derives the search-wiki guardrail limit from loop.ts', () => {
    const descriptor = getAssistantDescriptor()
    const guardrail = descriptor.guardrails.find((g) => g.id === 'search-wiki-limit')
    expect(guardrail?.limit).toBe(SEARCH_WIKI_LIMIT)
  })

  it('has exactly one tool entry per real tool, with no orphaned or missing entries', () => {
    const descriptor = getAssistantDescriptor()
    const realNames = getToolSpecs().map((t) => t.name).sort()
    const descriptorNames = descriptor.tools.map((t) => t.name).sort()
    expect(descriptorNames).toEqual(realNames)
  })

  it('every tool has hand-authored permission/enforcement metadata (no fallback placeholder text)', () => {
    const descriptor = getAssistantDescriptor()
    for (const tool of descriptor.tools) {
      expect(tool.requiredPermission).not.toMatch(/not documented/i)
      expect(tool.enforcedBy).not.toMatch(/not documented/i)
    }
  })

  it('has exactly 10 flow nodes A-J with the expected branch/terminal edge counts', () => {
    const descriptor = getAssistantDescriptor()
    expect(descriptor.nodes.map((n) => n.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'])
    const byId = Object.fromEntries(descriptor.nodes.map((n) => [n.id, n]))
    // Decision nodes branch two ways.
    expect(byId.E.next).toHaveLength(2)
    expect(byId.G.next).toHaveLength(2)
    // The terminal node has no outgoing edge.
    expect(byId.J.next).toHaveLength(0)
    // Every other node has exactly one outgoing edge.
    for (const id of ['A', 'B', 'C', 'D', 'F', 'H', 'I'] as const) {
      expect(byId[id].next).toHaveLength(1)
    }
  })

  it('tags every guardrail and tool as either kb_sandbox_enforced or declared', () => {
    const descriptor = getAssistantDescriptor()
    for (const entry of [...descriptor.tools, ...descriptor.guardrails]) {
      expect(['kb_sandbox_enforced', 'declared']).toContain(entry.enforcement)
    }
  })
})

describe('getAssistantSystemPromptText', () => {
  it('returns the same prompt text loop.ts actually uses', () => {
    expect(getAssistantSystemPromptText()).toBe(getSystemPromptText())
    expect(getAssistantSystemPromptText()).toContain('Ember Workbench Assistant')
  })
})
