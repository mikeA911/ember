import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Shipped default -- used until an admin uploads a custom icon via the
// Branding admin tab (setArticlePublicAction's sibling, updateBrandingIconAction
// in src/app/actions/branding.ts). A fresh clone/deploy with no `branding` row
// in `settings` still works with zero configuration.
export const LOGO_PATH = '/images/logo2.png'

const BRANDING_BUCKET = 'branding'

export interface BrandingConfig {
  sourcePath: string
  icon192Path: string
  icon512Path: string
  appleTouchIconPath: string
  updatedAt: string
}

export interface BrandingUrls {
  logo: string
  icon192: string
  icon512: string
  appleTouchIcon: string
}

const DEFAULT_BRANDING_URLS: BrandingUrls = {
  logo: LOGO_PATH,
  icon192: LOGO_PATH,
  icon512: LOGO_PATH,
  appleTouchIcon: LOGO_PATH,
}

// Reads the admin-configured icon set from settings.branding, falling back
// to the shipped default when nothing's been uploaded yet. Storage PATHS are
// stored (not full URLs) so this survives a Supabase project URL change --
// public URLs are derived here at read time via getPublicUrl (a pure string
// construction, no network call).
export async function getBrandingUrls(supabase: SupabaseClient<Database>): Promise<BrandingUrls> {
  const { data, error } = await supabase.from('settings').select('value').eq('key', 'branding').maybeSingle()
  if (error || !data?.value) return DEFAULT_BRANDING_URLS

  const config = data.value as BrandingConfig
  const urlFor = (path: string) => supabase.storage.from(BRANDING_BUCKET).getPublicUrl(path).data.publicUrl

  return {
    logo: urlFor(config.sourcePath),
    icon192: urlFor(config.icon192Path),
    icon512: urlFor(config.icon512Path),
    appleTouchIcon: urlFor(config.appleTouchIconPath),
  }
}

export class IconValidationError extends Error {}

const MAX_ICON_SIZE = 5 * 1024 * 1024
const ALLOWED_ICON_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']

// Server-side gate on the uploaded icon -- the file input's `accept`
// attribute is a UX hint only, never a security boundary.
export function validateIconFile(file: File): void {
  if (file.size === 0) throw new IconValidationError('No file provided')
  if (file.size > MAX_ICON_SIZE) throw new IconValidationError(`File exceeds ${MAX_ICON_SIZE / 1024 / 1024}MB limit`)
  if (!ALLOWED_ICON_MIME_TYPES.includes(file.type)) throw new IconValidationError(`Unsupported file type: ${file.type}`)
}
