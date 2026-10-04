import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'

let adminFake: unknown
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => adminFake }))

const { inheritedProjectSensitivityForKnowledgeBases, manifestForDocuments, manifestForProject, manifestForWorkstream, manifestForWikiVersion } =
  await import('./policy-manifests')

describe('inheritedProjectSensitivityForKnowledgeBases', () => {
  it('takes the highest classification of any Project using the knowledge base, directly or through a Workstream', async () => {
    adminFake = createFakeSupabase({
      project_knowledge_bases: [{ data: [{ project_id: 'p-internal' }], error: null }],
      workstream_knowledge_bases: [{ data: [{ workstream_id: 'ws-1' }], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
      project_workstreams: [{ data: [{ project_id: 'p-ng911' }], error: null }],
      projects: [{ data: [{ information_sensitivity: 'internal' }, { information_sensitivity: 'restricted' }], error: null }],
    })
    expect(await inheritedProjectSensitivityForKnowledgeBases(['kb-1'])).toBe('restricted')
  })

  it('returns undefined when no using Project is classified', async () => {
    adminFake = createFakeSupabase({
      project_knowledge_bases: [{ data: [{ project_id: 'p-1' }], error: null }],
      workstream_knowledge_bases: [{ data: [], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
      projects: [{ data: [{ information_sensitivity: null }], error: null }],
    })
    expect(await inheritedProjectSensitivityForKnowledgeBases(['kb-1'])).toBeUndefined()
  })

  it('returns undefined without querying when the knowledge base is not used by any Project', async () => {
    adminFake = createFakeSupabase({
      project_knowledge_bases: [{ data: [], error: null }],
      workstream_knowledge_bases: [{ data: [], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
    })
    expect(await inheritedProjectSensitivityForKnowledgeBases(['kb-1'])).toBeUndefined()
  })
})

describe('manifestForDocuments', () => {
  it("lists each document's knowledge source and carries the inherited floor", async () => {
    adminFake = createFakeSupabase({
      documents: [{ data: [{ knowledge_source_id: 'ks-1', doc_type: 'kb-ng911' }], error: null }],
      project_knowledge_bases: [{ data: [{ project_id: 'p-ng911' }], error: null }],
      workstream_knowledge_bases: [{ data: [], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
      projects: [{ data: [{ information_sensitivity: 'restricted' }], error: null }],
    })
    expect(await manifestForDocuments(['doc-1'])).toEqual({
      entries: [{ resourceType: 'knowledge_source', resourceId: 'ks-1' }],
      minimumSensitivity: 'restricted',
    })
  })

  it('is empty for no documents', async () => {
    expect(await manifestForDocuments([])).toEqual({ entries: [] })
  })
})

describe('manifestForProject', () => {
  it("uses the Project's classification", async () => {
    adminFake = createFakeSupabase({ projects: [{ data: { information_sensitivity: 'confidential' }, error: null }] })
    expect(await manifestForProject('p-1')).toEqual({ entries: [], projectSensitivity: 'confidential' })
  })

  it('marks an unclassified Project as bound-but-unclassified (null), which reads as internal', async () => {
    adminFake = createFakeSupabase({ projects: [{ data: { information_sensitivity: null }, error: null }] })
    expect(await manifestForProject('p-1')).toEqual({ entries: [], projectSensitivity: null })
  })
})

describe('manifestForWorkstream', () => {
  it("combines the Project's classification with every artifact on the Workstream", async () => {
    adminFake = createFakeSupabase({
      project_workstreams: [{ data: { project_id: 'p-1' }, error: null }],
      workstream_artifacts: [{ data: [{ id: 'art-1' }, { id: 'art-2' }], error: null }],
      projects: [{ data: { information_sensitivity: 'internal' }, error: null }],
    })
    expect(await manifestForWorkstream('ws-1')).toEqual({
      entries: [
        { resourceType: 'workstream_artifact', resourceId: 'art-1' },
        { resourceType: 'workstream_artifact', resourceId: 'art-2' },
      ],
      projectSensitivity: 'internal',
    })
  })
})

describe('manifestForWikiVersion', () => {
  it('includes the article and everything it was written from', async () => {
    adminFake = createFakeSupabase({
      wiki_versions: [{ data: { wiki_article_id: 'a-1' }, error: null }],
      wiki_articles: [{ data: { slug: 'ng911-runbook' }, error: null }],
      wiki_sources: [{ data: [{ document_id: null, chunk_id: 'c-1', workstream_artifact_id: null }, { document_id: null, chunk_id: null, workstream_artifact_id: 'art-1' }], error: null }],
      document_chunks: [{ data: [{ document_id: 'doc-1' }], error: null }],
      documents: [{ data: [{ knowledge_source_id: 'ks-1', doc_type: 'kb-1' }], error: null }],
      project_knowledge_bases: [{ data: [], error: null }],
      workstream_knowledge_bases: [{ data: [], error: null }],
      knowledge_bases: [{ data: [{ project_id: null }], error: null }],
    })
    const manifest = await manifestForWikiVersion('v-1')
    expect(manifest.entries).toEqual([
      { resourceType: 'wiki_article', resourceId: 'ng911-runbook' },
      { resourceType: 'knowledge_source', resourceId: 'ks-1' },
      { resourceType: 'workstream_artifact', resourceId: 'art-1' },
    ])
  })
})

// Same discipline as src/lib/mcp/external-tools.test.ts's guard on
// sensitivity.ts: these builders use the service-role client, so they must
// only ever read ids and classification tiers, never content.
describe('service-role reads are metadata only', () => {
  it('selects no content columns', () => {
    const src = fs.readFileSync(path.join(process.cwd(), 'src/lib/ai/policy-manifests.ts'), 'utf-8')
    const selects = [...src.matchAll(/\.select\('([^']+)'\)/g)].map((m) => m[1])
    const allowed = new Set([
      'project_id',
      'workstream_id',
      'information_sensitivity',
      'knowledge_source_id, doc_type',
      'id',
      'wiki_article_id',
      'slug',
      'document_id, chunk_id, workstream_artifact_id',
      'document_id',
      'doc_type',
    ])
    expect(selects.length).toBeGreaterThan(0)
    for (const s of selects) expect(allowed, s).toContain(s)
  })
})
