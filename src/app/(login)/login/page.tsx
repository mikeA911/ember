import Image from 'next/image'
import { LoginForm } from '@/components/auth/LoginForm'
import { safeNextPath } from '@/lib/mcp/redirects'

// Lives in its own (login) route group rather than (auth) so it can be a
// full-bleed page: (auth)/layout.tsx centres a narrow column under an
// "Ember" heading, which suits the other auth forms but not a full-screen
// background with the sign-in card off to the right.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="relative isolate flex min-h-screen flex-1 items-center justify-center px-4 py-16 lg:justify-end lg:px-12 xl:px-20">
      {/* Anchored left so the artwork's headline stays in view; the card
          sits over the right-hand photo. Decorative, hence alt="". */}
      <Image
        src="/images/login-background.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="-z-10 object-cover"
        style={{ objectPosition: 'left center' }}
      />
      <div className="w-full max-w-sm rounded-lg border border-white/40 bg-white/95 p-6 shadow-xl backdrop-blur sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ember</h1>
        <LoginForm next={safeNextPath(next)} />
      </div>
    </div>
  )
}
