'use client'

import { useEffect, useState } from 'react'
import { IKIGAI_SAYINGS } from '@/lib/ikigai-sayings'

// Picked after mount, not during render: the loading screen is prerendered
// and prefetched, so a render-time pick would freeze one saying into the
// cached HTML (and mismatch on hydration). The fallback remounts on every
// navigation, so each loading screen gets a fresh saying.
export function IkigaiSaying() {
  const [saying, setSaying] = useState<string | null>(null)

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- client-only random pick, see above
    setSaying(IKIGAI_SAYINGS[Math.floor(Math.random() * IKIGAI_SAYINGS.length)])
  }, [])

  return (
    // Fixed min-height so the layout doesn't jump when the saying appears.
    <p className="min-h-[3rem] max-w-md text-center text-sm italic text-zinc-600 transition-opacity duration-500" style={{ opacity: saying ? 1 : 0 }}>
      {saying}
    </p>
  )
}
