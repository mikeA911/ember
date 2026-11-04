'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/browser'

// The SLI shell's header (docs/dev-request-sandz-sli-discovery-and-triggers.md
// §3): SLI navigation only, in the organisation's own name. Platform admins
// and curators also get a way back to the full Ember navigation.
const NAV = [
  { href: '/sli', label: 'Home', exact: true },
  { href: '/sli/discovery', label: 'Discovery', exact: false },
]

export function SliHeader({
  productName,
  byline,
  logoUrl,
  showCoreLink,
}: {
  productName: string
  byline: string
  logoUrl: string
  showCoreLink: boolean
}) {
  const router = useRouter()
  const pathname = usePathname()

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
          <Link href="/sli" className="flex shrink-0 items-center gap-2">
            <span className="relative block h-9 w-9 overflow-hidden rounded-full">
              <Image src={logoUrl} alt="" fill className="object-cover" />
            </span>
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-zinc-900">{productName}</span>
              {byline && <span className="block text-xs text-zinc-500">{byline}</span>}
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-zinc-600">
            {NAV.map((item) => {
              const active = item.exact ? pathname === item.href : pathname.startsWith(item.href)
              return (
                <Link key={item.href} href={item.href} className={active ? 'font-medium text-zinc-900' : 'hover:text-zinc-900'}>
                  {item.label}
                </Link>
              )
            })}
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm text-zinc-600">
          {showCoreLink && (
            <Link href="/dashboard" className="hover:text-zinc-900">
              Ember admin
            </Link>
          )}
          <button onClick={handleSignOut} className="underline">
            Sign out
          </button>
        </div>
      </div>
    </header>
  )
}
