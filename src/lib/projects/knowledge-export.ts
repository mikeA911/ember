import 'server-only'
import JSZip from 'jszip'
import { AuthError } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { ProjectValidationError } from '@/lib/projects/errors'
import type { WorkbenchCallerContext } from '@/lib/workbench/context'

// A builder takes their project's knowledge with them: every knowledge base
// the project owns (knowledge_bases.project_id), each current source as its
// original file plus its approved text in Markdown, and the project's
// approved wiki articles, in one zip.
//
// What goes in is decided by the caller's own access: the project role
// check below, then which knowledge bases, documents and articles their
// RLS-scoped client can read (documents RLS already applies restricted
// evidence classifications). Only for those documents does the admin client
// fetch the approved chunk text and stored file -- both are staff-only
// tables/buckets, so a builder can't read them directly.

export interface ExportedSource {
  title: string
  sourceUrl: string | null
  publisher: string | null
  versionNumber: number | null
  originalFilename: string | null
  storagePath: string | null
  text: string
}

export interface ExportedKnowledgeBase {
  name: string
  description: string | null
  sources: ExportedSource[]
}

export interface ExportedArticle {
  slug: string
  title: string
  shortDescription: string | null
  content: string
}

export interface KnowledgeExport {
  projectName: string
  exportedAt: string
  knowledgeBases: ExportedKnowledgeBase[]
  articles: ExportedArticle[]
}

export function slugifyForFile(name: string, fallback = 'item'): string {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 80)
  return slug || fallback
}

// Distinct names within one folder: "notes", "notes-2", ...
export function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name
  for (let n = 2; taken.has(candidate); n++) candidate = `${name}-${n}`
  taken.add(candidate)
  return candidate
}

function safeFilename(name: string): string {
  const cleaned = name.replace(/[/\\:*?"<>|\u0000-\u001f]/g, '_').trim()
  return cleaned || 'file'
}

export function renderSourceMarkdown(source: ExportedSource): string {
  const lines = [`# ${source.title}`, '']
  if (source.publisher) lines.push(`- Publisher: ${source.publisher}`)
  if (source.sourceUrl) lines.push(`- Source: ${source.sourceUrl}`)
  if (source.versionNumber !== null) lines.push(`- Version: ${source.versionNumber}`)
  if (source.originalFilename) lines.push(`- Original file: ${source.originalFilename}`)
  if (lines.length > 2) lines.push('')
  lines.push(source.text.trim() || '_No approved text yet._', '')
  return lines.join('\n')
}

export function renderArticleMarkdown(article: ExportedArticle): string {
  const lines = [`# ${article.title}`, '']
  if (article.shortDescription) lines.push(`> ${article.shortDescription}`, '')
  lines.push(article.content.trim(), '')
  return lines.join('\n')
}

export function renderReadme(data: KnowledgeExport): string {
  const lines = [
    `# ${data.projectName}: knowledge export`,
    '',
    `Exported from Ember on ${data.exportedAt.slice(0, 10)}.`,
    '',
    '## Knowledge bases',
    '',
  ]
  if (data.knowledgeBases.length === 0) lines.push('_None._')
  for (const kb of data.knowledgeBases) {
    lines.push(`- **${kb.name}**: ${kb.sources.length} source${kb.sources.length === 1 ? '' : 's'}${kb.description ? ` -- ${kb.description}` : ''}`)
  }
  lines.push('', '## Wiki articles', '')
  if (data.articles.length === 0) lines.push('_None._')
  for (const a of data.articles) lines.push(`- ${a.title}`)
  lines.push(
    '',
    'Each source has its approved text as Markdown, and its original file when one was uploaded.',
    ''
  )
  return lines.join('\n')
}

type FileFetcher = (storagePath: string) => Promise<Uint8Array | null>

export async function buildKnowledgeZip(data: KnowledgeExport, fetchFile: FileFetcher): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file('README.md', renderReadme(data))

  const kbNames = new Set<string>()
  for (const kb of data.knowledgeBases) {
    const kbDir = `knowledge-bases/${uniqueName(slugifyForFile(kb.name, 'knowledge-base'), kbNames)}`
    zip.file(`${kbDir}/README.md`, `# ${kb.name}\n\n${kb.description ?? ''}\n`)
    const sourceNames = new Set<string>()
    for (const source of kb.sources) {
      const dir = `${kbDir}/${uniqueName(slugifyForFile(source.title, 'source'), sourceNames)}`
      zip.file(`${dir}/text.md`, renderSourceMarkdown(source))
      if (source.storagePath && source.originalFilename) {
        const bytes = await fetchFile(source.storagePath)
        if (bytes) zip.file(`${dir}/${safeFilename(source.originalFilename)}`, bytes)
      }
    }
  }

  const articleNames = new Set<string>()
  for (const article of data.articles) {
    zip.file(`wiki/${uniqueName(slugifyForFile(article.slug || article.title, 'article'), articleNames)}.md`, renderArticleMarkdown(article))
  }

  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// Project owner or curator, the builder of record, or a platform admin.
export async function requireKnowledgeExporter(ctx: WorkbenchCallerContext, projectId: string): Promise<{ name: string }> {
  if (ctx.profile.role === 'anonymous') throw new AuthError('Sign in to export knowledge')
  const { data: project, error } = await ctx.supabase.from('projects').select('id, name, builder_id').eq('id', projectId).maybeSingle()
  if (error) throw error
  if (!project) throw new ProjectValidationError('Project not found')
  if (ctx.profile.role === 'admin' || project.builder_id === ctx.user.id) return { name: project.name }
  const { data: membership } = await ctx.supabase
    .from('project_members')
    .select('role')
    .eq('project_id', projectId)
    .eq('user_id', ctx.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (membership?.role !== 'owner' && membership?.role !== 'curator') {
    throw new AuthError("Only this project's owner, curators or builder can export its knowledge")
  }
  return { name: project.name }
}

export async function collectProjectKnowledge(ctx: WorkbenchCallerContext, projectId: string): Promise<KnowledgeExport> {
  const { name } = await requireKnowledgeExporter(ctx, projectId)

  const { data: kbs, error: kbError } = await ctx.supabase
    .from('knowledge_bases')
    .select('id, name, description')
    .eq('project_id', projectId)
    .order('name')
  if (kbError) throw kbError
  const kbIds = (kbs ?? []).map((kb) => kb.id)

  // Current, active sources and the document versions this caller may read.
  const { data: sources, error: sourceError } = kbIds.length
    ? await ctx.supabase
        .from('knowledge_sources')
        .select('id, knowledge_base_id, title, source_url, publisher, current_version_id')
        .in('knowledge_base_id', kbIds)
        .eq('lifecycle_status', 'active')
        .order('title')
    : { data: [], error: null }
  if (sourceError) throw sourceError
  const versionIds = (sources ?? []).map((s) => s.current_version_id).filter((v): v is string => !!v)
  const { data: documents, error: documentError } = versionIds.length
    ? await ctx.supabase.from('documents').select('id, original_filename, storage_path, version_number').in('id', versionIds)
    : { data: [], error: null }
  if (documentError) throw documentError
  const documentById = new Map((documents ?? []).map((d) => [d.id, d]))

  // Approved text for the readable documents only (chunks are staff-only).
  const readableIds = [...documentById.keys()]
  const textByDocument = new Map<string, string[]>()
  if (readableIds.length > 0) {
    const { data: chunks, error: chunkError } = await createAdminClient()
      .from('document_chunks')
      .select('document_id, chunk_index, chunk_text')
      .in('document_id', readableIds)
      .eq('review_status', 'approved')
      .order('chunk_index')
    if (chunkError) throw chunkError
    for (const c of chunks ?? []) {
      const list = textByDocument.get(c.document_id) ?? []
      list.push(c.chunk_text)
      textByDocument.set(c.document_id, list)
    }
  }

  const knowledgeBases: ExportedKnowledgeBase[] = (kbs ?? []).map((kb) => ({
    name: kb.name,
    description: kb.description,
    sources: (sources ?? [])
      .filter((s) => s.knowledge_base_id === kb.id)
      // A source whose current version the caller can't read (restricted
      // evidence) is left out entirely.
      .filter((s) => !s.current_version_id || documentById.has(s.current_version_id))
      .map((s) => {
        const doc = s.current_version_id ? documentById.get(s.current_version_id) : undefined
        return {
          title: s.title,
          sourceUrl: s.source_url,
          publisher: s.publisher,
          versionNumber: doc?.version_number ?? null,
          originalFilename: doc?.original_filename ?? null,
          storagePath: doc?.storage_path ?? null,
          text: doc ? (textByDocument.get(doc.id) ?? []).join('\n\n') : '',
        }
      }),
  }))

  // Approved articles in the project's own knowledge bases, plus articles
  // attached to the project and private to it.
  const [{ data: kbArticles, error: kbArticleError }, { data: links, error: linkError }] = await Promise.all([
    kbIds.length
      ? ctx.supabase.from('wiki_articles').select('id, slug, title, short_description, current_version_id').in('knowledge_base_id', kbIds).eq('status', 'approved')
      : Promise.resolve({ data: [], error: null }),
    ctx.supabase.from('project_wiki_articles').select('wiki_article_id').eq('project_id', projectId),
  ])
  if (kbArticleError) throw kbArticleError
  if (linkError) throw linkError
  const linkedIds = (links ?? []).map((l) => l.wiki_article_id)
  const { data: linkedArticles, error: linkedError } = linkedIds.length
    ? await ctx.supabase
        .from('wiki_articles')
        .select('id, slug, title, short_description, current_version_id')
        .in('id', linkedIds)
        .eq('status', 'approved')
        .eq('visibility_scope', 'project_private')
    : { data: [], error: null }
  if (linkedError) throw linkedError

  const articleById = new Map([...(kbArticles ?? []), ...(linkedArticles ?? [])].map((a) => [a.id, a]))
  const articleVersionIds = [...articleById.values()].map((a) => a.current_version_id).filter((v): v is string => !!v)
  const { data: versions, error: versionError } = articleVersionIds.length
    ? await ctx.supabase.from('wiki_versions').select('id, content').in('id', articleVersionIds)
    : { data: [], error: null }
  if (versionError) throw versionError
  const contentByVersion = new Map((versions ?? []).map((v) => [v.id, v.content]))

  const articles: ExportedArticle[] = [...articleById.values()]
    .filter((a) => a.current_version_id && contentByVersion.has(a.current_version_id))
    .map((a) => ({ slug: a.slug, title: a.title, shortDescription: a.short_description, content: contentByVersion.get(a.current_version_id as string) ?? '' }))
    .sort((a, b) => a.title.localeCompare(b.title))

  return { projectName: name, exportedAt: new Date().toISOString(), knowledgeBases, articles }
}

// Original files, fetched with the admin client (the documents bucket is
// staff-only) -- only for paths collectProjectKnowledge already cleared.
export async function downloadStoredFile(storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await createAdminClient().storage.from('documents').download(storagePath)
  if (error || !data) return null
  return new Uint8Array(await data.arrayBuffer())
}

export async function exportProjectKnowledge(ctx: WorkbenchCallerContext, projectId: string): Promise<{ filename: string; bytes: Uint8Array }> {
  const data = await collectProjectKnowledge(ctx, projectId)
  const bytes = await buildKnowledgeZip(data, downloadStoredFile)
  return { filename: `${slugifyForFile(data.projectName, 'project')}-knowledge-${data.exportedAt.slice(0, 10)}.zip`, bytes }
}
