'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/browser'
import { NavDropdown } from '@/components/NavDropdown'
import type { Profile } from '@/types/database'

const EXPLORE_ITEMS = [
  { href: '/evals', label: 'Evals' },
  { href: '/graphs', label: 'Graphs' },
  { href: '/agents', label: 'Agents' },
  { href: '/agent-registry', label: 'Agent Registry (external)' },
  { href: '/methods', label: 'Methods' },
]

// Ember Role-Directed Product Experience (docs/dev-request-ember-role-
// directed-product-experience.md), Stage 1 -- "remove management navigation
// from the member shell." curator/admin keep today's full nav unchanged;
// everyone else (member, consultant, and anonymous as the conservative
// default) gets just the Ember link plus a "Switch to classic workspace"
// reveal -- the doc's required temporary escape route, done as a cheap
// client-side toggle since the real Stage 3 My work/Explore destinations
// aren't built yet.
const CLASSIC_NAV_ROLES = new Set(['curator', 'admin'])

export function Header({
  profile,
  logoUrl,
  productMode = 'enterprise',
}: {
  profile: Profile
  logoUrl: string
  productMode?: 'enterprise' | 'builder'
}) {
  const router = useRouter()
  const [showClassicNav, setShowClassicNav] = useState(false)
  const hasClassicNav = CLASSIC_NAV_ROLES.has(profile.role)
  // KB Sandbox Builder (docs/dev-request-kb-sandbox-builder-product.md) --
  // a builder (consultant/member, never curator/admin) gets Wiki/Blog
  // visible by default rather than hidden behind the classic-workspace
  // toggle, and no Projects/Trending/Explore/toggle at all -- those aren't
  // meaningful for an individual Builder deployment. Curator/admin (the
  // operator's own staff, doing programme administration) keep today's
  // full classic nav unchanged in either mode.
  const isBuilderShell = productMode === 'builder' && !hasClassicNav

  async function handleSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/')
    router.refresh()
  }

  const classicLinks = (
    <>
      <Link href="/projects" className="hover:text-zinc-900">Projects</Link>
      <Link href="/wiki" className="hover:text-zinc-900">Wiki</Link>
      <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
      <Link href="/trending" className="hover:text-zinc-900">Trending</Link>
      <NavDropdown label="Explore" items={EXPLORE_ITEMS} />
    </>
  )

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
                {classicLinks}
              </>
            ) : isBuilderShell ? (
              <>
                <Link href="/dashboard" className="hover:text-zinc-900">Ember</Link>
                <Link href="/wiki" className="hover:text-zinc-900">Wiki</Link>
                <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
              </>
            ) : (
              <>
                <Link href="/dashboard" className="hover:text-zinc-900">Ember</Link>
                {showClassicNav && classicLinks}
                <button
                  type="button"
                  onClick={() => setShowClassicNav((v) => !v)}
                  className="text-xs text-zinc-400 underline hover:text-zinc-600"
                >
                  {showClassicNav ? 'Hide classic workspace' : 'Switch to classic workspace'}
                </button>
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
            // phone width (375px) and crowding the classic-workspace toggle.
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
