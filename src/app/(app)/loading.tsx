// Instant navigation feedback for every page under the (app) layout. Without
// this, clicking a link (e.g. a project card) shows nothing at all until the
// destination's server render has finished. Next prefetches this fallback, so
// it appears the moment the link is clicked while the real page streams in.
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6 animate-pulse">
      <span className="sr-only">Loading…</span>
      <div className="flex flex-col gap-2">
        <div className="h-6 w-1/3 rounded bg-zinc-200" />
        <div className="h-4 w-1/5 rounded bg-zinc-100" />
      </div>
      <div className="flex flex-col gap-2">
        <div className="h-4 w-full rounded bg-zinc-100" />
        <div className="h-4 w-5/6 rounded bg-zinc-100" />
        <div className="h-4 w-2/3 rounded bg-zinc-100" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="h-24 rounded border border-zinc-200 bg-zinc-50" />
        <div className="h-24 rounded border border-zinc-200 bg-zinc-50" />
      </div>
    </div>
  )
}
