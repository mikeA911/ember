'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Image from 'next/image'
import { updateBrandingIconAction } from '@/app/actions/branding'
import type { BrandingUrls } from '@/lib/branding'

export function BrandingSettings({ current }: { current: BrandingUrls }) {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setMessage(null)
    const file = fileRef.current?.files?.[0]
    if (!file) {
      setError('Choose an image file first')
      return
    }
    const formData = new FormData()
    formData.set('file', file)
    startTransition(async () => {
      try {
        await updateBrandingIconAction(formData)
        setMessage('Icon updated.')
        if (fileRef.current) fileRef.current.value = ''
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to update icon')
      }
    })
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">Branding</h2>
      <p className="text-sm text-zinc-600">
        Used as the site logo, browser tab icon, and the icon shown when someone installs Ember as an app
        (PWA home-screen / app icon). Square images work best &mdash; non-square uploads are center-cropped.
      </p>

      <div className="flex items-center gap-4 rounded border border-zinc-200 bg-white p-4">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-full border border-zinc-200">
          <Image src={current.logo} alt="Current logo" fill sizes="64px" className="object-cover" />
        </div>
        <p className="text-xs text-zinc-500">
          192&times;192, 512&times;512, and Apple touch icon variants are generated automatically from whatever
          you upload here.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="text-sm" />
        <button disabled={isPending} className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50">
          {isPending ? 'Uploading…' : 'Upload new icon'}
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {message && <p className="text-sm text-green-700">{message}</p>}
    </section>
  )
}
