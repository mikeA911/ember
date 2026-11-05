'use server'

import { z } from 'zod'
import { requireUser } from '@/lib/auth'
import { VIEW_PHOTOS_BUCKET, photoUrl, viewRpc } from '@/lib/view-settings'

// Saves the calm workspace's view with the person's account
// (supabase/migrations/20261112100001_view_settings.sql). The photo itself
// is uploaded by the browser straight into the person's own folder of the
// private view-photos bucket; these only record or forget it.

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

const SettingsSchema = z.object({
  scene: z.enum(['ember', 'dusk', 'mist', 'plain', 'photo']),
  dim: z.number().int().min(0).max(70),
  soften: z.number().int().min(0).max(16),
})

export async function saveViewSettingsAction(input: z.input<typeof SettingsSchema>): Promise<Result> {
  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: 'That view couldn’t be saved.' }
  try {
    const { supabase } = await requireUser()
    await viewRpc(supabase, 'view_settings_save', { p_scene: parsed.data.scene, p_dim: parsed.data.dim, p_soften: parsed.data.soften })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'The view couldn’t be saved.' }
  }
}

// path: what the browser just uploaded (under the person's own folder), or
// null to forget the photo. The previous photo is deleted from storage.
export async function setViewPhotoAction(path: string | null): Promise<Result<{ photoUrl: string | null }>> {
  if (path !== null && !/^[0-9a-f-]{36}\/[\w.-]+\.jpg$/.test(path)) return { ok: false, error: 'That photo couldn’t be saved.' }
  try {
    const { supabase, user } = await requireUser()
    if (path !== null && !path.startsWith(`${user.id}/`)) return { ok: false, error: 'That photo couldn’t be saved.' }
    const old = await viewRpc<string | null>(supabase, 'view_settings_set_photo', { p_path: path })
    if (old) await supabase.storage.from(VIEW_PHOTOS_BUCKET).remove([old])
    return { ok: true, photoUrl: await photoUrl(supabase, path) }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'That photo couldn’t be saved.' }
  }
}
