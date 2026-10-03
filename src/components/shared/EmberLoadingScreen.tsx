'use client'

import { useEffect, useState } from 'react'
import { IKIGAI_SAYINGS } from '@/lib/ikigai-sayings'

// One saying per loading "episode": NavigationOverlay picks it the moment a
// link is clicked, and if the route's loading.tsx fallback takes over a beat
// later it reuses that same saying instead of swapping in a different one.
let lastPick: { saying: string; at: number } | null = null
const REUSE_WINDOW_MS = 3000

export function pickSaying(): string {
  const saying = IKIGAI_SAYINGS[Math.floor(Math.random() * IKIGAI_SAYINGS.length)]
  lastPick = { saying, at: Date.now() }
  return saying
}

function currentOrNewSaying(): string {
  return lastPick && Date.now() - lastPick.at < REUSE_WINDOW_MS ? lastPick.saying : pickSaying()
}

// Full-screen glowing ember + ikigai saying. Used both by NavigationOverlay
// (shown instantly on click) and by (app)/loading.tsx, and identical in both
// so the hand-off between them is invisible.
export function EmberLoadingScreen({ saying: givenSaying }: { saying?: string }) {
  // Without a given saying, pick after mount, not during render: loading.tsx
  // is prerendered and prefetched, so a render-time pick would freeze one
  // saying into the cached HTML (and mismatch on hydration).
  const [ownSaying, setOwnSaying] = useState<string | null>(null)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only random pick, see above
    if (!givenSaying) setOwnSaying(currentOrNewSaying())
  }, [givenSaying])
  const saying = givenSaying ?? ownSaying

  return (
    <div role="status" aria-live="polite" className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-4 bg-zinc-50 px-6">
      {/* Plain <img>, not next/image: an 8KB static asset that has to paint
          immediately, with no optimizer round trip. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/ember-loading.webp" alt="" width={96} height={96} className="ember-glow rounded-full" />
      <span className="text-sm text-zinc-500">Loading…</span>
      {/* Fixed min-height so the layout doesn't jump when the saying appears. */}
      <p
        className="min-h-[3rem] max-w-md text-center text-sm italic text-zinc-600 transition-opacity duration-500"
        style={{ opacity: saying ? 1 : 0 }}
      >
        {saying}
      </p>
    </div>
  )
}
