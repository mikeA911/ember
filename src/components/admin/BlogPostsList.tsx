'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import type { BlogPost } from '@/types/database'

type StatusFilter = 'all' | 'draft' | 'review' | 'published'

function statusLabel(post: BlogPost): string {
  if (post.status === 'published') return 'published'
  return post.submitted_for_review_at ? 'ready for review' : 'draft'
}

function authorEmail(id: string | null, emailById: Map<string, string>): string {
  if (!id) return 'Ember editorial seed'
  return emailById.get(id) ?? id
}

// Same shape as AIProvidersList.tsx: each row links out to its own detail
// page rather than managing everything inline in the tab. Extended with a
// status filter and an "Awaiting review" count per the dev request's
// Administrative experience requirements.
export function BlogPostsList({ posts, emailById }: { posts: BlogPost[]; emailById: Map<string, string> }) {
  const [filter, setFilter] = useState<StatusFilter>('all')

  const awaitingReviewCount = useMemo(() => posts.filter((p) => p.status === 'draft' && p.submitted_for_review_at).length, [posts])

  const filtered = useMemo(() => {
    if (filter === 'all') return posts
    if (filter === 'draft') return posts.filter((p) => p.status === 'draft' && !p.submitted_for_review_at)
    if (filter === 'review') return posts.filter((p) => p.status === 'draft' && p.submitted_for_review_at)
    return posts.filter((p) => p.status === 'published')
  }, [posts, filter])

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Blog posts</h2>
          {awaitingReviewCount > 0 && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
              {awaitingReviewCount} awaiting review
            </span>
          )}
        </div>
        <Link href="/admin/blog/new" className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white">
          + New post
        </Link>
      </div>

      <div className="flex gap-2 text-xs">
        {(['all', 'draft', 'review', 'published'] as StatusFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-2.5 py-1 ${filter === f ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
          >
            {f === 'all' ? 'All' : f === 'draft' ? 'Draft' : f === 'review' ? 'Ready for review' : 'Published'}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        {filtered.map((post) => (
          <Link
            key={post.id}
            href={`/admin/blog/${post.id}/edit`}
            className="flex items-center justify-between rounded border border-zinc-200 bg-white p-4 text-sm hover:border-zinc-400"
          >
            <div>
              <div className="font-medium">{post.title}</div>
              <div className="mt-1 flex flex-wrap gap-3 text-xs text-zinc-500">
                <span
                  className={`rounded-full px-2 py-0.5 ${
                    post.status === 'published'
                      ? 'bg-green-100 text-green-800'
                      : post.submitted_for_review_at
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-zinc-100 text-zinc-600'
                  }`}
                >
                  {statusLabel(post)}
                </span>
                <span>/blog/{post.slug}</span>
                <span>Author: {authorEmail(post.author_id, emailById)}</span>
                {post.last_editor_id && post.last_editor_id !== post.author_id && (
                  <span>Last edited: {authorEmail(post.last_editor_id, emailById)}</span>
                )}
                {post.published_at && <span>Published {new Date(post.published_at).toLocaleDateString()}</span>}
              </div>
            </div>
            <span className="text-xs underline">Edit</span>
          </Link>
        ))}
        {filtered.length === 0 && <p className="text-sm text-zinc-500">No blog posts match this filter.</p>}
      </div>
    </section>
  )
}
