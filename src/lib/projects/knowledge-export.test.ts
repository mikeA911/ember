import { describe, it, expect, vi, beforeEach } from 'vitest'
import JSZip from 'jszip'
import { createFakeSupabase } from '@/lib/test-support/fake-supabase'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

const createAdminClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: (...args: unknown[]) => createAdminClientMock(...args) }))

const { buildKnowledgeZip, collectProjectKnowledge, renderSourceMarkdown, slugifyForFile, uniqueName } = await import('./knowledge-export')

beforeEach(() => createAdminClientMock.mockReset())

function ctxWith(supabase: unknown, role = 'consultant'): WorkbenchCallerContext {
  return { user: { id: 'builder-1' }, profile: { role }, supabase } as unknown as WorkbenchCallerContext
}

describe('file naming', () => {
  it('slugifies names and keeps them distinct within a folder', () => {
    expect(slugifyForFile('Café Menu: 2026 / Prices')).toBe('cafe-menu-2026-prices')
    expect(slugifyForFile('***', 'source')).toBe('source')
    const taken = new Set<string>()
    expect([uniqueName('notes', taken), uniqueName('notes', taken), uniqueName('notes', taken)]).toEqual(['notes', 'notes-2', 'notes-3'])
  })
})

describe('renderSourceMarkdown', () => {
  it('heads the approved text with where it came from', () => {
    const md = renderSourceMarkdown({
      title: 'NENA i3',
      sourceUrl: 'https://example.com/i3',
      publisher: 'NENA',
      versionNumber: 2,
      originalFilename: 'i3.pdf',
      storagePath: 'uploads/i3.pdf',
      text: 'Clause 1.',
    })
    expect(md).toBe('# NENA i3\n\n- Publisher: NENA\n- Source: https://example.com/i3\n- Version: 2\n- Original file: i3.pdf\n\nClause 1.\n')
  })
})

describe('buildKnowledgeZip', () => {
  it('lays out knowledge bases, sources with their original files, and wiki articles', async () => {
    const fetchFile = vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]))
    const bytes = await buildKnowledgeZip(
      {
        projectName: 'Acme',
        exportedAt: '2026-10-07T00:00:00.000Z',
        knowledgeBases: [
          {
            name: 'Acme Policies',
            description: 'HR',
            sources: [
              { title: 'Leave', sourceUrl: null, publisher: null, versionNumber: 1, originalFilename: 'leave.docx', storagePath: 'uploads/leave.docx', text: 'Ten days.' },
              { title: 'Leave', sourceUrl: 'https://x', publisher: null, versionNumber: null, originalFilename: null, storagePath: null, text: '' },
            ],
          },
        ],
        articles: [{ slug: 'leave-faq', title: 'Leave FAQ', shortDescription: null, content: 'Ask HR.' }],
      },
      fetchFile
    )
    const zip = await JSZip.loadAsync(bytes)
    expect(Object.keys(zip.files).filter((f) => !f.endsWith('/')).sort()).toEqual([
      'README.md',
      'knowledge-bases/acme-policies/README.md',
      'knowledge-bases/acme-policies/leave-2/text.md',
      'knowledge-bases/acme-policies/leave/leave.docx',
      'knowledge-bases/acme-policies/leave/text.md',
      'wiki/leave-faq.md',
    ])
    expect(fetchFile).toHaveBeenCalledWith('uploads/leave.docx')
    expect(await zip.file('knowledge-bases/acme-policies/leave-2/text.md')!.async('string')).toContain('_No approved text yet._')
  })
})

describe('collectProjectKnowledge', () => {
  it("refuses a member who isn't the project's owner, curator or builder", async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'proj-1', name: 'Acme', builder_id: null }, error: null }],
      project_members: [{ data: { role: 'viewer' }, error: null }],
    })
    await expect(collectProjectKnowledge(ctxWith(supabase), 'proj-1')).rejects.toThrow("Only this project's owner, curators or builder")
  })

  it("exports only what the builder's own access can read, with approved text fetched for those documents", async () => {
    const supabase = createFakeSupabase({
      projects: [{ data: { id: 'proj-1', name: 'Acme', builder_id: 'builder-1' }, error: null }],
      knowledge_bases: [{ data: [{ id: 'kb-1', name: 'Acme Policies', description: null }], error: null }],
      knowledge_sources: [
        {
          data: [
            { id: 's-1', knowledge_base_id: 'kb-1', title: 'Leave', source_url: null, publisher: null, current_version_id: 'doc-1' },
            // Restricted evidence: documents RLS hides doc-2 from this builder.
            { id: 's-2', knowledge_base_id: 'kb-1', title: 'Salaries', source_url: null, publisher: null, current_version_id: 'doc-2' },
          ],
          error: null,
        },
      ],
      documents: [{ data: [{ id: 'doc-1', original_filename: 'leave.docx', storage_path: 'uploads/leave.docx', version_number: 1 }], error: null }],
      wiki_articles: [{ data: [{ id: 'a-1', slug: 'leave-faq', title: 'Leave FAQ', short_description: null, current_version_id: 'v-1' }], error: null }],
      project_wiki_articles: [{ data: [], error: null }],
      wiki_versions: [{ data: [{ id: 'v-1', content: 'Ask HR.' }], error: null }],
    })
    createAdminClientMock.mockReturnValue(
      createFakeSupabase({
        document_chunks: [
          {
            data: [
              { document_id: 'doc-1', chunk_index: 0, chunk_text: 'Ten days.' },
              { document_id: 'doc-1', chunk_index: 1, chunk_text: 'Carry over five.' },
            ],
            error: null,
          },
        ],
      })
    )

    const result = await collectProjectKnowledge(ctxWith(supabase), 'proj-1')

    expect(result.knowledgeBases).toEqual([
      {
        name: 'Acme Policies',
        description: null,
        sources: [
          {
            title: 'Leave',
            sourceUrl: null,
            publisher: null,
            versionNumber: 1,
            originalFilename: 'leave.docx',
            storagePath: 'uploads/leave.docx',
            text: 'Ten days.\n\nCarry over five.',
          },
        ],
      },
    ])
    expect(result.articles).toEqual([{ slug: 'leave-faq', title: 'Leave FAQ', shortDescription: null, content: 'Ask HR.' }])
  })
})
