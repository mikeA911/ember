'use client'

import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react'

// The calm workspace's background view (docs/design-notes/ember-sli-calm-workspace.md §6):
// painted scenes, or the person's own photo, behind frosted glass, with
// dim and soften sliders. Kept on this device for now (localStorage); a
// photo is resized in the browser before it is kept.

export type ViewSettings = { scene: 'dusk' | 'mist' | 'plain' | 'photo'; photo: string | null; dim: number; soften: number }

const STORE = 'ember-sli-view'
const DEFAULTS: ViewSettings = { scene: 'dusk', photo: null, dim: 15, soften: 0 }

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

const CHANGED = 'ember-sli-view-changed'

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORE)
  } catch {
    return null
  }
}

function parse(raw: string | null): ViewSettings {
  try {
    const v = JSON.parse(raw || 'null')
    if (v && typeof v === 'object') return { ...DEFAULTS, ...v }
  } catch {
    // Unreadable: defaults.
  }
  return DEFAULTS
}

function subscribe(onChange: () => void) {
  window.addEventListener('storage', onChange)
  window.addEventListener(CHANGED, onChange)
  return () => {
    window.removeEventListener('storage', onChange)
    window.removeEventListener(CHANGED, onChange)
  }
}

// Saved settings come from localStorage through useSyncExternalStore (the
// server renders the default view). A photo too large to save is kept in
// memory for this visit instead.
export function useViewSettings() {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null)
  const [override, setOverride] = useState<ViewSettings | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const settings = useMemo(() => override ?? parse(raw), [override, raw])
  const update = useCallback(
    (next: Partial<ViewSettings>) => {
      const merged = { ...settings, ...next }
      try {
        localStorage.setItem(STORE, JSON.stringify(merged))
        setOverride(null)
        setNote(null)
        window.dispatchEvent(new Event(CHANGED))
      } catch {
        setOverride(merged)
        setNote('This photo is too large to remember on this device; it stays until you close the page.')
      }
    },
    [settings]
  )
  return { settings, update, note, setNote }
}

export function ViewBackground({ settings }: { settings: ViewSettings }) {
  const image =
    settings.scene === 'photo' && settings.photo ? `url("${settings.photo}")` : settings.scene === 'dusk' || settings.scene === 'mist' ? SCENES[settings.scene] : null
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

async function resizePhoto(file: File): Promise<string> {
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
    let quality = 0.85
    let data = canvas.toDataURL('image/jpeg', quality)
    while (data.length > 2_600_000 && quality > 0.45) {
      quality -= 0.1
      data = canvas.toDataURL('image/jpeg', quality)
    }
    return data
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function ViewPicker({
  settings,
  update,
  note,
  setNote,
  onClose,
}: ReturnType<typeof useViewSettings> & { onClose: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null)
  const tile = 'relative aspect-[16/10] overflow-hidden rounded-lg border-2 text-left text-xs'

  async function applyPhoto(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) {
      setNote('Choose an image file (JPG or PNG).')
      return
    }
    try {
      update({ scene: 'photo', photo: await resizePhoto(file) })
    } catch {
      setNote('That image couldn’t be opened. Try another one.')
    }
  }

  return (
    <div role="dialog" aria-label="Your view" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 rounded-xl border border-white/60 bg-white/90 p-4 text-sm shadow-xl backdrop-blur">
      <div className="flex items-center justify-between">
        <span className="font-medium">Your view</span>
        <button type="button" onClick={onClose} className="text-zinc-600 underline">Done</button>
      </div>
      <div className="grid grid-cols-2 gap-2">
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
        <button type="button" onClick={() => fileRef.current?.click()} className="text-xs text-zinc-600 underline">
          Choose a different photo
        </button>
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
      <p className="text-xs text-zinc-500">{note ?? 'Your view stays on this device only.'}</p>
    </div>
  )
}
