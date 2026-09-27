import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getPublicArticleBySlug, listRelatedExamples } from '@/lib/wiki/public'
import { Markdown } from '@/components/shared/Markdown'
import { SectionHero } from '@/components/SectionHero'

// Per-article banners are a deliberate one-off, not a general "every
// article gets custom art" system -- only the articles an actual asset was
// supplied for get one.
const ARTICLE_BANNERS: Record<string, string> = {
  'retrieval-augmented-generation': '/images/sections/techno_rag.png',
  'ai-governance': '/images/sections/admin.png',
  'agentic-loops': '/images/sections/Agent_loops.png',
  'graph-workflows': '/images/sections/graph-workflow.png',
  'local-llm-deployment': '/images/sections/kb-sandbox.png',
}

// No Sources section, no version history, no Edit link -- all staff-only
// concerns (and Sources would point at potentially private document
// chunks). Only the current approved version's own content.
export default async function PublicArticlePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const result = await getPublicArticleBySlug(supabase, slug)
  if (!result) notFound()
  const { article, version } = result

  const relatedExamples = await listRelatedExamples(supabase, slug)
  const banner = ARTICLE_BANNERS[slug]

  return (
    <div className="flex flex-col gap-6">
      {banner && <SectionHero image={banner} height="compact" />}

      <div>
        <h1 className="text-2xl font-semibold">{article.title}</h1>
        {article.short_description && <p className="mt-1 text-zinc-600">{article.short_description}</p>}
      </div>

      <div className="rounded border border-zinc-200 bg-white p-5">
        <p className="mb-4 rounded bg-zinc-50 p-3 text-sm text-zinc-700">
          <span className="font-medium">Quick help: </span>
          {version.quick_help}
        </p>
        <Markdown text={version.content} />
        {version.implementation_notes && (
          <div className="mt-4">
            <h3 className="font-semibold text-zinc-900">Implementation notes</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{version.implementation_notes}</p>
          </div>
        )}
        {version.limitations && (
          <div className="mt-4">
            <h3 className="font-semibold text-zinc-900">Limitations</h3>
            <p className="mt-1 whitespace-pre-wrap text-sm text-zinc-700">{version.limitations}</p>
          </div>
        )}
      </div>

      {relatedExamples.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Related Learning</h2>
          <div className="flex flex-wrap gap-2 text-sm">
            {relatedExamples.map((p) => (
              <Link key={p.id} href={`/examples/${p.public_slug}`} className="rounded-full bg-zinc-100 px-3 py-1 hover:bg-zinc-200">
                {p.public_profile?.title || p.name}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
