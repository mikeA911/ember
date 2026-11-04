'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { ChatSession } from '@/components/chat/ChatPanel'
import { ViewBackground, ViewPicker, useViewSettings } from './CalmView'

// The calm workspace for a Trigger (docs/design-notes/ember-sli-calm-workspace.md):
// one quiet conversation in the centre, mode chips instead of menus, and
// the work (the Trigger, saved research, candidates, the decision, the
// handoff) as artifacts that open beside it on request and step away
// again. Behind it, the person's chosen view.

export type WorkspacePanel = { key: string; label: string; content: ReactNode; attention?: boolean }

const BRAINSTORM_PROMPT =
  'Let’s brainstorm this Trigger together. Ask me one question at a time and collect my ideas as short notes, grouped into: the offer, who it is for, open questions, and feelings worth keeping. Don’t judge or critique the ideas yet. When I say "save the notes", save them as an artifact titled "Brainstorm notes" in the Research workstream.'

export function CalmWorkspace({
  code,
  title,
  stageLabel,
  productName,
  projectId,
  stagePrompt,
  fitCheckPrompt,
  taskChips = [],
  panels,
}: {
  code: string
  title: string
  stageLabel: string
  productName: string
  projectId: string | null
  // The stage's own task (the research Project's starter prompt).
  stagePrompt: string | null
  fitCheckPrompt: string
  // What Ember can propose here for the person to confirm (Recommend,
  // Find candidates), when they may.
  taskChips?: { label: string; prompt: string; title?: string }[]
  panels: WorkspacePanel[]
}) {
  const router = useRouter()
  const view = useViewSettings()
  const [showView, setShowView] = useState(false)
  // Hidden, not unmounted: the conversation is still there when it comes back.
  const [hidden, setHidden] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const active = panels.find((p) => p.key === open) ?? null

  // Reload the artifacts when one opens, so what Ember saved in the
  // conversation shows up.
  useEffect(() => {
    if (open) router.refresh()
  }, [open, router])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      if (showView) setShowView(false)
      else setOpen(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [showView])

  const chips = [
    { label: 'Brainstorm', prompt: BRAINSTORM_PROMPT, title: 'Collect ideas without judging them' },
    { label: 'Test it', prompt: fitCheckPrompt, title: 'Run the fit check' },
    ...(stagePrompt && stagePrompt !== fitCheckPrompt
      ? [{ label: stagePrompt.startsWith('Draft the feasibility') ? 'Draft the feasibility assessment' : 'Draft the concept paper', prompt: stagePrompt }]
      : []),
    ...taskChips,
  ]

  const glass = 'border border-white/60 bg-white/75 shadow-sm backdrop-blur-xl backdrop-saturate-150'
  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-hidden text-zinc-900">
      <ViewBackground settings={view.settings} />

      <header
        className={`relative z-10 m-3 mb-0 flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2 ${glass}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden="true" className="h-3 w-3 shrink-0 rounded-full bg-orange-500 shadow-[0_0_0_6px_rgba(249,115,22,0.18)]" />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-sm font-medium">
              <span className="font-mono text-xs text-zinc-500">{code}</span> {title}
            </p>
            <p className="text-xs text-zinc-500">
              {productName} · {stageLabel}
            </p>
          </div>
        </div>
        <nav aria-label="Artifacts" className="flex flex-wrap items-center gap-1 text-sm">
          {panels.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => {
                setHidden(false)
                setOpen(open === p.key ? null : p.key)
              }}
              aria-pressed={open === p.key}
              className={`rounded-full px-3 py-1 ${open === p.key ? 'bg-zinc-900 text-white' : 'hover:bg-white'}`}
            >
              {p.label}
              {p.attention && <span aria-label="needs attention" className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-orange-500 align-middle" />}
            </button>
          ))}
          <span aria-hidden="true" className="mx-1 h-4 w-px bg-zinc-300" />
          <button type="button" onClick={() => setHidden((h) => !h)} aria-pressed={hidden} className="rounded-full px-3 py-1 hover:bg-white">
            {hidden ? 'Show conversation' : 'Hide conversation'}
          </button>
          <button type="button" onClick={() => setShowView((v) => !v)} aria-expanded={showView} className="rounded-full px-3 py-1 hover:bg-white">
            View
          </button>
          <Link href={`/sli/discovery/${code}`} className="rounded-full px-3 py-1 text-zinc-600 hover:bg-white">
            Classic page
          </Link>
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
      <div className={`relative z-10 flex min-h-0 flex-1 gap-3 p-3 ${hidden ? 'hidden' : ''}`}>
        <section className={`flex min-w-0 flex-1 justify-center ${active ? 'max-md:hidden' : ''}`}>
          <div className={`flex h-full w-full max-w-3xl flex-col overflow-hidden rounded-2xl ${glass}`}>
            {projectId ? (
              <ChatSession
                projectId={projectId}
                projects={[{ id: projectId, name: `${code} · ${title}` }]}
                onSelectProject={() => {}}
                currentPageProjectId={projectId}
                className="flex h-full w-full flex-col bg-transparent"
                promptChips={chips}
              />
            ) : (
              <div className="m-auto max-w-sm p-6 text-center text-sm text-zinc-600">
                The conversation opens when a Discovery sponsor accepts this Trigger into research.
              </div>
            )}
          </div>
        </section>

        {active && (
          <aside
            aria-label={active.label}
            className={`flex w-full flex-col overflow-hidden rounded-2xl md:w-[30rem] md:shrink-0 ${glass}`}
          >
            <div className="flex items-center justify-between border-b border-zinc-200/70 px-4 py-2">
              <span className="text-sm font-medium">{active.label}</span>
              <button type="button" onClick={() => setOpen(null)} className="text-sm text-zinc-600 underline">
                Close
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">{active.content}</div>
          </aside>
        )}
      </div>
    </div>
  )
}
