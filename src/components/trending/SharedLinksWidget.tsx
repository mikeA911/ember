import Link from 'next/link'
import { AddSharedLinkForm } from './AddSharedLinkForm'
import { RemoveSharedLinkButton } from './RemoveSharedLinkButton'
import type { SharedLinkRow } from '@/lib/trending/queries'

// Dashboard card -- same header+list+empty-state shape as
// UnpublishedWikiWidget.tsx, shown to every non-anonymous signed-in user
// (not gated to curators, unlike that widget). Backed by trending_items;
// "Shared links" is presentation, not a second data model (see
// docs/dev-request-dashboard-shared-links-and-library-foundation.md).
export function SharedLinksWidget({
  links,
  projects,
  isAdmin,
}: {
  links: SharedLinkRow[]
  projects: { id: string; name: string }[]
  isAdmin: boolean
}) {
  return (
    <div className="rounded border border-zinc-200 bg-white">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
        <div>
          <h2 className="font-medium">Shared links</h2>
          <p className="mt-0.5 text-xs text-zinc-500">
            Shared by Workbench users. Links are recommendations, not approved Ember knowledge.
          </p>
        </div>
        <Link href="/trending" className="shrink-0 text-sm text-zinc-500 hover:text-zinc-900">
          View all shared links
        </Link>
      </div>

      <div className="border-b border-zinc-100 px-4 py-3">
        <AddSharedLinkForm projects={projects} />
      </div>

      {links.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-zinc-500">Found something useful? Add a link for other Workbench users to read.</p>
      ) : (
        <ul className="divide-y divide-zinc-100">
          {links.map((link) => (
            <li key={link.id} className="flex items-start justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <a href={link.source_url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {link.title}
                  </a>
                  <span className="text-xs text-zinc-400" title="Opens an external site">
                    ↗
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">
                  {link.source_name || safeHostname(link.source_url)} &middot; {link.contributorEmail ?? 'a Workbench user'} &middot;{' '}
                  {new Date(link.created_at).toLocaleDateString()}
                </p>
                <p className="mt-1 text-sm text-zinc-700">{link.description}</p>
                {link.tags.length > 0 && <p className="mt-1 text-xs text-zinc-500">{link.tags.join(' · ')}</p>}
              </div>
              {isAdmin && (
                <div className="shrink-0">
                  <RemoveSharedLinkButton trendingItemId={link.id} title={link.title} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// source_url is validated at submission time (src/lib/trending/url-safety.ts),
// but this guards display of any pre-existing row from before that
// validation existed rather than letting a malformed URL crash the card.
function safeHostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}
