import { IkigaiSaying } from '@/components/shared/IkigaiSaying'

// Instant navigation feedback for every page under the (app) layout. Without
// this, clicking a link (e.g. a project card) shows nothing at all until the
// destination's server render has finished. Next prefetches this fallback, so
// it appears the moment the link is clicked while the real page streams in.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex min-h-[50vh] flex-col items-center justify-center gap-4">
      {/* Plain <img>, not next/image: an 8KB static asset that has to paint
          immediately, with no optimizer round trip. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/images/ember-loading.webp" alt="" width={96} height={96} className="ember-glow rounded-full" />
      <span className="text-sm text-zinc-500">Loading…</span>
      <IkigaiSaying />
    </div>
  )
}
