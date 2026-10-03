import Image from 'next/image'
import { LoginForm } from '@/components/auth/LoginForm'
import { safeNextPath } from '@/lib/mcp/redirects'

// Natural size of public/images/login-background.jpg, and where its baked-in
// LEARN MORE button sits within it (pixels) -- the link below is laid over
// that spot, so these must be updated together if the image is replaced.
const BG_WIDTH = 1822
const BG_HEIGHT = 861
const LEARN_MORE = { x: 212, y: 615, width: 188, height: 47 }

const pct = (n: number, of: number) => `${(n / of) * 100}%`

// Lives in its own (login) route group rather than (auth) so it can be a
// full-bleed page: (auth)/layout.tsx centres a narrow column under an
// "Ember" heading, which suits the other auth forms but not a full-screen
// background with the sign-in card off to the right.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="relative isolate flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-4 py-16 lg:justify-end lg:px-12 xl:px-20">
      {/* Hand-rolled "cover", anchored left, instead of next/image's fill +
          object-cover: the box keeps the image's own aspect ratio, so the
          LEARN MORE link can be positioned in image-relative percentages
          and stays on the button at any viewport size. */}
      <div
        className="absolute left-0 top-1/2 -z-10 -translate-y-1/2"
        style={{
          width: `max(100%, calc(100dvh * ${BG_WIDTH} / ${BG_HEIGHT}))`,
          aspectRatio: `${BG_WIDTH} / ${BG_HEIGHT}`,
        }}
      >
        <Image
          src="/images/login-background.jpg"
          alt=""
          width={BG_WIDTH}
          height={BG_HEIGHT}
          priority
          sizes="100vw"
          className="h-full w-full"
        />
        <a
          href="https://sandz.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Learn more at Sandz.com (opens in a new tab)"
          className="absolute rounded-sm transition hover:bg-black/5 hover:ring-2 hover:ring-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          style={{
            left: pct(LEARN_MORE.x, BG_WIDTH),
            top: pct(LEARN_MORE.y, BG_HEIGHT),
            width: pct(LEARN_MORE.width, BG_WIDTH),
            height: pct(LEARN_MORE.height, BG_HEIGHT),
          }}
        />
      </div>
      <div className="w-full max-w-sm rounded-lg border border-white/40 bg-white/95 p-6 shadow-xl backdrop-blur sm:p-8">
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">Ember</h1>
        <LoginForm next={safeNextPath(next)} />
      </div>
    </div>
  )
}
