import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import { AIProviderError } from '@/lib/ai/provider'

const requireRoleMock = vi.fn()
const approveWikiVersionMock = vi.fn()
const embedApprovedVersionMock = vi.fn()
const getActiveEmbeddingProviderMock = vi.fn()

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth')
  return {
    ...actual,
    requireRole: (...args: unknown[]) => requireRoleMock(...args),
  }
})
vi.mock('@/lib/wiki/review', async () => {
  const actual = await vi.importActual<typeof import('@/lib/wiki/review')>('@/lib/wiki/review')
  return {
    ...actual,
    approveWikiVersion: (...args: unknown[]) => approveWikiVersionMock(...args),
    embedApprovedVersion: (...args: unknown[]) => embedApprovedVersionMock(...args),
  }
})
const getActiveStructuredOutputProviderMock = vi.fn()
vi.mock('@/lib/ai', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai')>('@/lib/ai')
  return {
    AIProviderError: actual.AIProviderError,
    AISensitivityError: actual.AISensitivityError,
    SelfHostedAIUnavailableError: actual.SelfHostedAIUnavailableError,
    aiHostingForArtifact: async () => 'any',
    aiHostingForDocuments: async () => 'any',
    gateProvider: async (_supabase: unknown, provider: unknown) => provider,
    manifestForDocuments: async () => ({ entries: [] }),
    manifestForProject: async () => ({ entries: [] }),
    manifestForWorkstream: async () => ({ entries: [] }),
    manifestForArtifact: async () => ({ entries: [] }),
    manifestForWikiVersion: async () => ({ entries: [] }),
    getActiveEmbeddingProvider: (...args: unknown[]) => getActiveEmbeddingProviderMock(...args),
    getActiveStructuredOutputProvider: (...args: unknown[]) => getActiveStructuredOutputProviderMock(...args),
  }
})

// Two identical entries -- the wiki_versions queue is a shared, cursor-based
// FIFO consumed once per test in this describe block (see fake-supabase.ts),
// not reset between tests.
const adminSupabase = createFakeSupabase({
  wiki_versions: [
    { data: { content: 'some content' }, error: null },
    { data: { content: 'some content' }, error: null },
  ],
})
// Swappable so a single test can override just its own createAdminClient()
// call (mockReturnValueOnce) without disturbing the shared adminSupabase
// fixture every other test in this file relies on -- defaults preserve the
// exact prior behavior.
const createAdminClientMock = vi.fn(() => adminSupabase)
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => createAdminClientMock() }))

const { setArticlePublicAction, approveArticleAction, createAIAssistedDraftAction, createManualArticleAction, attachProjectAndSetVisibilityAction } =
  await import('./wiki')

beforeEach(() => {
  requireRoleMock.mockReset()
  approveWikiVersionMock.mockReset()
  embedApprovedVersionMock.mockReset()
  getActiveStructuredOutputProviderMock.mockReset()
  getActiveEmbeddingProviderMock.mockReset()
  requireRoleMock.mockResolvedValue({ user: { id: 'admin-1' } })
  approveWikiVersionMock.mockResolvedValue(undefined)
})

describe('setArticlePublicAction', () => {
  it('requires admin -- setting is_public is a stronger claim than approval', async () => {
    const supabase = createFakeSupabase({ wiki_articles: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ supabase })

    await setArticlePublicAction('article-1', true)

    expect(requireRoleMock).toHaveBeenCalledWith('admin')
    const update = supabase._calls.find((c) => c.table === 'wiki_articles' && c.method === 'update')
    expect(update?.args).toEqual({ is_public: true })
  })

  it('can unset is_public the same way', async () => {
    const supabase = createFakeSupabase({ wiki_articles: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ supabase })

    await setArticlePublicAction('article-1', false)

    const update = supabase._calls.find((c) => c.table === 'wiki_articles' && c.method === 'update')
    expect(update?.args).toEqual({ is_public: false })
  })
})

describe('approveArticleAction', () => {
  it('still succeeds when the AI provider lookup fails -- embedding is best-effort, not a gate on approval', async () => {
    getActiveEmbeddingProviderMock.mockRejectedValue(new Error('No default embedding model configured'))

    await expect(approveArticleAction('article-1', 'version-1')).resolves.toBeUndefined()

    expect(approveWikiVersionMock).toHaveBeenCalledWith(adminSupabase, 'article-1', 'version-1', 'admin-1')
    expect(embedApprovedVersionMock).not.toHaveBeenCalled()
  })

  it('resolves the embedding provider, not generation or structured-output -- some generation-only providers (e.g. Groq) cannot embed at all', async () => {
    const embeddingProvider = { name: 'embedding-provider' }
    getActiveEmbeddingProviderMock.mockResolvedValue(embeddingProvider)

    await approveArticleAction('article-1', 'version-1')

    expect(getActiveEmbeddingProviderMock).toHaveBeenCalled()
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
    expect(embedApprovedVersionMock).toHaveBeenCalledWith(adminSupabase, embeddingProvider, 'version-1', 'some content')
  })
})

// Caught live as "Minified React error #441" on a real `next build && next
// start` -- see createAIAssistedDraftAction's own comment below for the full
// diagnosis. createManualArticleAction never throws for an expected failure
// (slug collision); it always resolves to CreateWikiDraftResult.
describe('createManualArticleAction', () => {
  it('creates the article and its first version on success', async () => {
    const supabase = createFakeSupabase({
      wiki_articles: [
        { data: null, error: null }, // slug-availability check: none existing
        { data: { id: 'article-1', slug: 'new-article' }, error: null }, // insert
      ],
      wiki_versions: [{ data: { id: 'version-1' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })

    const result = await createManualArticleAction({
      title: 'New Article',
      slug: 'new-article',
      category: 'platform_handbook',
      shortDescription: '',
      quickHelp: 'Help text',
      content: 'Body',
      implementationNotes: '',
      limitations: '',
      knowledgeBaseId: null,
    })

    expect(result).toEqual({ ok: true, articleId: 'article-1', slug: 'new-article' })
  })

  it('reports a slug collision as ok:false instead of throwing across the Server Action boundary', async () => {
    const supabase = createFakeSupabase({
      wiki_articles: [{ data: { id: 'existing-article' }, error: null }], // slug-availability check: found
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })

    const result = await createManualArticleAction({
      title: 'Duplicate Slug Article',
      slug: 'existing-slug',
      category: 'platform_handbook',
      shortDescription: '',
      quickHelp: 'Help text',
      content: 'Body',
      implementationNotes: '',
      limitations: '',
      knowledgeBaseId: null,
    })

    expect(result).toEqual({ ok: false, error: 'Slug "existing-slug" is already in use' })
  })
})

describe('createAIAssistedDraftAction — artifact-sourced (M6A Handbook path)', () => {
  const draftFields = {
    title: 'How KB Sandbox Is Organized',
    short_description: 'A short overview',
    quick_help: 'Quick help text',
    content: '# Content',
    implementation_notes: undefined,
    limitations: undefined,
  }

  it('synthesizes from a workstream_artifacts row and links it as source_type workstream_artifact', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'artifact-1', title: 'Capability Inventory', content: 'evidence text' }, error: null }],
      wiki_articles: [
        { data: null, error: null }, // slug-availability check
        { data: { id: 'article-1', slug: 'how-kb-sandbox-is-organized' }, error: null }, // insert
      ],
      wiki_versions: [{ data: { id: 'version-1' }, error: null }],
      wiki_sources: [{ data: { id: 'source-1' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const generateStructured = vi.fn().mockResolvedValue({ data: draftFields, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'test-provider', generateStructured })

    const result = await createAIAssistedDraftAction({
      topic: 'How KB Sandbox Is Organized',
      category: 'platform_handbook',
      workstreamArtifactId: 'artifact-1',
    })

    expect(result).toEqual({ ok: true, articleId: 'article-1', slug: 'how-kb-sandbox-is-organized' })
    expect(generateStructured).toHaveBeenCalled()
    const sourceInsert = supabase._calls.find((c) => c.table === 'wiki_sources' && c.method === 'insert')
    expect(sourceInsert?.args).toMatchObject({
      wiki_version_id: 'version-1',
      workstream_artifact_id: 'artifact-1',
      source_type: 'workstream_artifact',
    })
  })

  // Caught live as "Minified React error #441", reproduced against a real
  // `next build && next start` (not just this suite): Next.js redacts the
  // message of ANY error thrown out of a Server Action in production,
  // regardless of how clean it is -- confirmed by comparing the server's own
  // log (full message + digest) against what the client actually receives
  // (digest only). The fix is the action never throwing for an expected
  // failure at all, not a cleaner thrown message -- so every case below
  // asserts a resolved ok:false result, never a rejection.
  it('reports a link-only artifact (no content to synthesize from) as ok:false, not a throw', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'artifact-2', title: 'External PR link', content: null }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })

    const result = await createAIAssistedDraftAction({ topic: 'x', category: 'platform_handbook', workstreamArtifactId: 'artifact-2' })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('link-only artifact') })
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })

  it('coerces a raw provider failure to a clean, recoverable ok:false message instead of crossing the Server Action boundary as a throw', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'artifact-3', title: 'Big artifact', content: 'evidence text' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const rawProviderError = new AIProviderError(
      'groq',
      'generate_structured',
      `groq generateStructured failed: unexpected end of JSON input (raw output: ${'x'.repeat(10000)})`,
      { response: { notPlainSerializable: () => {} } }
    )
    const generateStructured = vi.fn().mockRejectedValue(rawProviderError)
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'test-provider', generateStructured })

    const result = await createAIAssistedDraftAction({ topic: 'x', category: 'platform_handbook', workstreamArtifactId: 'artifact-3' })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toMatch(/AI-assisted draft generation failed \(groq: /)
  })

  it("reports an AI-processing policy block in its own words, not as a retryable provider failure", async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'artifact-5', title: 'NG911 notes', content: 'incident evidence' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const { AISensitivityError } = await import('@/lib/ai')
    const generateStructured = vi.fn().mockRejectedValue(
      new AISensitivityError('This project contains Restricted information and cannot be processed by this model.')
    )
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'test-provider', generateStructured })

    const result = await createAIAssistedDraftAction({ topic: 'x', category: 'platform_handbook', workstreamArtifactId: 'artifact-5' })

    expect(result.ok).toBe(false)
    expect(!result.ok && result.error).toBe('This project contains Restricted information and cannot be processed by this model.')
  })

  it('refuses to synthesize from a restricted artifact, even though RLS already let this caller read it', async () => {
    const supabase = createFakeSupabase({
      workstream_artifacts: [{ data: { id: 'artifact-4', title: 'Restricted artifact', content: 'sensitive evidence' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    createAdminClientMock.mockReturnValueOnce(
      createFakeSupabase({ resource_access_policies: [{ data: [{ resource_id: 'artifact-4' }], error: null }] })
    )

    const result = await createAIAssistedDraftAction({ topic: 'x', category: 'platform_handbook', workstreamArtifactId: 'artifact-4' })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('restricted') })
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })
})

describe('createAIAssistedDraftAction — chunk-sourced', () => {
  const draftFields = {
    title: 'Hybrid Retrieval',
    short_description: 'A short overview',
    quick_help: 'Quick help text',
    content: '# Content',
    implementation_notes: undefined,
    limitations: undefined,
  }

  it('synthesizes from approved document chunks on success', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        {
          data: [{ id: 'chunk-1', document_id: 'doc-1', chunk_text: 'evidence', source_page: 1, review_status: 'approved' }],
          error: null,
        },
      ],
      documents: [{ data: [{ id: 'doc-1', original_filename: 'guide.pdf', knowledge_source_id: 'src-1' }], error: null }],
      wiki_articles: [
        { data: null, error: null },
        { data: { id: 'article-1', slug: 'hybrid-retrieval' }, error: null },
      ],
      wiki_versions: [{ data: { id: 'version-1' }, error: null }],
      wiki_sources: [{ data: { id: 'source-1' }, error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    const generateStructured = vi.fn().mockResolvedValue({ data: draftFields, model: 'test-model' })
    getActiveStructuredOutputProviderMock.mockResolvedValue({ name: 'test-provider', generateStructured })
    createAdminClientMock.mockReturnValueOnce(createFakeSupabase({ resource_access_policies: [{ data: [], error: null }] }))

    const result = await createAIAssistedDraftAction({ topic: 'Hybrid Retrieval', category: 'platform_handbook', chunkIds: ['chunk-1'] })

    expect(result).toEqual({ ok: true, articleId: 'article-1', slug: 'hybrid-retrieval' })
  })

  it('refuses to synthesize from a chunk whose source is restricted, even for a curator who could otherwise select it', async () => {
    const supabase = createFakeSupabase({
      document_chunks: [
        {
          data: [{ id: 'chunk-2', document_id: 'doc-2', chunk_text: 'sensitive evidence', source_page: 1, review_status: 'approved' }],
          error: null,
        },
      ],
      documents: [{ data: [{ id: 'doc-2', original_filename: 'pricing.pdf', knowledge_source_id: 'src-2' }], error: null }],
    })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })
    createAdminClientMock.mockReturnValueOnce(
      createFakeSupabase({ resource_access_policies: [{ data: [{ resource_id: 'src-2' }], error: null }] })
    )

    const result = await createAIAssistedDraftAction({ topic: 'x', category: 'platform_handbook', chunkIds: ['chunk-2'] })

    expect(result).toEqual({ ok: false, error: expect.stringContaining('restricted source') })
    expect(getActiveStructuredOutputProviderMock).not.toHaveBeenCalled()
  })
})

describe('attachProjectAndSetVisibilityAction -- one-step attach-and-narrow safety fix', () => {
  it('links the project (RLS-scoped client) and sets visibility_scope (service-role client) in one call', async () => {
    const supabase = createFakeSupabase({ project_wiki_articles: [{ data: null, error: null }] })
    requireRoleMock.mockResolvedValue({ user: { id: 'curator-1' }, supabase })

    await attachProjectAndSetVisibilityAction('project-1', 'article-1', 'project_private')

    const link = supabase._calls.find((c) => c.table === 'project_wiki_articles' && c.method === 'insert')
    expect(link?.args).toMatchObject({ project_id: 'project-1', wiki_article_id: 'article-1', attached_by: 'curator-1' })
    const scopeUpdate = adminSupabase._calls.find((c) => c.table === 'wiki_articles' && c.method === 'update')
    expect(scopeUpdate?.args).toEqual({ visibility_scope: 'project_private' })
  })
})
