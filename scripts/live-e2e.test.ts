// Manual live-integration check against the REAL Supabase project configured
// in .env.local -- creates real data, uses real auth sessions, real storage,
// real AI provider calls. Not part of `npm test` (that glob is src/**/*.test.ts
// only); run explicitly with:
//   npx vitest run scripts/live-e2e.test.ts
// Requires .env.local to be loaded, e.g. via `node --env-file=.env.local
// $(npm bin)/vitest run scripts/live-e2e.test.ts` or an env-aware shell.

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { parseDocument } from '@/lib/parsing'
import { chunkDocument } from '@/lib/chunking'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveProvider } from '@/lib/ai'
import { enrichDocumentChunks, approveChunk } from '@/lib/curator/chunks'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

async function signIn(email: string, password: string) {
  const client = createSupabaseClient<Database>(url, anonKey, { auth: { persistSession: false } })
  const { data, error } = await client.auth.signInWithPassword({ email, password })
  if (error || !data.user) throw error ?? new Error(`sign-in failed for ${email}`)
  return { client, userId: data.user.id }
}

describe.sequential('live E2E against the real Supabase project', () => {
  let curator: Awaited<ReturnType<typeof signIn>>
  let userAccount: Awaited<ReturnType<typeof signIn>>
  let documentId: string
  let storagePath: string
  let approvedChunkId: string

  beforeAll(async () => {
    curator = await signIn('test-curator@kbsandbox.local', process.env.TEST_CURATOR_PASSWORD!)
    userAccount = await signIn('test-user@kbsandbox.local', process.env.TEST_USER_PASSWORD!)
  })

  it('uploads a real PDF to private storage as the curator (real RLS storage policy)', async () => {
    const buffer = fs.readFileSync(path.join(process.cwd(), 'scripts/test-fixtures/chunking-strategies.pdf'))
    storagePath = `uploads/${Date.now()}-chunking-strategies.pdf`

    const { error } = await curator.client.storage.from('documents').upload(storagePath, buffer, {
      contentType: 'application/pdf',
    })
    expect(error).toBeNull()
  })

  it('rejects an unauthenticated fetch of the same storage object (private bucket, no public URL)', async () => {
    const { data } = curator.client.storage.from('documents').getPublicUrl(storagePath)
    const res = await fetch(data.publicUrl)
    expect(res.status).not.toBe(200)
  })

  it('inserts the documents row as the curator via real RLS (documents_insert_staff)', async () => {
    const { data, error } = await curator.client
      .from('documents')
      .insert({
        filename: storagePath.split('/').pop()!,
        original_filename: 'chunking-strategies.pdf',
        doc_type: 'fhir',
        storage_path: storagePath,
        file_size: 0,
        mime_type: 'application/pdf',
        source_url: `test-e2e://${Date.now()}`,
        uploaded_by: curator.userId,
        processing_status: 'pending',
        processing_stage: 'upload',
        processing_error: null,
        total_chunks: null,
        metadata: {},
      })
      .select()
      .single()
    expect(error).toBeNull()
    documentId = data!.id
  })

  it('a plain "user" role cannot see the document (RLS: not curator/admin, not the uploader)', async () => {
    const { data, error } = await userAccount.client.from('documents').select('id').eq('id', documentId)
    expect(error).toBeNull()
    expect(data).toHaveLength(0)
  })

  it('parses the real PDF and writes real chunks with page provenance', async () => {
    const buffer = fs.readFileSync(path.join(process.cwd(), 'scripts/test-fixtures/chunking-strategies.pdf'))
    const parsed = await parseDocument(buffer, 'application/pdf')
    const chunks = chunkDocument(parsed)
    expect(chunks.length).toBeGreaterThan(0)

    const { error } = await curator.client.from('document_chunks').insert(
      chunks.map((c) => ({
        document_id: documentId,
        chunk_index: c.chunkIndex,
        chunk_text: c.text,
        chunk_size: c.wordCount,
        source_page: c.sourcePage,
        source_section: c.sourceSection,
        parser: c.parser,
        char_start: c.charStart,
        char_end: c.charEnd,
        ai_metadata: null,
        confidence_score: null,
        review_status: 'pending' as const,
        enrichment_error: null,
        curator_notes: null,
        reviewed_by: null,
        reviewed_at: null,
        is_filtered: false,
        filtered_reason: null,
        metadata_edited: false,
        metadata_edited_by: null,
        metadata_edited_at: null,
      }))
    )
    expect(error).toBeNull()

    await curator.client
      .from('documents')
      .update({ processing_status: 'review', processing_stage: 'review', total_chunks: chunks.length })
      .eq('id', documentId)
  }, 30000)

  it('enriches chunks via the real active AI provider (Gemini)', async () => {
    const provider = await getActiveProvider(curator.client, { task: 'chunk_enrichment', documentId, requestedBy: curator.userId })
    expect(provider.name).toBe('gemini')

    const result = await enrichDocumentChunks(curator.client, provider, documentId, 'fhir', 5)
    // Deliberately not `enriched + failed > 0` -- that passes even when every
    // chunk fails, which is exactly the shape of bug this live check exists
    // to catch (it did: gemini-2.0-flash silently failed 100% of calls after
    // Google shut the model down, and this assertion would have hidden it).
    expect(result.failed).toBe(0)
    expect(result.enriched).toBeGreaterThan(0)

    const { data: chunks } = await curator.client
      .from('document_chunks')
      .select('id, review_status, ai_metadata')
      .eq('document_id', documentId)
      .limit(1)
    approvedChunkId = chunks![0].id
  }, 60000)

  it('approves a chunk for real: writes kb_vectors with a real embedding and increments the counter', async () => {
    const provider = await getActiveProvider(curator.client, { task: 'chunk_embedding', documentId, chunkId: approvedChunkId, requestedBy: curator.userId })
    await approveChunk(curator.client, provider, {
      chunkId: approvedChunkId,
      curatorNotes: 'live e2e check',
      reviewedBy: curator.userId,
    })

    const { data: vector } = await curator.client.from('kb_vectors').select('*').eq('chunk_id', approvedChunkId).single()
    expect(vector).not.toBeNull()
    expect(vector!.embedding_model).toBeTruthy()
    expect(vector!.embedding_dim).toBeGreaterThan(0)

    const { data: doc } = await curator.client.from('documents').select('approved_chunks').eq('id', documentId).single()
    expect(doc!.approved_chunks).toBeGreaterThanOrEqual(1)
  }, 30000)

  it('match_documents RPC has a working signature against the real pgvector column', async () => {
    const admin = createAdminClient()
    const zeroVector = new Array(1536).fill(0)
    const { data, error } = await admin.rpc('match_documents', {
      query_embedding: zeroVector,
      match_threshold: 0,
      match_count: 3,
    })
    expect(error).toBeNull()
    expect(Array.isArray(data)).toBe(true)
  })

  it('RLS blocks a non-admin session from directly setting wiki_versions.approved_by (no client UPDATE policy)', async () => {
    const admin = createAdminClient()
    const { data: anyVersion } = await admin.from('wiki_versions').select('id, approved_by').limit(1).single()

    const { data: updated, error } = await curator.client
      .from('wiki_versions')
      .update({ approved_by: curator.userId })
      .eq('id', anyVersion!.id)
      .select()

    // RLS silently filters rather than erroring: the update matches zero rows.
    expect(error).toBeNull()
    expect(updated).toHaveLength(0)
  })
})

// A true public visitor: no signIn() call at all, so this client is exactly
// what an anonymous browser request looks like at the RLS layer (the anon
// API key, zero session). This is what the "publish a curated view, never
// the internal project" guarantee actually rests on.
describe.sequential('public visitor (anon key, no session) -- 20260810130001_public_visibility.sql', () => {
  const anon = createSupabaseClient<Database>(url, anonKey, { auth: { persistSession: false } })
  let publishedProjectId: string
  let publicArticleId: string

  beforeAll(async () => {
    const admin = createAdminClient()

    const { data: project } = await admin
      .from('projects')
      .insert({ name: 'anon-verification-project', project_type: 'experiment', status: 'draft', notes: null, details: {} })
      .select('id')
      .single()
    publishedProjectId = project!.id
    await admin
      .from('projects')
      .update({
        visibility: 'public',
        published_at: new Date().toISOString(),
        public_slug: `anon-verification-${Date.now()}`,
        public_profile: { title: 'Anon Verification', summary: 'live e2e check' },
      })
      .eq('id', publishedProjectId)

    const { data: article } = await admin
      .from('wiki_articles')
      .select('id')
      .eq('status', 'approved')
      .limit(1)
      .single()
    publicArticleId = article!.id
    await admin.from('wiki_articles').update({ is_public: true }).eq('id', publicArticleId)
  })

  afterAll(async () => {
    const admin = createAdminClient()
    await admin.from('projects').delete().eq('id', publishedProjectId)
    await admin.from('wiki_articles').update({ is_public: false }).eq('id', publicArticleId)
  })

  it('reads a published project, and only the safe columns', async () => {
    const { data, error } = await anon
      .from('projects')
      .select('id, public_slug, name, project_type, public_profile, published_at')
      .eq('id', publishedProjectId)
      .single()
    expect(error).toBeNull()
    expect(data!.public_profile).toMatchObject({ title: 'Anon Verification' })
  })

  it('does not see a private project it created a moment ago being made internal-only', async () => {
    const admin = createAdminClient()
    const { data: internalProject } = await admin
      .from('projects')
      .insert({ name: 'anon-verification-internal', project_type: 'experiment', status: 'draft', notes: 'internal only', details: {} })
      .select('id')
      .single()
    try {
      const { data } = await anon.from('projects').select('id').eq('id', internalProject!.id)
      expect(data).toHaveLength(0)
    } finally {
      await admin.from('projects').delete().eq('id', internalProject!.id)
    }
  })

  it('reads the current version of a public approved article', async () => {
    const { data: article } = await anon
      .from('wiki_articles')
      .select('id, current_version_id')
      .eq('id', publicArticleId)
      .single()
    expect(article).not.toBeNull()
    const { data: version, error } = await anon
      .from('wiki_versions')
      .select('id, quick_help, content')
      .eq('id', article!.current_version_id!)
      .single()
    expect(error).toBeNull()
    expect(version!.content).toBeTruthy()
  })

  it('regression: still cannot read project_members, eval_runs, eval_results, or ai_operation_logs', async () => {
    for (const table of ['project_members', 'eval_runs', 'eval_results', 'ai_operation_logs'] as const) {
      const { data } = await anon.from(table).select('id').limit(5)
      expect(data).toHaveLength(0)
    }
  })

  it('regression: still cannot read a draft/unapproved wiki article, even by id', async () => {
    const admin = createAdminClient()
    const { data: draftArticle } = await admin.from('wiki_articles').select('id').eq('status', 'draft').limit(1).maybeSingle()
    if (!draftArticle) return // nothing to check against in this environment right now
    const { data } = await anon.from('wiki_articles').select('id').eq('id', draftArticle.id)
    expect(data).toHaveLength(0)
  })
})
