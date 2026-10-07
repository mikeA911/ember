import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { listPublishedPosts } from '@/lib/blog/public'
import { env } from '@/lib/env'

// First sitemap/robots implementation in this codebase -- deliberately
// scoped to exactly what the dev request asks for (the public Blog index
// and every published post), not the whole site's public surface. Drafts,
// submitted-for-review posts, and editorial placeholders never reach this:
// listPublishedPosts already filters to status = 'published'.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = await createClient()
  const posts = await listPublishedPosts(supabase)
  const siteUrl = env.siteUrl()

  return [
    { url: siteUrl, changeFrequency: 'weekly', priority: 0.5 },
    { url: `${siteUrl}/builders`, changeFrequency: 'monthly', priority: 0.6 },
    { url: `${siteUrl}/blog`, changeFrequency: 'daily', priority: 0.8 },
    ...posts.map((post) => ({
      url: `${siteUrl}/blog/${post.slug}`,
      lastModified: post.updated_at,
      changeFrequency: 'monthly' as const,
      priority: 0.7,
    })),
  ]
}
