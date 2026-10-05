import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

const resolveNavigationTargetMock = vi.fn()
const resolveDocumentArtifactMock = vi.fn()

vi.mock('./navigation-resolver', () => ({ resolveNavigationTarget: (...args: unknown[]) => resolveNavigationTargetMock(...args) }))
vi.mock('./document-resolver', () => ({ resolveDocumentArtifact: (...args: unknown[]) => resolveDocumentArtifactMock(...args) }))

const { buildPersistedEnvelope, resolveEnvelopeForDisplay } = await import('./envelope-resolution')

beforeEach(() => {
  resolveNavigationTargetMock.mockReset()
  resolveDocumentArtifactMock.mockReset()
})

describe('buildPersistedEnvelope', () => {
  it('keeps only citations verified present in this turn\'s real retrieval', async () => {
    const parsed = {
      schemaVersion: '1.0' as const,
      message: 'Here you go.',
      citations: [
        { label: 'Retrieved', sourceType: 'wiki_article' as const, sourceId: 'real-slug' },
        { label: 'Invented', sourceType: 'wiki_article' as const, sourceId: 'never-retrieved-slug' },
      ],
    }

    const persisted = await buildPersistedEnvelope(
      {} as never,
      parsed,
      { wikiArticleSlugs: new Map([['real-slug', { layer: 'platform', documentVersionId: null }]]), knowledgeSourceIds: new Map(), workingKnowledgeIds: new Map() }
    )

    expect(persisted.citations).toEqual([
      { label: 'Retrieved', sourceType: 'wiki_article', sourceId: 'real-slug', layer: 'platform', documentVersionId: undefined },
    ])
  })

  it('keeps Ember\'s knowledge-coverage declaration (Ember Readiness, Stage 4)', async () => {
    const parsed = {
      schemaVersion: '1.0' as const,
      message: 'Not covered here.',
      knowledgeCoverage: { status: 'not_in_project_knowledge' as const, missingTopic: 'Mitel SIP trunks' },
    }
    const persisted = await buildPersistedEnvelope({} as never, parsed, {
      wikiArticleSlugs: new Map(),
      knowledgeSourceIds: new Map(),
      workingKnowledgeIds: new Map(),
    })
    expect(persisted.knowledgeCoverage).toEqual({ status: 'not_in_project_knowledge', missingTopic: 'Mitel SIP trunks' })
  })

  it('attaches layer and documentVersionId from this turn\'s retrieval, never from the model', async () => {
    const parsed = {
      schemaVersion: '1.0' as const,
      message: 'Here you go.',
      citations: [{ label: 'Project source', sourceType: 'knowledge_source' as const, sourceId: 'source-1' }],
    }

    const persisted = await buildPersistedEnvelope(
      {} as never,
      parsed,
      { wikiArticleSlugs: new Map(), knowledgeSourceIds: new Map([['source-1', { layer: 'project', documentVersionId: 'doc-v1' }]]), workingKnowledgeIds: new Map() }
    )

    expect(persisted.citations).toEqual([
      { label: 'Project source', sourceType: 'knowledge_source', sourceId: 'source-1', layer: 'project', documentVersionId: 'doc-v1' },
    ])
  })

  it('checks knowledge_source citations against knowledgeSourceIds, not wikiArticleSlugs', async () => {
    const parsed = {
      schemaVersion: '1.0' as const,
      message: 'Here you go.',
      citations: [
        { label: 'Retrieved source', sourceType: 'knowledge_source' as const, sourceId: 'source-1' },
        { label: 'Invented source', sourceType: 'knowledge_source' as const, sourceId: 'never-retrieved-source' },
      ],
    }

    const persisted = await buildPersistedEnvelope(
      {} as never,
      parsed,
      { wikiArticleSlugs: new Map(), knowledgeSourceIds: new Map([['source-1', { layer: 'platform', documentVersionId: null }]]), workingKnowledgeIds: new Map() }
    )

    expect(persisted.citations).toEqual([
      { label: 'Retrieved source', sourceType: 'knowledge_source', sourceId: 'source-1', layer: 'platform', documentVersionId: undefined },
    ])
  })

  it('drops links that fail to resolve even once, keeping ones that do', async () => {
    resolveNavigationTargetMock.mockImplementation(async (_ctx, target) =>
      target.id === 'real-project' ? { label: 'Real Project', route: '/projects/real-project' } : null
    )
    const parsed = {
      schemaVersion: '1.0' as const,
      message: 'Here you go.',
      links: [
        { label: 'A', target: { kind: 'project' as const, id: 'real-project' } },
        { label: 'B', target: { kind: 'project' as const, id: 'fake-project' } },
      ],
    }

    const persisted = await buildPersistedEnvelope({} as never, parsed, { wikiArticleSlugs: new Map(), knowledgeSourceIds: new Map(), workingKnowledgeIds: new Map() })

    expect(persisted.links).toEqual([{ label: 'A', target: { kind: 'project', id: 'real-project' } }])
  })

  it('drops documents whose artifactId does not resolve', async () => {
    resolveDocumentArtifactMock.mockResolvedValue(null)
    const parsed = { schemaVersion: '1.0' as const, message: 'Hi.', documents: [{ label: 'Doc', documentType: 'design_note', artifactId: 'fake' }] }

    const persisted = await buildPersistedEnvelope({} as never, parsed, { wikiArticleSlugs: new Map(), knowledgeSourceIds: new Map(), workingKnowledgeIds: new Map() })

    expect(persisted.documents).toBeUndefined()
  })

  it('omits empty optional sections entirely rather than persisting empty arrays', async () => {
    const persisted = await buildPersistedEnvelope(
      {} as never,
      { schemaVersion: '1.0', message: 'Hi.' },
      { wikiArticleSlugs: new Map(), knowledgeSourceIds: new Map(), workingKnowledgeIds: new Map() }
    )
    expect(persisted).toEqual({ message: 'Hi.' })
  })
})

describe('resolveEnvelopeForDisplay', () => {
  it('re-resolves persisted link/document/citation references into display-ready routes', async () => {
    resolveNavigationTargetMock.mockImplementation(async (_ctx, target) => {
      if (target.kind === 'project') return { label: 'Real Project', route: '/projects/p1' }
      if (target.kind === 'wiki_article') return { label: 'Article', route: '/wiki/some-slug' }
      return null
    })
    resolveDocumentArtifactMock.mockResolvedValue({ title: 'Design Note', artifactType: 'design_note', route: '/projects/p1/workstreams/w1', workstreamId: 'w1', projectId: 'p1' })

    const persisted = {
      message: 'Hi.',
      links: [{ label: 'A', target: { kind: 'project' as const, id: 'p1' } }],
      documents: [{ label: 'Doc', documentType: 'design_note', artifactId: 'art1' }],
      citations: [{ label: 'Source', sourceType: 'wiki_article' as const, sourceId: 'some-slug' }],
    }

    const verified = await resolveEnvelopeForDisplay({} as never, persisted)

    expect(verified.links).toEqual([{ label: 'A', route: '/projects/p1' }])
    expect(verified.documents).toEqual([{ label: 'Doc', documentType: 'design_note', artifactId: 'art1', title: 'Design Note', route: '/projects/p1/workstreams/w1' }])
    expect(verified.citations).toEqual([{ label: 'Source', sourceType: 'wiki_article', sourceId: 'some-slug', route: '/wiki/some-slug' }])
  })

  it('drops a previously-resolvable reference that has since become inaccessible', async () => {
    resolveNavigationTargetMock.mockResolvedValue(null)
    const persisted = { message: 'Hi.', links: [{ label: 'A', target: { kind: 'project' as const, id: 'p1' } }] }

    const verified = await resolveEnvelopeForDisplay({} as never, persisted)

    expect(verified.links).toBeUndefined()
  })

  it('carries layer through and flags a knowledge_source citation as stale when the source has a newer version', async () => {
    resolveNavigationTargetMock.mockResolvedValue({ label: 'Source', route: '/sources/source-1' })
    const supabase = createFakeSupabase({
      knowledge_sources: [{ data: { current_version_id: 'doc-v2' }, error: null }],
    })
    const persisted = {
      message: 'Hi.',
      citations: [{ label: 'Source', sourceType: 'knowledge_source' as const, sourceId: 'source-1', layer: 'project' as const, documentVersionId: 'doc-v1' }],
    }

    const verified = await resolveEnvelopeForDisplay({ supabase } as never, persisted)

    expect(verified.citations).toEqual([
      { label: 'Source', sourceType: 'knowledge_source', sourceId: 'source-1', route: '/sources/source-1', layer: 'project', stale: true },
    ])
  })

  it('does not flag staleness when the cited version is still current', async () => {
    resolveNavigationTargetMock.mockResolvedValue({ label: 'Source', route: '/sources/source-1' })
    const supabase = createFakeSupabase({
      knowledge_sources: [{ data: { current_version_id: 'doc-v1' }, error: null }],
    })
    const persisted = {
      message: 'Hi.',
      citations: [{ label: 'Source', sourceType: 'knowledge_source' as const, sourceId: 'source-1', layer: 'project' as const, documentVersionId: 'doc-v1' }],
    }

    const verified = await resolveEnvelopeForDisplay({ supabase } as never, persisted)

    expect(verified.citations?.[0].stale).toBeUndefined()
  })
})
