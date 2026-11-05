import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import type { SavedView, ViewScene } from '@/lib/view-settings-shared'

// The person's saved view (supabase/migrations/20261112100001_view_settings.sql)
// and a short-lived link to their photo in the private view-photos bucket.
type Client = Awaited<ReturnType<typeof createClient>>

export const VIEW_PHOTOS_BUCKET = 'view-photos'
// Long enough for a working day in the workspace without the picture
// disappearing; a page load always makes a fresh one.
const PHOTO_URL_SECONDS = 60 * 60 * 12

type Row = { scene: ViewScene; dim: number; soften: number; photoPath: string | null }

export async function viewRpc<T>(supabase: Client, fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await (supabase.rpc as unknown as (f: string, a: Record<string, unknown>) => Promise<{ data: unknown; error: { code?: string; message?: string } | null }>)(fn, args)
  if (error) throw new Error(error.code === 'EC101' && error.message ? error.message : 'The view couldn’t be saved. Try again.')
  return data as T
}

export async function photoUrl(supabase: Client, path: string | null): Promise<string | null> {
  if (!path) return null
  const { data } = await supabase.storage.from(VIEW_PHOTOS_BUCKET).createSignedUrl(path, PHOTO_URL_SECONDS)
  return data?.signedUrl ?? null
}

// Null when nothing is saved yet (the default view), or when reading fails:
// the workspace still works with the default.
export async function loadSavedView(supabase: Client): Promise<SavedView | null> {
  try {
    const row = await viewRpc<Row | null>(supabase, 'view_settings_get')
    if (!row) return null
    const url = await photoUrl(supabase, row.photoPath)
    return { scene: row.scene === 'photo' && !url ? 'ember' : row.scene, dim: row.dim, soften: row.soften, photoUrl: url }
  } catch (err) {
    console.error('Could not read the saved view', err)
    return null
  }
}
