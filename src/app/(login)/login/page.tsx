import Image from 'next/image'
import { LoginForm } from '@/components/auth/LoginForm'
import { safeNextPath } from '@/lib/mcp/redirects'
import { sliEnabled } from '@/lib/sli/flag'

type Rect = { x: number; y: number; width: number; height: number }
// anchor: which part of the picture stays in view when the screen is
// wider than the picture's shape and its top and bottom are cropped.
type Background = { src: string; width: number; height: number; anchor: 'center' | 'top'; learnMore?: Rect; card?: Rect }

// Natural size of each background, and spots baked into it (pixels): the
// links and the sign-in card below are laid over those spots, so these must
// be updated together if an image is replaced.
// Ember (builders): LEARN MORE button, laid over with a link to Sandz.com.
const EMBER_BG: Background = {
  src: '/images/login-background.jpg',
  width: 1822,
  height: 861,
  anchor: 'center',
  learnMore: { x: 212, y: 615, width: 188, height: 47 },
}
// Ember SLI (EMBER_SLI_ENABLED): on wide screens the real sign-in card
// covers the chat window painted in the picture. Anchored at the top so the
// "Ember SLI" title is never cropped.
const SLI_BG: Background = {
  src: '/images/ember-sli-login.jpg',
  width: 1197,
  height: 805,
  anchor: 'top',
  card: { x: 541, y: 253, width: 328, height: 360 },
}

const pct = (n: number, of: number) => `${(n / of) * 100}%`

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  const bg = sliEnabled() ? SLI_BG : EMBER_BG
  // The picture is shown "cover", anchored left: its rendered width is the
  // larger of the viewport width and the width that fills the height. The
  // card's position is computed from the same width (viewport units, since
  // a percentage in top would refer to the height).
  const imageWidth = `max(100vw, calc(100dvh * ${bg.width} / ${bg.height}))`
  const card = bg.card
  const cardVars = card
    ? ({
        '--card-left': `calc(${imageWidth} * ${(card.x + card.width / 2) / bg.width})`,
        '--card-top':
          bg.anchor === 'top'
            ? `calc(${imageWidth} * ${(card.y + card.height / 2) / bg.width})`
            : `calc(50% + ${imageWidth} * ${(card.y + card.height / 2 - bg.height / 2) / bg.width})`,
        '--card-width': `max(320px, calc(${imageWidth} * ${card.width / bg.width}))`,
        '--card-height': `calc(${imageWidth} * ${card.height / bg.width})`,
      } as React.CSSProperties)
    : undefined
  return (
    <div className="relative isolate flex min-h-dvh flex-1 items-center justify-center overflow-hidden px-4 py-16 lg:justify-end lg:px-12 xl:px-20">
      {/* Hand-rolled "cover", anchored left, instead of next/image's fill +
          object-cover: the box keeps the image's own aspect ratio, so the
          LEARN MORE link can be positioned in image-relative percentages
          and stays on the button at any viewport size. */}
      <div
        className={bg.anchor === 'top' ? 'absolute left-0 top-0 -z-10' : 'absolute left-0 top-1/2 -z-10 -translate-y-1/2'}
        style={{
          width: imageWidth,
          aspectRatio: `${bg.width} / ${bg.height}`,
        }}
      >
        <Image
          src={bg.src}
          alt=""
          width={bg.width}
          height={bg.height}
          priority
          sizes="100vw"
          className="h-full w-full"
        />
        {bg.learnMore && (
          <a
            href="https://sandz.com"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Learn more at Sandz.com (opens in a new tab)"
            className="absolute rounded-sm transition hover:bg-black/5 hover:ring-2 hover:ring-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            style={{
              left: pct(bg.learnMore.x, bg.width),
              top: pct(bg.learnMore.y, bg.height),
              width: pct(bg.learnMore.width, bg.width),
              height: pct(bg.learnMore.height, bg.height),
            }}
          />
        )}
      </div>
      <a
        href="https://sandz.com"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute left-4 top-4 shadow-md transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:left-6 sm:top-6"
      >
        <Image src="/images/sandz-logo.png" alt="Sandz (opens in a new tab)" width={71} height={90} priority className="h-[72px] w-auto sm:h-[90px]" />
      </a>
      <div
        style={cardVars}
        className={
          card
            ? 'w-full max-w-sm rounded-lg border border-white/40 bg-white/95 p-6 shadow-xl backdrop-blur sm:p-8 lg:absolute lg:left-[var(--card-left)] lg:top-[var(--card-top)] lg:flex lg:min-h-[var(--card-height)] lg:w-[var(--card-width)] lg:max-w-none lg:-translate-x-1/2 lg:-translate-y-1/2 lg:flex-col lg:items-center lg:justify-center lg:bg-white'
            : 'w-full max-w-sm rounded-lg border border-white/40 bg-white/95 p-6 shadow-xl backdrop-blur sm:p-8'
        }
      >
        <div className="w-full max-w-sm">
          <h1 className="mb-6 text-2xl font-semibold tracking-tight">{card ? 'Sign in' : 'Ember'}</h1>
          <LoginForm next={safeNextPath(next)} home={sliEnabled() ? '/sli' : '/dashboard'} />
        </div>
      </div>
    </div>
  )
}
