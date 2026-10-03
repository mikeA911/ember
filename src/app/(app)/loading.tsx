import { EmberLoadingScreen } from '@/components/shared/EmberLoadingScreen'

// Route-level fallback for pages under the (app) layout -- covers loads the
// click-triggered NavigationOverlay can't see (back/forward, router.push
// after a form submit, a first visit streaming in). Same screen as the
// overlay, so if both appear in turn the hand-off is invisible.
export default function Loading() {
  return <EmberLoadingScreen />
}
