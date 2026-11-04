import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getBrandingUrls } from '@/lib/branding'
import { SliHeader } from '@/components/sli/SliHeader'
import { getSliContext } from '@/lib/sli/api'
import { sliEnabled } from '@/lib/sli/flag'
import type { Profile } from '@/types/database'

// The SLI shell (docs/dev-request-sandz-sli-discovery-and-triggers.md §3).
// Members of an SLI organisation, and platform admins, see SLI screens in
// the organisation's own name; everyone else goes back to Ember. Off
// entirely unless EMBER_SLI_ENABLED=true. Pages still check access through
// the SLI database functions -- this layout only routes.
export default async function SliLayout({ children }: { children: React.ReactNode }) {
  if (!sliEnabled()) notFound()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const [{ data: profile }, brandingUrls] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user.id).single(),
    getBrandingUrls(supabase),
  ])
  if (!profile || !(profile as Profile).is_active) redirect('/login')

  const ctx = await getSliContext(supabase)
  if (!ctx || !(ctx.isMember || ctx.isPlatformAdmin)) redirect('/dashboard')

  const role = (profile as Profile).role
  return (
    <div className="flex flex-1 flex-col bg-zinc-50">
      <SliHeader
        productName={ctx.productName}
        byline={ctx.byline}
        logoUrl={brandingUrls.logo}
        showCoreLink={role === 'admin' || role === 'curator'}
      />
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-8">{children}</main>
    </div>
  )
}
