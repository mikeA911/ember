import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { listPublicArticles } from '@/lib/wiki/public'
import { listCategories } from '@/lib/wiki/queries'
import type { WikiCategoryId } from '@/types/database'
import { SectionHero } from '@/components/SectionHero'

export default async function PublicKnowledgePage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string; q?: string }>
}) {
  const { category, q } = await searchParams
  const supabase = await createClient()

  const [categories, articles] = await Promise.all([
    listCategories(supabase),
    listPublicArticles(supabase, { category: category as WikiCategoryId | undefined, search: q }),
  ])

  return (
    <div className="flex flex-col gap-6">
      <SectionHero image="/images/sections/kb-sandbox.png" height="standard" priority />

      <div>
        <h1 className="text-xl font-semibold">AI Engineering Wiki</h1>
        <p className="mt-1 text-sm text-zinc-600">
          Practical reference material for building, evaluating and governing modern AI systems.
        </p>
      </div>

      <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        This page contains only articles approved for public viewing. Sandz and other
        organization-specific knowledge remains protected.{' '}
        <Link href="/login" className="font-semibold underline underline-offset-4 hover:text-amber-800">
          Sign in to view the knowledge available to you.
        </Link>
      </aside>

      <form className="flex flex-wrap gap-2" action="/knowledge">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Search title or description…"
          className="w-64 rounded border border-zinc-300 px-3 py-2 text-sm"
        />
        {category && <input type="hidden" name="category" value={category} />}
        <button type="submit" className="rounded border border-zinc-300 px-3 py-2 text-sm">Search</button>
      </form>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link href="/knowledge" className={`rounded-full px-3 py-1 ${!category ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}>
          All
        </Link>
        {categories.map((c) => (
          <Link
            key={c.id}
            href={`/knowledge?category=${c.id}`}
            className={`rounded-full px-3 py-1 ${category === c.id ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-700'}`}
          >
            {c.name}
          </Link>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {articles.map((article) => (
          <Link
            key={article.id}
            href={`/knowledge/${article.slug}`}
            className="rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
          >
            <h2 className="font-medium">{article.title}</h2>
            {article.short_description && <p className="mt-1 text-sm text-zinc-600">{article.short_description}</p>}
          </Link>
        ))}
        {articles.length === 0 && (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-5 sm:col-span-2">
            <p className="text-sm font-medium text-zinc-800">No public articles match this view.</p>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              The material may be organization-only rather than missing.{' '}
              <Link href="/login" className="font-medium underline underline-offset-4 hover:text-zinc-900">
                Sign in and open the full Wiki
              </Link>{' '}
              to see content your account is permitted to use.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
