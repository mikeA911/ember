import type { MetadataRoute } from 'next'
import { env } from '@/lib/env'
import { PUBLIC_EXAMPLES_ENABLED } from '@/lib/showcases/public-examples'

// Allow-list approach, not a deny-list: everything is disallowed by
// default ("disallow: '/'"), then the handful of genuinely public routes
// are carved back out via "allow" entries. Per the robots.txt spec, the
// longest matching rule wins regardless of order, so a more specific
// "allow" always beats the blanket "disallow" for the paths it covers.
// This file deliberately never writes /admin, /contribute, /dashboard,
// /projects, /wiki (the authenticated app), etc. -- the dev request
// requires robots.txt not to advertise private route names, and an
// allow-list can express "only these are public" without ever naming
// what isn't.
export default function robots(): MetadataRoute.Robots {
  const siteUrl = env.siteUrl()
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
      allow: ['/$', '/about', '/blog', '/knowledge', ...(PUBLIC_EXAMPLES_ENABLED ? ['/examples'] : [])],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
