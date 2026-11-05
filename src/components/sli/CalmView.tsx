'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { saveViewSettingsAction, setViewPhotoAction } from '@/app/actions/view-settings'
import { createClient } from '@/lib/supabase/browser'
import type { SavedView, ViewScene } from '@/lib/view-settings-shared'

// The calm workspace's background view (docs/design-notes/ember-sli-calm-workspace.md §6):
// painted scenes, the sign-in picture, or the person's own photo, behind
// frosted glass, with dim and soften sliders. Saved with the person's
// account (20261112100001_view_settings.sql), so it follows them to any
// device. Their photo is resized in the browser, then uploaded into their
// own folder of the private view-photos bucket; only they can see it.

export type ViewSettings = { scene: ViewScene; photo: string | null; dim: number; soften: number }

const DEFAULTS: ViewSettings = { scene: 'ember', photo: null, dim: 15, soften: 0 }
const SAVE_DELAY_MS = 600

// The sign-in page's picture, the default view.
export const EMBER_SCENE = '/images/ember-sli-login.jpg'

export const SCENES: Record<'dusk' | 'mist', string> = {
  dusk:
    'radial-gradient(ellipse 60% 50% at 18% 70%, rgba(236,160,80,.55), transparent 60%),' +
    'radial-gradient(ellipse 45% 40% at 62% 46%, rgba(186,170,70,.55), transparent 65%),' +
    'radial-gradient(ellipse 55% 60% at 88% 40%, rgba(60,110,60,.85), transparent 70%),' +
    'radial-gradient(ellipse 70% 45% at 50% 95%, rgba(30,50,35,.9), transparent 70%),' +
    'linear-gradient(180deg, #0b0f0e 0%, #1b2a20 45%, #2c4430 70%, #121a15 100%)',
  mist:
    'radial-gradient(ellipse 70% 40% at 30% 30%, rgba(255,255,255,.9), transparent 70%),' +
    'radial-gradient(ellipse 60% 35% at 75% 65%, rgba(170,195,180,.7), transparent 70%),' +
    'radial-gradient(ellipse 80% 30% at 50% 100%, rgba(120,150,135,.6), transparent 70%),' +
    'linear-gradient(180deg, #e9eeea 0%, #d6e0da 55%, #b9c9bf 100%)',
}

export function useViewSettings(saved: SavedView | null) {
  const [settings, setSettings] = useState<ViewSettings>(() =>
    saved ? { scene: saved.scene, photo: saved.photoUrl, dim: saved.dim, soften: saved.soften } : DEFAULTS
  )
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  // Shown at once; saved a moment later, so dragging a slider saves once.
  const update = useCallback((next: Partial<ViewSettings>) => {
    setSettings((prev) => {
      const merged = { ...prev, ...next }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        void saveViewSettingsAction({ scene: merged.scene, dim: merged.dim, soften: merged.soften }).then((r) => {
          if (!r.ok) setNote(r.error)
        })
      }, SAVE_DELAY_MS)
      return merged
    })
    setNote(null)
  }, [])

  const uploadPhoto = useCallback(async (file: File) => {
    setBusy(true)
    setNote('Saving your photo…')
    try {
      const blob = await resizePhoto(file)
      const supabase = createClient()
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) throw new Error('signed out')
      const path = `${user.id}/${Date.now()}.jpg`
      const { error } = await supabase.storage.from('view-photos').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
      if (error) throw error
      const res = await setViewPhotoAction(path)
      if (!res.ok) throw new Error(res.error)
      setSettings((prev) => ({ ...prev, scene: 'photo', photo: res.photoUrl }))
      setNote(null)
    } catch {
      setNote('That photo couldn’t be saved. Try another one, or a smaller one.')
    } finally {
      setBusy(false)
    }
  }, [])

  const removePhoto = useCallback(async () => {
    setBusy(true)
    const res = await setViewPhotoAction(null)
    setBusy(false)
    if (!res.ok) {
      setNote(res.error)
      return
    }
    setSettings((prev) => ({ ...prev, photo: null, scene: prev.scene === 'photo' ? 'ember' : prev.scene }))
    setNote('Your photo was removed.')
  }, [])

  return { settings, update, note, setNote, busy, uploadPhoto, removePhoto }
}

export function ViewBackground({ settings }: { settings: ViewSettings }) {
  const image =
    settings.scene === 'photo' && settings.photo
      ? `url("${settings.photo}")`
      : settings.scene === 'ember'
        ? `url("${EMBER_SCENE}")`
        : settings.scene === 'dusk' || settings.scene === 'mist'
          ? SCENES[settings.scene]
          : null
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-zinc-100 bg-cover bg-center transition-opacity duration-700"
        style={{
          backgroundImage: image ?? undefined,
          filter: settings.soften ? `blur(${settings.soften}px)` : undefined,
          transform: settings.soften ? 'scale(1.03)' : undefined,
        }}
      />
      <div aria-hidden="true" className="absolute inset-0" style={{ background: image ? `rgba(8,12,11,${settings.dim / 100})` : undefined }} />
    </>
  )
}

// Up to 2400px on the long side, as a JPEG under the bucket's 5MB limit.
async function resizePhoto(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image()
      i.onload = () => resolve(i)
      i.onerror = reject
      i.src = url
    })
    const scale = Math.min(1, 2400 / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height)
    const toJpeg = (quality: number) =>
      new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality))
    let quality = 0.85
    let blob = await toJpeg(quality)
    while (blob.size > 2_500_000 && quality > 0.45) {
      quality -= 0.1
      blob = await toJpeg(quality)
    }
    return blob
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ViewPicker({
  settings,
  update,
  note,
  setNote,
  busy,
  uploadPhoto,
  removePhoto,
  onClose,
}: ReturnType<typeof useViewSettings> & { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const tile = 'relative aspect-[16/10] overflow-hidden rounded-lg border-2 text-left text-xs'

  async function applyPhoto(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) {
      setNote('Choose an image file (JPG or PNG).')
      return
    }
    await uploadPhoto(file)
  }

  return (
    <div role="dialog" aria-label="Your view" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-white/60 bg-white/90 p-4 text-sm shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-medium">Your view</span>
        <button type="button" onClick={onClose} className="text-zinc-600 underline">Done</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          onClick={() => update({ scene: 'ember' })}
          aria-pressed={settings.scene === 'ember'}
          className={`${tile} bg-cover bg-center ${settings.scene === 'ember' ? 'border-orange-500' : 'border-transparent'}`}
          style={{ backgroundImage: `url("${EMBER_SCENE}")` }}
        >
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 px-2 py-1 text-white">Ember</span>
        </button>
        {(['dusk', 'mist'] as const).map((scene) => (
          <button
            key={scene}
            type="button"
            onClick={() => update({ scene })}
            aria-pressed={settings.scene === scene}
            className={`${tile} ${settings.scene === scene ? 'border-orange-500' : 'border-transparent'}`}
            style={{ backgroundImage: SCENES[scene] }}
          >
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 px-2 py-1 text-white">
              {scene === 'dusk' ? 'Garden at dusk' : 'Morning mist'}
            </span>
          </button>
        ))}
        <button
          type="button"
          onClick={() => update({ scene: 'plain' })}
          aria-pressed={settings.scene === 'plain'}
          className={`${tile} bg-zinc-100 ${settings.scene === 'plain' ? 'border-orange-500' : 'border-transparent'}`}
        >
          <span className="absolute bottom-1 left-2 text-zinc-700">Plain</span>
        </button>
        <button
          type="button"
          onClick={() => (settings.photo && settings.scene !== 'photo' ? update({ scene: 'photo' }) : fileRef.current?.click())}
          aria-pressed={settings.scene === 'photo'}
          className={`${tile} border-dashed bg-zinc-50 bg-cover bg-center ${settings.scene === 'photo' ? 'border-orange-500' : 'border-zinc-300'}`}
          style={settings.photo ? { backgroundImage: `url("${settings.photo}")` } : undefined}
        >
          <span className={`absolute inset-x-0 bottom-0 px-2 py-1 ${settings.photo ? 'bg-gradient-to-t from-black/60 text-white' : 'text-zinc-700'}`}>
            {settings.photo ? 'Your photo' : 'Your photo…'}
          </span>
        </button>
      </div>
      {settings.photo && (
        <div className="flex gap-3 text-xs text-zinc-600">
          <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="underline disabled:opacity-50">
            Choose a different photo
          </button>
          <button type="button" disabled={busy} onClick={() => void removePhoto()} className="underline disabled:opacity-50">
            Remove photo
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          void applyPhoto(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <label className="block text-zinc-600">
        Dim the view <span className="float-right tabular-nums">{settings.dim}%</span>
        <input type="range" min={0} max={70} value={settings.dim} onChange={(e) => update({ dim: Number(e.target.value) })} className="mt-1 w-full accent-orange-500" />
      </label>
      <label className="block text-zinc-600">
        Soften <span className="float-right tabular-nums">{settings.soften}</span>
        <input type="range" min={0} max={16} value={settings.soften} onChange={(e) => update({ soften: Number(e.target.value) })} className="mt-1 w-full accent-orange-500" />
      </label>
      <p className="text-xs text-zinc-500">{note ?? 'Your view is saved with your account. Your photo is private to you.'}</p>
    </div>
  )
}
