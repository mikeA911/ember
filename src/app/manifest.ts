import type { MetadataRoute } from 'next'
import { createClient } from '@/lib/supabase/server'
import { getBrandingUrls } from '@/lib/branding'

// Async so this reads the admin-configured icon set from Supabase rather
// than a static file -- see src/lib/branding.ts. start_url is '/', not
// '/dashboard', to match the existing smart redirect in
// src/app/(public)/page.tsx (a logged-in visitor lands on '/' and bounces
// to the Workbench automatically).
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const supabase = await createClient()
  const urls = await getBrandingUrls(supabase)

  return {
    name: 'Ember',
    short_name: 'Ember',
    description: 'AI engineering workbench: curate knowledge, build with it, evaluate the result, keep a human in the loop.',
    start_url: '/',
    display: 'standalone',
    background_color: '#fafafa',
    theme_color: '#18181b',
    // No explicit `type` here -- the configured icons are always PNG, but the
    // shipped default (LOGO_PATH) isn't guaranteed to be, so a hardcoded type
    // could be wrong for whichever case doesn't match. Browsers use the real
    // Content-Type response header instead.
    icons: [
      { src: urls.icon192, sizes: '192x192' },
      { src: urls.icon512, sizes: '512x512' },
      { src: urls.icon512, sizes: '512x512', purpose: 'maskable' },
    ],
  }
}
