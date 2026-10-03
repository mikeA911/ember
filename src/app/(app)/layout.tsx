import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/server'
import { Header } from '@/components/Header'
import { getBrandingUrls } from '@/lib/branding'
import { ChatPanel } from '@/components/chat/ChatPanel'
import { NavigationOverlay } from '@/components/shared/NavigationOverlay'
import { listMemberProjectOptions } from '@/lib/projects/queries'
import { env } from '@/lib/env'
import type { Profile } from '@/types/database'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
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

  // Backs the floating widget's header project picker (ChatPanel.tsx) --
  // same "own active memberships only" scope already used by EmberHome.
  const projects = await listMemberProjectOptions(supabase, user.id)

  return (
    <div className="flex flex-1 flex-col">
      <Header profile={profile as Profile} logoUrl={brandingUrls.logo} productMode={env.productMode()} />
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 py-8">{children}</main>
      {/* ChatPanel reads useSearchParams() (to detect ?view=ember) -- Next
          requires a Suspense boundary around any client component that does,
          so this doesn't de-opt the whole layout to client-only rendering. */}
      <Suspense fallback={null}>
        <ChatPanel projects={projects} role={(profile as Profile).role} productMode={env.productMode()} />
      </Suspense>
      {/* Instant ember loading screen on link click -- reads
          useSearchParams(), so it needs its own Suspense boundary too. */}
      <Suspense fallback={null}>
        <NavigationOverlay />
      </Suspense>
    </div>
  )
}
