import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const embedMock = vi.fn()
const gateProviderMock = vi.fn()
const getActiveEmbeddingProviderMock = vi.fn()
vi.mock('@/lib/ai', () => ({
  getActiveEmbeddingProvider: (...args: unknown[]) => getActiveEmbeddingProviderMock(...args),
  gateProvider: (...args: unknown[]) => gateProviderMock(...args),
  manifestForProject: vi.fn(),
}))

const { embedKnowledgeGap, gapEmbeddingText } = await import('./knowledge-gap-embedding')

const ctx = { user: { id: 'user-1' }, profile: { role: 'member' }, supabase: {} } as unknown as WorkbenchCallerContext

describe('embedKnowledgeGap', () => {
  it('embeds the missing topic and question with the default model, through the policy gate, keyed by model and size', async () => {
    getActiveEmbeddingProviderMock.mockResolvedValue({ name: 'openai' })
    gateProviderMock.mockImplementation(async () => ({ embed: embedMock }))
    embedMock.mockResolvedValue({ embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small', dimensions: 3 })

    const result = await embedKnowledgeGap(ctx, 'p1', ' How are Mitel SIP trunks configured? ', 'Mitel SIP trunks')

    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], model: 'text-embedding-3-small/3' })
    expect(getActiveEmbeddingProviderMock).toHaveBeenCalledWith(ctx.supabase, { task: 'knowledge_gap_grouping', requestedBy: 'user-1' })
    expect(gateProviderMock).toHaveBeenCalledWith(ctx.supabase, { name: 'openai' }, expect.any(Function), 'foundational')
    expect(embedMock).toHaveBeenCalledWith({ text: 'Mitel SIP trunks\nHow are Mitel SIP trunks configured?' })
  })

  it('returns null instead of throwing when there is no model, the gate blocks it, or the call fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getActiveEmbeddingProviderMock.mockRejectedValueOnce(new Error('no default embedding model'))
    expect(await embedKnowledgeGap(ctx, 'p1', 'q')).toBeNull()
    getActiveEmbeddingProviderMock.mockResolvedValue({ name: 'openai' })
    gateProviderMock.mockRejectedValueOnce(new Error('Restricted information'))
    expect(await embedKnowledgeGap(ctx, 'p1', 'q')).toBeNull()
    spy.mockRestore()
  })

  it('leaves out an empty topic', () => {
    expect(gapEmbeddingText('Question?', null)).toBe('Question?')
    expect(gapEmbeddingText('Question?', '  ')).toBe('Question?')
  })
})

describe('knowledge_gap_semantic_grouping migration', () => {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20261018100001_knowledge_gap_semantic_grouping.sql'), 'utf-8')

  it('groups first by embedding similarity, only against gaps embedded by the same model', () => {
    expect(sql).toMatch(/g\.embedding_model = p_embedding_model\s+and 1 - \(g\.embedding <=> v_embedding\) >= p_min_similarity/)
    expect(sql).toMatch(/order by g\.embedding <=> v_embedding, g\.created_at/)
  })

  it('falls back to word overlap only for gaps the embedding could not be compared with', () => {
    expect(sql).toMatch(/\(v_embedding is null or g\.embedding is null or g\.embedding_model is distinct from p_embedding_model\)/)
    expect(sql).toMatch(/knowledge_gap_similarity\(.*\) >= 0\.65/)
  })

  it('bounds the threshold, keeps the caller checks, and keeps embeddings out of the asker’s reach', () => {
    expect(sql).toMatch(/p_min_similarity < 0\.5 or p_min_similarity > 1/)
    expect(sql).toMatch(/c\.user_id = v_uid and c\.project_id is not null and c\.kind = 'chat'/)
    expect(sql).toMatch(/or new\.embedding is distinct from old\.embedding/)
    expect(sql).toMatch(/revoke execute on function record_automatic_knowledge_gap\(uuid, text, text, text, vector, text, double precision\) from public, anon;/)
  })
})
