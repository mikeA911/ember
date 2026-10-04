import { describe, it, expect, vi } from 'vitest'
import { createFakeSupabase as createBaseFake } from '@/lib/test-support/fake-supabase'

// Tier reads (readResourceTiers) use the service-role client; route them to
// whichever fake the test just built, so each test still queues
// resource_access_policies rows in one place.
let adminFake: unknown
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake }))
let gateFoundational = false
vi.mock('@/lib/env', () => ({ env: { gateFoundationalAi: () => gateFoundational } }))
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
  mergeManifests,
  gateProvider,
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

describe('getEffectiveSensitivity -- inherited floor and artifacts', () => {
  it('applies minimumSensitivity even when nothing else is in the manifest', async () => {
    const fakeSupabase = createFakeSupabase({})
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [], minimumSensitivity: 'restricted' })
    expect(result).toBe('restricted')
  })

  it('raises an unclassified source to the inherited floor (a new upload for a Restricted Project)', async () => {
    const fakeSupabase = createFakeSupabase({ resource_access_policies: [{ data: [], error: null }] })
    const result = await getEffectiveSensitivity(fakeSupabase as never, {
      wikiArticleSlugs: [],
      knowledgeSourceIds: ['ks-new'],
      minimumSensitivity: 'restricted',
    })
    expect(result).toBe('restricted')
  })

  it('never lowers a stricter resource tier to the floor', async () => {
    const fakeSupabase = createFakeSupabase({
      resource_access_policies: [{ data: [{ resource_id: 'ks-1', information_sensitivity: 'restricted' }], error: null }],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: ['ks-1'], minimumSensitivity: 'internal' })
    expect(result).toBe('restricted')
  })

  it('reads workstream artifact tiers', async () => {
    const fakeSupabase = createFakeSupabase({
      resource_access_policies: [{ data: [{ resource_id: 'art-1', information_sensitivity: 'confidential' }], error: null }],
    })
    const result = await getEffectiveSensitivity(fakeSupabase as never, { wikiArticleSlugs: [], knowledgeSourceIds: [], workstreamArtifactIds: ['art-1'] })
    expect(result).toBe('confidential')
    const call = (fakeSupabase as unknown as { _calls: { table: string; method: string; args: unknown }[] })._calls.find(
      (c) => c.table === 'resource_access_policies' && c.method === 'eq'
    )
    expect(call?.args).toEqual({ column: 'resource_type', value: 'workstream_artifact' })
  })
})

describe('mergeManifests', () => {
  it('unions entries and keeps the stricter project tier and floor', () => {
    const merged = mergeManifests(
      { entries: [{ resourceType: 'knowledge_source', resourceId: 'ks-1' }], projectSensitivity: null, minimumSensitivity: 'internal' },
      { entries: [{ resourceType: 'knowledge_source', resourceId: 'ks-1' }, { resourceType: 'wiki_article', resourceId: 'slug' }], projectSensitivity: 'confidential' },
      { entries: [], minimumSensitivity: 'restricted' }
    )
    expect(merged.entries).toHaveLength(2)
    expect(merged.projectSensitivity).toBe('confidential')
    expect(merged.minimumSensitivity).toBe('restricted')
  })

  it('leaves projectSensitivity undefined when no input is project-bound', () => {
    const merged = mergeManifests({ entries: [] }, { entries: [] })
    expect(merged).toEqual({ entries: [] })
  })

  it('keeps an unclassified-but-bound project (null) rather than dropping it', () => {
    expect(mergeManifests({ entries: [] }, { entries: [], projectSensitivity: null }).projectSensitivity).toBeNull()
  })
})

describe('gateProvider', () => {
  function fakeProvider(): AIProvider {
    return {
      name: 'openai',
      generateText: vi.fn(),
      generateStructured: vi.fn().mockResolvedValue({ data: {}, model: 'm', usage: {} }),
      generateChat: vi.fn(),
      embed: vi.fn().mockResolvedValue({ embedding: [], model: 'm', dimensions: 0, usage: {} }),
    } as unknown as AIProvider
  }

  it("looks up the provider's id by name and blocks a manifest above its ceiling", async () => {
    const fakeSupabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-openai' }, error: null }],
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    const provider = fakeProvider()
    const gated = await gateProvider(fakeSupabase as never, provider, { entries: [], minimumSensitivity: 'restricted' })

    await expect(gated.embed({ text: 'x' })).rejects.toThrow(AISensitivityError)
    expect(provider.embed).not.toHaveBeenCalled()
    const lookup = (fakeSupabase as unknown as { _calls: { table: string; method: string; args: unknown }[] })._calls.find(
      (c) => c.table === 'ai_provider_sensitivity_eligibility' && c.method === 'eq'
    )
    expect(lookup?.args).toEqual({ column: 'provider_id', value: 'provider-openai' })
  })

  it('passes an eligible call through', async () => {
    const fakeSupabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-local' }, error: null }],
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'restricted' }, error: null }],
    })
    const provider = fakeProvider()
    const gated = await gateProvider(fakeSupabase as never, provider, { entries: [], minimumSensitivity: 'restricted' })

    await gated.embed({ text: 'x' })
    expect(provider.embed).toHaveBeenCalled()
  })

  it('refuses to run unchecked when the provider is not registered', async () => {
    const fakeSupabase = createFakeSupabase({ ai_providers: [{ data: null, error: null }] })
    await expect(gateProvider(fakeSupabase as never, fakeProvider(), { entries: [] })).rejects.toThrow(/not registered/)
  })
})

describe('gateProvider -- foundational calls', () => {
  function fakeProvider(): AIProvider {
    return {
      name: 'openai',
      generateText: vi.fn(),
      generateStructured: vi.fn().mockResolvedValue({ data: {}, model: 'm', usage: {} }),
      generateChat: vi.fn(),
      embed: vi.fn().mockResolvedValue({ embedding: [], model: 'm', dimensions: 0, usage: {} }),
    } as unknown as AIProvider
  }

  it('passes foundational calls through unchecked by default, without building the manifest', async () => {
    gateFoundational = false
    const fakeSupabase = createFakeSupabase({})
    const provider = fakeProvider()
    const buildManifest = vi.fn()

    const gated = await gateProvider(fakeSupabase as never, provider, buildManifest, 'foundational')

    expect(gated).toBe(provider)
    expect(buildManifest).not.toHaveBeenCalled()
  })

  it('gates foundational calls when the deployment turns it on', async () => {
    gateFoundational = true
    try {
      const fakeSupabase = createFakeSupabase({
        ai_providers: [{ data: { id: 'provider-openai' }, error: null }],
        ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
      })
      const provider = fakeProvider()

      const gated = await gateProvider(fakeSupabase as never, provider, async () => ({ entries: [], minimumSensitivity: 'restricted' }), 'foundational')

      await expect(gated.embed({ text: 'x' })).rejects.toThrow(AISensitivityError)
      expect(provider.embed).not.toHaveBeenCalled()
    } finally {
      gateFoundational = false
    }
  })

  it('always gates content calls, whatever the setting', async () => {
    gateFoundational = false
    const fakeSupabase = createFakeSupabase({
      ai_providers: [{ data: { id: 'provider-openai' }, error: null }],
      ai_provider_sensitivity_eligibility: [{ data: { max_sensitivity: 'internal' }, error: null }],
    })
    const provider = fakeProvider()

    const gated = await gateProvider(fakeSupabase as never, provider, { entries: [], projectSensitivity: 'restricted' }, 'content')

    await expect(gated.generateStructured({ prompt: 'x', schema: {} as never })).rejects.toThrow(AISensitivityError)
  })
})
