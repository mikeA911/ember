import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getPublishedPostBySlug } from '@/lib/blog/public'
import { getBlogMediaUrl } from '@/lib/blog/media'
import { getRelatedPosts } from '@/lib/blog/relations'
import { Markdown } from '@/components/shared/Markdown'
import { env } from '@/lib/env'

// This app's first per-page metadata (only the root layout set any before
// this) -- extended here with canonical/OG/Twitter tags per the dev
// request's "essential search metadata" requirement.
export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const supabase = await createClient()
  const post = await getPublishedPostBySlug(supabase, slug)
  if (!post) return {}

  const url = `${env.siteUrl()}/blog/${post.slug}`
  const imageUrl = post.cover_image_path ? getBlogMediaUrl(supabase, post.cover_image_path) : undefined

  return {
    title: `${post.title} | Ember Blog`,
    description: post.excerpt ?? undefined,
    alternates: { canonical: url },
    openGraph: {
      title: post.title,
      description: post.excerpt ?? undefined,
      url,
      type: 'article',
      publishedTime: post.published_at ?? undefined,
      modifiedTime: post.updated_at,
      images: imageUrl ? [{ url: imageUrl, alt: post.cover_image_alt ?? post.title }] : undefined,
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.excerpt ?? undefined,
      images: imageUrl ? [imageUrl] : undefined,
    },
  }
}

export default async function BlogPostPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const supabase = await createClient()

  const post = await getPublishedPostBySlug(supabase, slug)
  if (!post) notFound()

  const related = await getRelatedPosts(supabase, post.id, true)
  const url = `${env.siteUrl()}/blog/${post.slug}`
  const coverImageUrl = post.cover_image_path ? getBlogMediaUrl(supabase, post.cover_image_path) : null

  // Publisher only -- no personal author name, since the page itself
  // doesn't display one. The dev request requires JSON-LD to only include
  // author/publisher information that is "genuinely displayed and
  // attributable."
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    url,
    datePublished: post.published_at ?? undefined,
    dateModified: post.updated_at,
    ...(coverImageUrl ? { image: coverImageUrl } : {}),
    publisher: { '@type': 'Organization', name: 'Ember' },
  }

  return (
    <article className="flex flex-col gap-6">
      {/* Fixed BlogPosting shape built above from stored fields, not user-supplied markup. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {coverImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL, not a static asset.
        <img src={coverImageUrl} alt={post.cover_image_alt ?? ''} className="h-64 w-full rounded object-cover" />
      )}

      <div>
        <h1 className="text-2xl font-semibold">{post.title}</h1>
        {post.published_at && <p className="mt-1 text-sm text-zinc-500">{new Date(post.published_at).toLocaleDateString()}</p>}
      </div>

      <div className="rounded border border-zinc-200 bg-white p-5">
        <Markdown text={post.content} />
      </div>

      {related.length > 0 && (
        <div className="rounded border border-zinc-200 bg-white p-5">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Related articles</h2>
          <ul className="mt-2 flex flex-col gap-2">
            {related.map((r) => (
              <li key={r.relationId}>
                <Link href={`/blog/${r.post.slug}`} className="text-blue-700 underline hover:text-blue-900">
                  {r.post.title}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  )
}
