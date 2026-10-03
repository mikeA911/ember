'use client'

import { useEffect, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import { EmberLoadingScreen, pickSaying } from '@/components/shared/EmberLoadingScreen'

// Safety net: hide even if the navigation never lands (cancelled, errored,
// or the link was actually a file download).
const MAX_VISIBLE_MS = 15000

// Shows the ember loading screen the instant an in-app link is clicked,
// before any server round trip. loading.tsx alone can't guarantee that: its
// fallback only appears once prefetched (never in `next dev`) or once the
// server starts streaming, and Next doesn't re-show a parent segment's
// fallback when navigating between its children (e.g. /projects ->
// /projects/[id]). Hidden again as soon as the URL changes, i.e. the moment
// the new page -- or its own loading fallback -- is on screen.
export function NavigationOverlay() {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const routeKey = `${pathname}?${searchParams.toString()}`
  const [pending, setPending] = useState<{ fromRouteKey: string; saying: string } | null>(null)
  // Any route change ends the episode -- cleared during render (React's
  // "adjust state when a prop changes" pattern) rather than merely hidden,
  // so going Back to the original route can't bring a stale overlay back.
  const [lastRouteKey, setLastRouteKey] = useState(routeKey)
  if (lastRouteKey !== routeKey) {
    setLastRouteKey(routeKey)
    setPending(null)
  }

  useEffect(() => {
    function onClick(e: MouseEvent) {
      // Capture phase, so this runs before <Link> calls preventDefault().
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const anchor = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!anchor || (anchor.target && anchor.target !== '_self') || anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin || url.pathname.startsWith('/api/')) return
      // Same page (incl. pure #hash links): no navigation to wait for.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return
      setPending({ fromRouteKey: routeKey, saying: pickSaying() })
    }
    document.addEventListener('click', onClick, true)
    return () => document.removeEventListener('click', onClick, true)
  }, [routeKey])

  // Also checked here so the frame before that reset never shows it.
  const visible = pending !== null && pending.fromRouteKey === routeKey

  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(() => setPending(null), MAX_VISIBLE_MS)
    return () => clearTimeout(timer)
  }, [visible])

  return visible ? <EmberLoadingScreen saying={pending.saying} /> : null
}
