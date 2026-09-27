import Image from 'next/image'
import Link from 'next/link'
import { PUBLIC_EXAMPLES_ENABLED } from '@/lib/showcases/public-examples'

// Works for both a sessionless visitor and a logged-in user browsing the
// same public pages -- unlike (app)/layout.tsx's Header, this never
// redirects based on auth state. isAuthenticated only changes the
// right-hand CTA (doc: authenticated users keep access, with extra
// actions).
export function PublicHeader({ isAuthenticated, logoUrl }: { isAuthenticated: boolean; logoUrl: string }) {
  return (
    <header className="border-b border-zinc-200 bg-white">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-full">
              <Image src={logoUrl} alt="" fill className="object-cover" />
            </span>
            Ember
          </Link>
          <nav className="flex gap-4 text-sm text-zinc-600">
            <Link href="/about" className="hover:text-zinc-900">About</Link>
            {/* Public route stays /knowledge -- /wiki is already the
                authenticated Wiki management app, reusing it here would
                collide. "Wiki" is the label the design note wants. */}
            <Link href="/knowledge" className="hover:text-zinc-900">Wiki</Link>
            {PUBLIC_EXAMPLES_ENABLED && <Link href="/examples" className="hover:text-zinc-900">Examples</Link>}
            <Link href="/blog" className="hover:text-zinc-900">Blog</Link>
          </nav>
        </div>
        <div className="text-sm text-zinc-600">
          {isAuthenticated ? (
            <Link href="/dashboard" className="rounded bg-zinc-900 px-3 py-1.5 text-white">Go to Workbench</Link>
          ) : (
            <Link href="/login" className="rounded bg-zinc-900 px-3 py-1.5 text-white">Sign In</Link>
          )}
        </div>
      </div>
    </header>
  )
}
