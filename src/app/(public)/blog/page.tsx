import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listPublishedPosts } from '@/lib/blog/public'
import { getBlogMediaUrl } from '@/lib/blog/media'
import { SectionHero } from '@/components/SectionHero'
import { env } from '@/lib/env'

const DESCRIPTION = 'Notes on building, evaluating, and deploying Ember.'

export function generateMetadata(): Metadata {
  const url = `${env.siteUrl()}/blog`
  return {
    title: 'Blog | Ember',
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: { title: 'Ember Blog', description: DESCRIPTION, url, type: 'website' },
    twitter: { card: 'summary', title: 'Ember Blog', description: DESCRIPTION },
  }
}

export default async function BlogIndexPage() {
  const supabase = await createClient()
  const posts = await listPublishedPosts(supabase)

  // Non-blocking: this page stays public/auth-agnostic for everyone else --
  // only used to surface a "My drafts" link for curators/admins, who no
  // longer get a separate top-nav Blog link pointing at /contribute/blog
  // (that link used to BE "Blog" in the nav, which meant a signed-in
  // curator/admin saw only their own drafts where an anonymous visitor saw
  // every published post -- this page is now the one "Blog" destination for
  // everyone, any role).
  const {
    data: { user },
  } = await supabase.auth.getUser()
  let canContribute = false
  if (user) {
    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    canContribute = profile?.role === 'curator' || profile?.role === 'admin'
  }

  return (
    <div className="flex flex-col gap-6">
      <SectionHero image="/images/sections/kb-sandbox.png" height="standard" priority />

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Blog</h1>
          <p className="mt-1 text-sm text-zinc-600">{DESCRIPTION}</p>
        </div>
        {canContribute && (
          <Link href="/contribute/blog" className="shrink-0 rounded border border-zinc-300 px-3 py-1.5 text-sm">
            My drafts
          </Link>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {posts.map((post) => {
          const coverImageUrl = post.cover_image_path ? getBlogMediaUrl(supabase, post.cover_image_path) : null
          return (
            <Link
              key={post.id}
              href={`/blog/${post.slug}`}
              className="flex gap-4 rounded border border-zinc-200 bg-white p-4 hover:border-zinc-400"
            >
              {coverImageUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL, not a static asset.
                <img src={coverImageUrl} alt={post.cover_image_alt ?? ''} className="h-20 w-28 shrink-0 rounded object-cover" />
              )}
              <div>
                <h2 className="font-medium">{post.title}</h2>
                {post.published_at && <p className="mt-1 text-xs text-zinc-500">{new Date(post.published_at).toLocaleDateString()}</p>}
                {post.excerpt && <p className="mt-2 text-sm text-zinc-700">{post.excerpt}</p>}
              </div>
            </Link>
          )
        })}
        {posts.length === 0 && <p className="text-sm text-zinc-500">No posts yet -- check back soon.</p>}
      </div>
    </div>
  )
}
