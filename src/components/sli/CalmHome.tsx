'use client'

import Link from 'next/link'
import { useEffect, useState, useSyncExternalStore } from 'react'
import { ChatSession, OPEN_FEEDBACK_EVENT } from '@/components/chat/ChatPanel'
import { ViewBackground, ViewPicker, useViewSettings } from './CalmView'
import { AccountLink } from './AccountLink'
import type { SavedView } from '@/lib/view-settings-shared'

// SLI Home as the calm greeting (docs/design-notes/ember-sli-calm-workspace.md
// §2): a greeting, a short note of what is waiting, a few gentle
// suggestions, and a general conversation with Ember, behind frosted
// glass over the person's view. No counters or alerts; the lists live in
// My work.

export type HomeNote = { text: string; href: string }

const RAISE_PROMPT =
  'I’d like to raise a Trigger. Ask me one question at a time about what happened and why it might matter, then propose the Trigger for me to confirm.'
const FIND_PROMPT = 'Help me find a company in our registry. Ask me what I’m looking for first.'
const THINK_PROMPT =
  'I want to think something through. Ask me one question at a time and collect my thoughts as short notes. Don’t judge or critique anything yet.'

function subscribeClock(onChange: () => void) {
  const t = setInterval(onChange, 60_000)
  return () => clearInterval(t)
}
function greetingNow(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

export function CalmHome({
  firstName,
  userName,
  productName,
  organizationName,
  notes,
  moreWaiting,
  suggestions,
  canRaise,
  savedView,
}: {
  firstName: string | null
  userName: string | null
  productName: string
  organizationName: string
  notes: HomeNote[]
  moreWaiting: number
  suggestions: HomeNote[]
  canRaise: boolean
  savedView: SavedView | null
}) {
  const view = useViewSettings(savedView)
  const [showView, setShowView] = useState(false)
  // Hidden, not unmounted: the conversation is still there when it comes back.
  const [hidden, setHidden] = useState(false)
  const greeting = useSyncExternalStore(subscribeClock, greetingNow, () => 'Hello')

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setShowView(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const chips = [
    ...(canRaise ? [{ label: 'Raise a Trigger', prompt: RAISE_PROMPT, title: 'Ember asks, you confirm' }] : []),
    { label: 'Find a company', prompt: FIND_PROMPT },
    { label: 'Think it through', prompt: THINK_PROMPT, title: 'Collect ideas without judging them' },
  ]

  const glass = 'border border-white/60 bg-white/75 shadow-sm backdrop-blur-xl backdrop-saturate-150'
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden text-zinc-900">
      <ViewBackground settings={view.settings} />

      <header className={`relative z-10 m-3 mb-0 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2 ${glass}`}>
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_6px_rgba(249,115,22,0.18)] motion-safe:animate-pulse" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">{productName}</p>
            <p className="text-xs text-zinc-500">{organizationName}</p>
          </div>
        </div>
        <nav aria-label="SLI" className="flex flex-wrap items-center gap-1 text-sm">
          <Link href="/sli/my-work" className="rounded-full px-3 py-1 hover:bg-white">My work</Link>
          <Link href="/sli/discovery" className="rounded-full px-3 py-1 hover:bg-white">Discovery</Link>
          <Link href="/sli/customers" className="rounded-full px-3 py-1 hover:bg-white">Customers</Link>
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-zinc-300" />
          <button type="button" onClick={() => setHidden((h) => !h)} aria-pressed={hidden} className="rounded-full px-3 py-1 hover:bg-white">
            {hidden ? 'Show conversation' : 'Hide conversation'}
          </button>
          <button
            type="button"
            onClick={() => {
              setHidden(false)
              window.dispatchEvent(new Event(OPEN_FEEDBACK_EVENT))
            }}
            title="Report a problem or suggest an improvement"
            className="rounded-full px-3 py-1 hover:bg-white"
          >
            Feedback
          </button>
          <button type="button" onClick={() => setShowView((v) => !v)} aria-expanded={showView} className="rounded-full px-3 py-1 hover:bg-white">
            View
          </button>
          <AccountLink name={userName} />
        </nav>
      </header>

      {showView && (
        <div className="absolute right-3 top-20 z-30">
          <ViewPicker {...view} onClose={() => setShowView(false)} />
        </div>
      )}


      {hidden && (
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="absolute bottom-6 left-1/2 z-20 -translate-x-1/2 rounded-full border border-white/60 bg-white/80 px-4 py-2 text-sm shadow-lg backdrop-blur hover:bg-white"
        >
          Show conversation
        </button>
      )}
      <div className={`relative z-10 flex min-h-0 flex-1 justify-center p-3 ${hidden ? 'hidden' : ''}`}>
        <div className={`flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl ${glass}`}>
          <div className="border-b border-white/60 px-5 py-4">
            <h1 className="font-serif text-2xl text-zinc-900">
              {greeting}
              {firstName ? `, ${firstName}` : ''}.
            </h1>
            {notes.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-sm text-zinc-700">
                {notes.map((n) => (
                  <li key={n.href + n.text}>
                    <Link href={n.href} className="hover:underline">{n.text}</Link>
                  </li>
                ))}
                {moreWaiting > 0 && (
                  <li>
                    <Link href="/sli/my-work" className="text-zinc-500 hover:underline">
                      and {moreWaiting} more in My work
                    </Link>
                  </li>
                )}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-zinc-600">Nothing is waiting for you. What’s on your mind?</p>
            )}
            {suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 text-xs">
                {suggestions.map((s) => (
                  <Link key={s.href} href={s.href} className="rounded-full border border-zinc-300/80 bg-white/70 px-3 py-1 text-zinc-700 hover:bg-white">
                    {s.text}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <ChatSession
            projects={[]}
            onSelectProject={() => {}}
            className="flex min-h-0 w-full flex-1 flex-col bg-transparent"
            promptChips={chips}
          />
        </div>
      </div>
    </div>
  )
}
