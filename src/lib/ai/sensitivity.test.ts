import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase as createBaseFake } from '@/lib/test-support/fake-supabase'

// Tier reads (readResourceTiers) use the service-role client; route them to
// whichever fake the test just built, so each test still queues
// resource_access_policies rows in one place.
let adminFake: unknown
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake }))
function createFakeSupabase(...args: Parameters<typeof createBaseFake>) {
  const fake = createBaseFake(...args)
  adminFake = fake
  return fake
}

const {
  getEffectiveSensitivity,
  assertProviderEligible,
  evaluatePolicy,
  withPolicyGate,
  readResourceTiers,
  AISensitivityError,
  SENSITIVITY_RANK,
} = await import('./sensitivity')
import type { AIProvider } from './provider'

describe('SENSITIVITY_RANK', () => {
  it('orders the four tiers from least to most sensitive', () => {
    expect(SENSITIVITY_RANK.public).toBeLessThan(SENSITIVITY_RANK.internal)
    expect(SENSITIVITY_RANK.internal).toBeLessThan(SENSITIVITY_RANK.confidential)
    expect(SENSITIVITY_RANK.confidential).toBeLessThan(SENSITIVITY_RANK.restricted)
  })
})

describe('getEffectiveSensitivity', () => {
  it('returns public when nothing was retrieved -- not internal', async () => {
    const fakeSupabase = createFakeSupabase({})
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [] })
    expect(result).toBe('public')
  })

  it('defaults an unclassified retrieved knowledge source to internal, not public', async () => {
    const fakeSupabase = createFakeSupabase({
      resource_access_policies: [{ data: [], error: null }], // no policy row for this resource
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: ['ks-1'] })
    expect(result).toBe('internal')
  })

  it('uses the classified tier when a policy row exists', async () => {
    const fakeSupabase = createFakeSupabase({
      resource_access_policies: [{ data: [{ resource_id: 'ks-1', information_sensitivity: 'confidential' }], error: null }],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: ['ks-1'] })
    expect(result).toBe('confidential')
  })

  it('takes the highest tier across multiple retrieved resources', async () => {
    const fakeSupabase = createFakeSupabase({
      wiki_articles: [{ data: [{ id: 'wa-1' }], error: null }],
      resource_access_policies: [
        { data: [{ resource_id: 'wa-1', information_sensitivity: 'public' }], error: null }, // wiki_article lookup
        { data: [{ resource_id: 'ks-1', information_sensitivity: 'restricted' }], error: null }, // knowledge_source lookup
      ],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: ['some-article'], knowledgeSourceIds: ['ks-1'] })
    expect(result).toBe('restricted')
  })

  it('resolves wiki article slugs to their stable id before looking up the policy', async () => {
    const fakeSupabase = createFakeSupabase({
      wiki_articles: [{ data: [{ id: 'wa-42' }], error: null }],
      resource_access_policies: [{ data: [{ resource_id: 'wa-42', information_sensitivity: 'restricted' }], error: null }],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: ['some-slug'], knowledgeSourceIds: [] })
    expect(result).toBe('restricted')
  })

  // projectSensitivity closes the "project metadata in system prompts"
  // gap: a project's name/goal is embedded every turn, not just once
  // something is retrieved, so it can't wait for the empty-arrays ->
  // 'public' shortcut the way wiki/knowledge-source retrieval does.
  it('omitting projectSensitivity (no project bound) preserves the nothing-retrieved -> public floor', async () => {
    const fakeSupabase = createFakeSupabase({})
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [] })
    expect(result).toBe('public')
  })

  it('a bound but unclassified project (projectSensitivity: null) defaults to internal, not public', async () => {
    const fakeSupabase = createFakeSupabase({})
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [], projectSensitivity: null })
    expect(result).toBe('internal')
  })

  it('a classified project tier is used directly, even with nothing else retrieved', async () => {
    const fakeSupabase = createFakeSupabase({})
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [], projectSensitivity: 'restricted' })
    expect(result).toBe('restricted')
  })

  it('the project tier and retrieved-resource tiers combine to the highest of either', async () => {
    const fakeSupabase = createFakeSupabase({
      resource_access_policies: [{ data: [{ resource_id: 'ks-1', information_sensitivity: 'public' }], error: null }],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, {
      wikiArticleSlugs: [],
      knowledgeSourceIds: ['ks-1'],
      projectSensitivity: 'confidential',
    })
    expect(result).toBe('confidential')
  })
})

describe('assertProviderEligible', () => {
  it('does not throw when the provider is approved for the requested sensitivity', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'confidential' }, error: null }],
    })
    await expect(assertProviderEligible(fakeSupabase as never, 'provider-1', 'internal')).resolves.toBeUndefined()
  })

  it('throws AISensitivityError when the provider is below the requested sensitivity', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    await expect(assertProviderEligible(fakeSupabase as never, 'provider-1', 'restricted')).rejects.toThrow(AISensitivityError)
  })

  it('treats a provider with no eligibility row as internal-only, not approved for everything', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: null, error: null }],
    })
    await expect(assertProviderEligible(fakeSupabase as never, 'provider-1', 'confidential')).rejects.toThrow(AISensitivityError)
    await expect(assertProviderEligible(fakeSupabase as never, 'provider-1', 'internal')).resolves.toBeUndefined()
  })

  it('includes the sensitivity tier in the error message', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'public' }, error: null }],
    })
    await expect(assertProviderEligible(fakeSupabase as never, 'provider-1', 'restricted')).rejects.toThrow(/Restricted/)
  })
})

// Phase 2, increment 1 (docs/design-notes/ai-policy-enforcement-service-and-
// context-manifest.md §3): manifest-shaped, non-throwing wrapper over the
// same two functions above -- no new DB logic, just a different shape for
// single-shot callers.
describe('evaluatePolicy', () => {
  it('returns an allow decision instead of just resolving, when the provider is eligible', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'confidential' }, error: null }],
    })
    const decision = await evaluatePolicy(fakeSupabase as never, { entries: [], projectSensitivity: 'internal' }, { providerId: 'provider-1' })
    expect(decision).toEqual({ outcome: 'allow', effectiveSensitivity: 'internal' })
  })

  it('returns a block decision (not a throw) when the provider is ineligible, carrying the same message as the thrown error', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    const decision = await evaluatePolicy(fakeSupabase as never, { entries: [], projectSensitivity: 'restricted' }, { providerId: 'provider-1' })
    expect(decision.outcome).toBe('block')
    expect(decision.effectiveSensitivity).toBe('restricted')
    expect(decision.reason).toMatch(/Restricted/)
  })

  it('translates manifest entries into the same wikiArticleSlugs/knowledgeSourceIds shape getEffectiveSensitivity already expects', async () => {
    const fakeSupabase = createFakeSupabase({
      wiki_articles: [{ data: [{ id: 'wa-1' }], error: null }],
      resource_access_policies: [
        { data: [{ resource_id: 'wa-1', information_sensitivity: 'confidential' }], error: null },
        { data: [{ resource_id: 'ks-1', information_sensitivity: 'public' }], error: null },
      ],
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'restricted' }, error: null }],
    })
    const decision = await evaluatePolicy(
      fakeSupabase as never,
      {
        entries: [
          { resourceType: 'wiki_article', resourceId: 'some-slug' },
          { resourceType: 'knowledge_source', resourceId: 'ks-1' },
        ],
      },
      { providerId: 'provider-1' }
    )
    expect(decision).toEqual({ outcome: 'allow', effectiveSensitivity: 'confidential' })
  })
})

describe('withPolicyGate', () => {
  function fakeProvider(): AIProvider {
    return {
      name: 'test-provider',
      generateText: vi.fn().mockResolvedValue({ text: 'ok', model: 'm', usage: {} }),
      generateStructured: vi.fn().mockResolvedValue({ data: {}, model: 'm', usage: {} }),
      generateChat: vi.fn().mockResolvedValue({ message: { role: 'assistant', content: 'ok' }, model: 'm', usage: {} }),
      embed: vi.fn().mockResolvedValue({ embedding: [], model: 'm', dimensions: 0, usage: {} }),
    } as unknown as AIProvider
  }

  it('calls through to the wrapped provider when the manifest is allowed', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'restricted' }, error: null }],
    })
    const provider = fakeProvider()
    const gated = withPolicyGate(fakeSupabase as never, provider, { entries: [], projectSensitivity: 'restricted' }, { providerId: 'provider-1' })

    await gated.generateStructured({ prompt: 'x', schema: {} as never })

    expect(provider.generateStructured).toHaveBeenCalled()
  })

  it('throws AISensitivityError before the wrapped provider is ever called, when the manifest is blocked', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    const provider = fakeProvider()
    const gated = withPolicyGate(fakeSupabase as never, provider, { entries: [], projectSensitivity: 'restricted' }, { providerId: 'provider-1' })

    await expect(gated.generateStructured({ prompt: 'x', schema: {} as never })).rejects.toBeInstanceOf(AISensitivityError)
    expect(provider.generateStructured).not.toHaveBeenCalled()
  })

  it('gates all four AIProvider methods, not just generateStructured', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    const provider = fakeProvider()
    const gated = withPolicyGate(fakeSupabase as never, provider, { entries: [], projectSensitivity: 'restricted' }, { providerId: 'provider-1' })

    await expect(gated.generateText({ prompt: 'x' })).rejects.toBeInstanceOf(AISensitivityError)
    await expect(gated.generateChat({ messages: [] })).rejects.toBeInstanceOf(AISensitivityError)
    await expect(gated.embed({ text: 'x' })).rejects.toBeInstanceOf(AISensitivityError)
    expect(provider.generateText).not.toHaveBeenCalled()
    expect(provider.generateChat).not.toHaveBeenCalled()
    expect(provider.embed).not.toHaveBeenCalled()
  })
})

describe('tier lookup does not depend on who is asking', () => {
  // Regression: resource_access_policies is readable under RLS only by the
  // project's manager, so reading tiers through the caller's own client made
  // every document look unclassified ('internal') for anyone else -- a
  // Confidential document then passed an Internal-only provider check.
  it("uses the service-role tier even when the caller's own client can't see any policy rows", async () => {
    const callerClient = createBaseFake({ resource_access_policies: [{ data: [], error: null }] })
    adminFake = createBaseFake({
      resource_access_policies: [{ data: [{ resource_id: 'ks-1', information_sensitivity: 'confidential' }], error: null }],
    })
    const result = await getEffectiveSensitivity(callerClient as never, { wikiArticleSlugs: [], knowledgeSourceIds: ['ks-1'] })
    expect(result).toBe('confidential')
    expect(callerClient._calls.some((c) => c.table === 'resource_access_policies')).toBe(false)
  })

  it('readResourceTiers returns a tier for every id asked about, defaulting to internal', async () => {
    adminFake = createBaseFake({ resource_access_policies: [{ data: [{ resource_id: 'a', information_sensitivity: 'public' }], error: null }] })
    const tiers = await readResourceTiers('knowledge_source', ['a', 'b'])
    expect([...tiers.entries()]).toEqual([
      ['a', 'public'],
      ['b', 'internal'],
    ])
  })
})
