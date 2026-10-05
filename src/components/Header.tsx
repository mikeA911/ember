'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'
import { NavDropdown } from '@/components/NavDropdown'
import type { Profile } from '@/types/database'

// Evals is platform-admin only (Ember Readiness, Stage 1 --
// docs/dev-request-ember-readiness-and-knowledge-gaps.md): admins also reach
// it from Admin -> Ember readiness; curators author their datasets from the
// Project page.
const EVALS_ITEM = { href: '/evals', label: 'Evals' }
const EXPLORE_ITEMS = [
  { href: '/graphs', label: 'Graphs' },
  { href: '/agents', label: 'Agents' },
  { href: '/agent-registry', label: 'Agent Registry (external)' },
  { href: '/methods', label: 'Methods' },
]

// Ember Role-Directed Product Experience (docs/dev-request-ember-role-
// directed-product-experience.md), Stage 1 -- "remove management navigation
// from the member shell." curator/admin (the agency's own staff) keep the
// full nav plus Agency; everyone else (member, consultant, and anonymous as
// the conservative default) gets the builder shell -- Ember, Projects, Wiki
// and Blog, with no Trending/Explore (docs/dev-request-kb-sandbox-builder-
// product.md).
const CLASSIC_NAV_ROLES = new Set(['curator', 'admin'])

export function Header({
  profile,
  logoUrl,
}: {
  profile: Profile
  logoUrl: string
}) {
  const router = useRouter()
  const hasClassicNav = CLASSIC_NAV_ROLES.has(profile.role)

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-y-2 px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/about" aria-label="About Ember" className="shrink-0">
            <span className="relative block h-9 w-9 overflow-hidden rounded-full">
              <Image src={logoUrl} alt="Ember" fill className="object-cover" />
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            {hasClassicNav ? (
              <>
                <Link href="/dashboard" className="hover:text-zinc-900">Workbench</Link>
                <Link href="/projects" className="hover:text-zinc-900">Projects</Link>
                <Link href="/wiki" className="hover:text-zinc-900">Wiki</Link>
                <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
                <Link href="/trending" className="hover:text-zinc-900">Trending</Link>
                <NavDropdown label="Explore" items={profile.role === 'admin' ? [EVALS_ITEM, ...EXPLORE_ITEMS] : EXPLORE_ITEMS} />
                <Link href="/agency" className="hover:text-zinc-900">Agency</Link>
              </>
            ) : (
              <>
                <Link href="/dashboard" className="hover:text-zinc-900">Ember</Link>
                <Link href="/projects" className="hover:text-zinc-900">Projects</Link>
                <Link href="/wiki" className="hover:text-zinc-900">Wiki</Link>
                <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
              </>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-600">
          {hasClassicNav ? (
            <Link href="/profile" className="hover:text-zinc-900">
              {profile.email ?? 'anonymous'} · {profile.role}
            </Link>
          ) : (
            // Minimal shell: the mobile nav the dev request suggests is
            // "Ember | My work | Explore | Me" -- "Me" is the compact
            // profile identity on a narrow screen, instead of a full
            // email/role string that was wrapping across 3 lines at a
            // phone width (375px) and crowding the nav.
            <Link href="/profile" className="hover:text-zinc-900">
              Me
            </Link>
          )}
          <button onClick={handleSignOut} className="underline">Sign out</button>
        </div>
      </div>
    </header>
  )
}
