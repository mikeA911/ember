import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { SectionHero } from '@/components/SectionHero'
import { ShowcaseJourney } from '@/components/public/ShowcaseJourney'

export default async function Home() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) redirect('/dashboard')

  return (
    <div className="flex flex-col gap-10">
      <SectionHero image="/images/sections/kb-sandbox.png" title="Ember" height="large" priority />

      <div className="flex flex-col gap-4 text-center">
        <p className="mx-auto max-w-xl text-zinc-600">
          The governed enterprise AI Workbench: organize trusted knowledge, apply it to real business work, connect safely to
          live systems, and let regional builders extend it with evidence-backed tools and agents.
        </p>
        <div className="mx-auto flex gap-3">
          <Link href="/examples" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            Explore Examples
          </Link>
          <Link href="/about" className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium">
            Learn How It Works
          </Link>
          <Link href="/login" className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium">
            Sign In
          </Link>
        </div>
      </div>

      <ShowcaseJourney />

      <div className="flex flex-col items-center gap-3 rounded-3xl border border-zinc-200 bg-white p-6 text-center sm:p-10">
        <p className="text-sm text-zinc-600">Ready to see the complete published catalogue, or how KB Sandbox actually works?</p>
        <div className="flex gap-3">
          <Link href="/examples" className="rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white">
            Browse all Examples
          </Link>
          <Link href="/about" className="rounded border border-zinc-300 px-4 py-2 text-sm font-medium">
            About KB Sandbox
          </Link>
        </div>
      </div>
    </div>
  )
}
