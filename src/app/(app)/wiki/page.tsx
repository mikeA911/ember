import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listArticles, listCategories, getWikiStats } from '@/lib/wiki/queries'
import { listProjectsWithKnowledge } from '@/lib/projects/queries'
import { listKnowledgeBaseSynopses } from '@/lib/knowledge-bases'
import { SectionHero } from '@/components/SectionHero'
import type { WikiArticleStatus, WikiCategoryId } from '@/types/database'

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-zinc-100 text-zinc-700',
  review: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  archived: 'bg-zinc-200 text-zinc-500',
}

const STATUS_OPTIONS: { id: WikiArticleStatus; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'review', label: 'Review' },
  { id: 'approved', label: 'Approved' },
  { id: 'archived', label: 'Archived' },
]

type ViewMode = 'cards' | 'list'
type WikiFilters = { category?: string; status?: string; q?: string; view?: ViewMode }

// Builds a /wiki URL carrying every currently-active filter, with `changes`
// overriding just the one(s) the caller is linking to change -- so clicking
// a status pill while a search and a view mode are already active doesn't
// silently drop them (the pre-existing category links had exactly that bug:
// they only ever set `category`, dropping an active search on click).
function wikiUrl(current: WikiFilters, changes: Partial<WikiFilters>) {
  const merged = { ...current, ...changes }
  const params = new URLSearchParams()
  if (merged.category) params.set('category', merged.category)
  if (merged.status) params.set('status', merged.status)
  if (merged.q) params.set('q', merged.q)
  if (merged.view && merged.view !== 'cards') params.set('view', merged.view)
  const qs = params.toString()
  return `/wiki${qs ? `?${qs}` : ''}#browse`
}

function pillClass(active: boolean) {
  return `rounded-full px-3 py-1 ${active ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`
}

export default async function WikiListPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; status?: string; q?: string; view?: string }>
}) {
  const { category, status, q, view: viewParam } = await searchParams
  const view: ViewMode = viewParam === 'list' ? 'list' : 'cards'
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const [categories, articles, wikiStats, projectsWithKnowledge, knowledgeBaseSynopses] = await Promise.all([
    listCategories(supabase),
    listArticles(supabase, {
      category: category as WikiCategoryId | undefined,
      status: status as WikiArticleStatus | undefined,
      search: q,
    }),
    getWikiStats(supabase),
    listProjectsWithKnowledge(supabase),
    listKnowledgeBaseSynopses(user?.id ?? null),
  ])

  const filters: WikiFilters = { category, status, q, view }
  const isFiltered = Boolean(category || status || q)

  return (
    <div className="flex flex-col gap-6">
      <SectionHero image="/images/sections/kb-sandbox.png" height="compact" priority />

      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">Wiki</h1>
        <Link href="/wiki/new" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
          New article
        </Link>
      </div>

      {/* Teaches the Platform-vs-Project distinction every time this page
          loads: Platform Knowledge is the shared AI Engineering Wiki below;
          Project Knowledge belongs to one project's own attached KB (set via
          attachKnowledgeBaseAction) and lives on that project's page. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <a href="#browse" className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400">
            <div className="text-xs uppercase tracking-wide text-zinc-500">Platform Knowledge</div>
            <div className="mt-1 font-medium">AI Engineering Wiki</div>
            <div className="mt-2 text-sm text-zinc-600">
              {wikiStats.total} articles · {wikiStats.approved} approved
            </div>
          </a>
          {projectsWithKnowledge.map((p) => (
            <Link
              key={p.id}
              href={`/projects/${p.id}`}
              className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
            >
              <div className="text-xs uppercase tracking-wide text-zinc-500">Project Knowledge</div>
              <div className="mt-1 font-medium">{p.name}</div>
              <div className="mt-2 text-sm text-zinc-600">
                {p.wikiArticleCount} articles · {p.documentCount} sources
              </div>
            </Link>
          ))}
        </div>
        {projectsWithKnowledge.length === 0 && (
          <p className="text-sm text-zinc-500">
            No project has attached its own knowledge base yet — a project can attach one from its Knowledge section.
          </p>
        )}
      </section>

      {/* Synopsis only, per Mike 2026-08-28 -- name + description so users
          understand what's available and what it's for, not the KB's actual
          content (that stays behind curator/admin review). */}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Knowledge bases</h2>
        {knowledgeBaseSynopses.length === 0 ? (
          <p className="text-sm text-zinc-500">No knowledge bases available yet.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-3">
            {knowledgeBaseSynopses.map((kb) => {
              const isRestricted = kb.visibilityScope !== 'platform' && kb.visibilityScope !== 'public'
              return (
                <div key={kb.id} className="rounded border border-zinc-200 bg-white p-4">
                  <div className="font-medium">{kb.name}</div>
                  {kb.description && <p className="mt-1 text-sm text-zinc-600">{kb.description}</p>}
                  {isRestricted && (
                    <p className="mt-2 text-xs text-zinc-400">
                      {kb.visibilityScope === 'project_private' ? 'Private to a Project' : 'Shared with selected Projects'}
                      {kb.disclosableOwningProjects.length > 0 && (
                        <>
                          {' — '}
                          {kb.disclosableOwningProjects.map((p, i) => (
                            <span key={p.id}>
                              {i > 0 && ', '}
                              <Link href={`/projects/${p.id}`} className="underline">
                                {p.name}
                              </Link>
                              {p.ownerEmail && ` (${p.ownerEmail})`}
                            </span>
                          ))}
                        </>
                      )}
                    </p>
                  )}
                  {kb.viewerProjectLinks.length > 0 && (
                    <p className="mt-1 text-xs text-zinc-500">
                      Used in:{' '}
                      {kb.viewerProjectLinks.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ', '}
                          <Link href={`/projects/${p.id}`} className="underline">
                            {p.name}
                          </Link>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <div id="browse" className="flex flex-col gap-6 scroll-mt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <form className="flex flex-wrap gap-2" action="/wiki">
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search title or description…"
              className="w-64 rounded border border-zinc-300 px-3 py-2 text-sm"
            />
            {category && <input type="hidden" name="category" value={category} />}
            {status && <input type="hidden" name="status" value={status} />}
            {view !== 'cards' && <input type="hidden" name="view" value={view} />}
            <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm">Search</button>
          </form>

          <div className="flex gap-1 text-sm">
            <Link href={wikiUrl(filters, { view: 'cards' })} className={pillClass(view === 'cards')}>
              Cards
            </Link>
            <Link href={wikiUrl(filters, { view: 'list' })} className={pillClass(view === 'list')}>
              List
            </Link>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Category</span>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={wikiUrl(filters, { category: undefined })} className={pillClass(!category)}>
              All
            </Link>
            {categories.map((c) => (
              <Link key={c.id} href={wikiUrl(filters, { category: c.id })} className={pillClass(category === c.id)}>
                {c.name}
              </Link>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-400">Status</span>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link href={wikiUrl(filters, { status: undefined })} className={pillClass(!status)}>
              All
            </Link>
            {STATUS_OPTIONS.map((s) => (
              <Link key={s.id} href={wikiUrl(filters, { status: s.id })} className={pillClass(status === s.id)}>
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        {articles.length === 0 && <p className="text-sm text-zinc-500">No articles yet.</p>}

        {/* Grouped by category only for the fully unfiltered view -- recency
            is administrative metadata, category is knowledge architecture.
            Any active category/status/search filter already scopes to one
            concern, so grouping there would just be a group-of-one wrapped
            around the same list. */}
        {!isFiltered ? (
          <div className="flex flex-col gap-6">
            {categories.map((cat) => {
              const inCategory = articles.filter((a) => a.category === cat.id)
              if (inCategory.length === 0) return null
              return (
                <div key={cat.id} className="flex flex-col gap-3">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">{cat.name}</h2>
                  {view === 'list' ? <ArticleList articles={inCategory} /> : <ArticleGrid articles={inCategory} />}
                </div>
              )
            })}
          </div>
        ) : (
          articles.length > 0 && (view === 'list' ? <ArticleList articles={articles} /> : <ArticleGrid articles={articles} />)
        )}
      </div>
    </div>
  )
}

function ArticleGrid({ articles }: { articles: Awaited<ReturnType<typeof listArticles>> }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {articles.map((article) => (
        <Link
          key={article.id}
          href={`/wiki/${article.slug}`}
          className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
        >
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-medium">{article.title}</h2>
            <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[article.status]}`}>
              {article.status}
            </span>
          </div>
          {article.short_description && (
            <p className="mt-1 text-sm text-zinc-600">{article.short_description}</p>
          )}
        </Link>
      ))}
    </div>
  )
}

// Denser alternative to ArticleGrid for scanning a large list -- one row per
// article, description truncated to a single line, no card padding/borders
// between rows. Same data, same click target, just a lot more of them fit
// on screen at once.
function ArticleList({ articles }: { articles: Awaited<ReturnType<typeof listArticles>> }) {
  return (
    <div className="flex flex-col divide-y divide-zinc-200 overflow-hidden rounded border border-zinc-200 bg-white">
      {articles.map((article) => (
        <Link
          key={article.id}
          href={`/wiki/${article.slug}`}
          className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-zinc-50"
        >
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <span className="max-w-[50%] shrink-0 truncate font-medium">{article.title}</span>
            {article.short_description && (
              <span className="min-w-0 flex-1 truncate text-sm text-zinc-500">{article.short_description}</span>
            )}
          </div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[article.status]}`}>
            {article.status}
          </span>
        </Link>
      ))}
    </div>
  )
}
