'use client'

import Link from 'next/link'
import type { VerifiedAssistantEnvelope } from '@/lib/chat/response-envelope'

// Small presentational pieces rendered around the existing Markdown call in
// ChatPanel.tsx, matching its zinc/Tailwind palette. Old rows with no
// structured payload never reach these -- every export here is `&&`-gated
// by its own non-empty array/value at the call site, so a plain-text
// historical message renders exactly as before this feature existed.

export function QuickSummary({ quickSummary, message }: { quickSummary?: string; message: string }) {
  if (!quickSummary) return null
  // Skip when it's near-identical to the message, or the message is
  // already short enough that a summary adds nothing.
  if (message.length < 80 || quickSummary.trim() === message.trim()) return null
  return <div className="mb-1.5 rounded border border-zinc-200 bg-zinc-50 px-2 py-1.5 text-sm font-medium text-zinc-800">{quickSummary}</div>
}

const REQUIREMENT_GLYPH: Record<string, string> = {
  available: '●',
  needed: '○',
  optional: '◌',
  can_be_produced_elsewhere: '◐',
  unknown: '?',
}

export function RequirementsList({ requirements }: { requirements?: NonNullable<VerifiedAssistantEnvelope['requirements']> }) {
  if (!requirements?.length) return null
  return (
    <div className="mt-1.5">
      <p className="text-xs font-medium text-zinc-500">Requirements</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {requirements.map((r) => (
          <li key={r.label} className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-xs">
            <span className="text-zinc-700">{r.label}</span>
            <span className="shrink-0 text-zinc-500">
              {REQUIREMENT_GLYPH[r.status] ?? '?'} {r.status.replace(/_/g, ' ')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

const NEXT_STEP_GLYPH: Record<string, string> = {
  suggested: '○',
  ready: '●',
  blocked: '■',
  completed: '✓',
}

export function NextStepsList({ nextSteps }: { nextSteps?: NonNullable<VerifiedAssistantEnvelope['nextSteps']> }) {
  if (!nextSteps?.length) return null
  return (
    <div className="mt-1.5">
      <p className="text-xs font-medium text-zinc-500">Next steps</p>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {nextSteps.map((s) => (
          <li key={s.label} className="flex items-center justify-between gap-2 rounded border border-zinc-200 bg-white px-2 py-1 text-xs">
            <span className="text-zinc-700">{s.label}</span>
            <span className="shrink-0 text-zinc-500">
              {NEXT_STEP_GLYPH[s.status] ?? '?'} {s.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// These are trusted, server-resolved routes (see navigation-resolver.ts) --
// deliberately real <Link> elements, not routed through Markdown's generic
// `a` renderer, since a link here was never model-authored text.
export function LinksList({ links }: { links?: NonNullable<VerifiedAssistantEnvelope['links']> }) {
  if (!links?.length) return null
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {links.map((link) => (
        <Link key={link.route} href={link.route} className="text-xs text-blue-700 underline hover:text-blue-900">
          {link.label} →
        </Link>
      ))}
    </div>
  )
}

export function DocumentsList({ documents }: { documents?: NonNullable<VerifiedAssistantEnvelope['documents']> }) {
  if (!documents?.length) return null
  return (
    <div className="mt-1.5">
      <p className="text-xs font-medium text-zinc-500">Documents</p>
      <ul className="mt-0.5 flex flex-col gap-1">
        {documents.map((doc) => (
          <li key={doc.artifactId} className="rounded border border-zinc-200 bg-white px-2 py-1 text-xs">
            <p className="font-medium text-zinc-800">{doc.title}</p>
            <p className="text-zinc-500">{doc.documentType.replace(/_/g, ' ')}</p>
            {doc.route ? (
              <Link href={doc.route} className="text-blue-700 underline hover:text-blue-900">
                Open →
              </Link>
            ) : (
              <span className="text-zinc-400">Not directly viewable</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

// layer/stale are computed server-side from this turn's real retrieval and
// (for stale) re-checked on every display -- see envelope-resolution.ts.
// Never derived here from anything model-authored.
const LAYER_LABEL: Record<'project' | 'platform', string> = {
  project: 'Project evidence',
  platform: 'Platform guidance',
}

// Working Knowledge & Research Notebooks Stage 1+2: a distinct code path,
// not a value threaded into LAYER_LABEL, so a working-knowledge citation can
// never accidentally render the approved-evidence badge -- checked first in
// the badge lookup below, before layer is even consulted. Combines the dev
// request's three named labels ("Working research" / "Private working
// note" / "Project-shared research") with the one combination it doesn't
// explicitly name (a shared plain note) by the same pattern.
function workingKnowledgeBadgeLabel(type?: 'research_notebook' | 'working_note', visibility?: 'private' | 'shared_selected' | 'shared_project'): string {
  const isNote = type === 'working_note'
  if (visibility === 'private' || !visibility) return isNote ? 'Private working note' : 'Working research'
  return isNote ? 'Project-shared note' : 'Project-shared research'
}

export function CitationsList({ citations }: { citations?: NonNullable<VerifiedAssistantEnvelope['citations']> }) {
  if (!citations?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1 text-xs text-zinc-500">
      <span>Sources:</span>
      {citations.map((c, i) => (
        <span key={c.sourceId}>
          <Link href={c.route} className="text-blue-700 underline hover:text-blue-900">
            {c.label}
          </Link>
          {c.sourceType === 'working_knowledge' ? (
            <span className="ml-1 rounded-full border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">
              {workingKnowledgeBadgeLabel(c.workingKnowledgeType, c.workingKnowledgeVisibility)}
            </span>
          ) : c.layer ? (
            <span className="ml-1 rounded-full border border-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-500">{LAYER_LABEL[c.layer]}</span>
          ) : null}
          {c.stale ? (
            <span className="ml-1 text-amber-600" title="Source updated since this citation">
              ⚠ updated since cited
            </span>
          ) : null}
          {i < citations.length - 1 ? ',' : ''}
        </span>
      ))}
    </div>
  )
}

// Compact "Knowledge used" disclosure (docs/dev-request-project-scoped-
// working-knowledge-and-research-notebooks.md's trust-presentation
// section) -- computed purely client-side from citations already flowing
// through (no schema change needed for the summary itself). webResultCount
// is a sibling prop since web results are deliberately never citable (see
// loop.ts's search_web guidance) and so have no citation entries to count.
export function KnowledgeUsedSummary({
  citations,
  webResultCount,
}: {
  citations?: NonNullable<VerifiedAssistantEnvelope['citations']>
  webResultCount?: number
}) {
  const approvedCount = citations?.filter((c) => c.sourceType === 'wiki_article' || c.sourceType === 'knowledge_source').length ?? 0
  const workingCount = citations?.filter((c) => c.sourceType === 'working_knowledge').length ?? 0
  if (approvedCount === 0 && workingCount === 0 && !webResultCount) return null

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">
      <span className="font-medium text-zinc-600">Knowledge used</span>
      {approvedCount > 0 && <span>Approved {approvedCount}</span>}
      {workingCount > 0 && <span className="text-amber-700">Working {workingCount}</span>}
      {!!webResultCount && <span>Web {webResultCount}</span>}
    </div>
  )
}

// Exactly what left Ember for Tavily while producing this reply (search_web,
// src/lib/chat/web-search-tool.ts). Always visible, not tucked into Details:
// web search is outside the information-sensitivity gate, so the user is
// the check on what the model put in a query.
export function WebSearchQueries({ queries }: { queries?: string[] }) {
  if (!queries?.length) return null
  return (
    <div className="mt-1.5 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">
      <span className="font-medium text-zinc-600">Searched the web for</span>
      <ul className="mt-0.5 flex flex-col gap-0.5">
        {queries.map((q, i) => (
          <li key={i} className="break-words">
            “{q}”
          </li>
        ))}
      </ul>
    </div>
  )
}

export function SuggestedPrompts({ prompts, onSelect }: { prompts?: string[]; onSelect: (prompt: string) => void }) {
  if (!prompts?.length) return null
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {prompts.map((prompt) => (
        <button
          key={prompt}
          type="button"
          onClick={() => onSelect(prompt)}
          className="rounded-full border border-zinc-300 px-2.5 py-1 text-xs text-zinc-600 hover:bg-zinc-50"
        >
          {prompt}
        </button>
      ))}
    </div>
  )
}
