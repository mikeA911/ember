'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { addSlideCommentAction, replyToCommentAction, classifyPendingCommentsAction } from '@/app/actions/presentations'
import { BusyOverlay } from '@/components/shared/BusyOverlay'
import { Markdown } from '@/components/shared/Markdown'
import { OntologyMapDiagram } from '@/components/projects/OntologyMapDiagram'
import type { OntologyMapLayout } from '@/lib/projects/ontology-map'
import type { PresentationSlide, PresentationSlideComment, SlideCommentClassification } from '@/types/database'

const CLASSIFICATION_LABELS: Record<SlideCommentClassification, string> = {
  question: 'Question',
  evaluation_candidate: 'Evaluation candidate',
  action: 'Action',
  security_review: 'Security review',
  requirement_gap: 'Requirement gap',
  approval_signal: 'Approval signal',
  scope_change: 'Scope change',
  risk_concern: 'Risk / concern',
  customer_requirement: 'Customer requirement',
}

// Workstream Presentation & Review, Part A. Slide navigation is plain
// React state + a keydown listener -- no diagramming/carousel library
// exists in this codebase (AssistantFlow.tsx's own precedent) and a
// left/right slide deck doesn't need one. Comments are scoped to
// `slides[currentIndex].id`, the same polymorphic slide_id convention the
// migration itself documents.
export function PresentationViewer({
  projectId,
  projectName,
  workstreamId,
  versionId,
  slides,
  diagramLayoutBySlideId,
  comments,
  authorEmailById,
  canComment,
  canReply,
  canProcessFeedback,
}: {
  projectId: string
  projectName: string
  workstreamId: string
  versionId: string
  slides: PresentationSlide[]
  // computeOntologyMapLayout's module is server-only -- the page (a Server
  // Component) computes each diagram_ref slide's layout up front and passes
  // the plain result in, rather than this client component importing that
  // function itself.
  diagramLayoutBySlideId: Record<string, OntologyMapLayout>
  comments: PresentationSlideComment[]
  authorEmailById: Record<string, string>
  canComment: boolean
  canReply: boolean
  canProcessFeedback: boolean
}) {
  const router = useRouter()
  const [index, setIndex] = useState(0)
  const [isPending, startTransition] = useTransition()
  const [processingFeedback, setProcessingFeedback] = useState(false)
  const [newComment, setNewComment] = useState('')
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)

  const slide = slides[index]
  const slideComments = comments.filter((c) => c.slide_id === slide?.id)
  const unclassifiedCount = comments.filter((c) => !c.classification).length

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'ArrowRight') setIndex((i) => Math.min(i + 1, slides.length - 1))
      if (e.key === 'ArrowLeft') setIndex((i) => Math.max(i - 1, 0))
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [slides.length])

  function handleAddComment() {
    if (!newComment.trim() || !slide) return
    setError(null)
    startTransition(async () => {
      try {
        await addSlideCommentAction(projectId, workstreamId, versionId, slide.id, newComment.trim())
        setNewComment('')
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add comment')
      }
    })
  }

  function handleReply(commentId: string) {
    const text = replyDrafts[commentId]?.trim()
    if (!text) return
    setError(null)
    startTransition(async () => {
      try {
        await replyToCommentAction(projectId, workstreamId, commentId, text)
        setReplyDrafts((prev) => ({ ...prev, [commentId]: '' }))
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to reply')
      }
    })
  }

  function handleProcessFeedback() {
    setError(null)
    setProcessingFeedback(true)
    startTransition(async () => {
      try {
        await classifyPendingCommentsAction(projectId, workstreamId, versionId)
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process feedback')
      } finally {
        setProcessingFeedback(false)
      }
    })
  }

  if (!slide) return <p className="text-sm text-zinc-500">This presentation has no slides.</p>

  return (
    <div className="flex flex-col gap-4 sm:flex-row">
      <BusyOverlay active={processingFeedback} message="Ember is sorting the review feedback…" />
      <nav className="flex shrink-0 flex-row gap-1.5 overflow-x-auto sm:w-48 sm:flex-col sm:overflow-visible">
        {slides.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setIndex(i)}
            aria-current={i === index}
            className={`shrink-0 rounded border px-2 py-1.5 text-left text-xs ${
              i === index ? 'border-zinc-900 bg-zinc-900 text-white' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
            }`}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </nav>

      <div className="flex flex-1 flex-col gap-4">
        <div className="rounded border border-zinc-200 bg-white p-6">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">{slide.title}</h2>
            <span className="text-xs text-zinc-400">
              Slide {index + 1} of {slides.length}
            </span>
          </div>
          {slide.type === 'diagram_ref' && diagramLayoutBySlideId[slide.id] ? (
            <OntologyMapDiagram layout={diagramLayoutBySlideId[slide.id]} projectId={projectId} projectName={projectName} />
          ) : (
            <>
              <Markdown text={slide.body} />
              {slide.items && slide.items.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-zinc-700">
                  {slide.items.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              )}
            </>
          )}
          <div className="mt-4 flex items-center justify-between">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={index === 0}
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                ← Previous
              </button>
              <button
                type="button"
                disabled={index === slides.length - 1}
                onClick={() => setIndex((i) => Math.min(i + 1, slides.length - 1))}
                className="rounded border border-zinc-300 px-2 py-1 text-xs disabled:opacity-40"
              >
                Next →
              </button>
            </div>
            {canProcessFeedback && unclassifiedCount > 0 && (
              <button
                type="button"
                disabled={isPending}
                onClick={handleProcessFeedback}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Process feedback ({unclassifiedCount})
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Comments on this slide</h3>
          {slideComments.length === 0 && <p className="text-sm text-zinc-500">No comments on this slide yet.</p>}
          {slideComments.map((c) => (
            <div key={c.id} className="flex flex-col gap-1 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
              <div className="flex items-center gap-2 text-xs text-zinc-500">
                <span className="font-medium text-zinc-700">{authorEmailById[c.author_id ?? ''] ?? 'Unknown'}</span>
                <span>{new Date(c.created_at).toLocaleString()}</span>
                {c.classification && (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-blue-700">{CLASSIFICATION_LABELS[c.classification]}</span>
                )}
              </div>
              <p className="text-sm text-zinc-800">{c.comment_text}</p>
              {c.builder_reply ? (
                <div className="ml-4 mt-1 rounded bg-zinc-50 p-2 text-sm">
                  <span className="text-xs font-medium text-zinc-500">Builder reply: </span>
                  {c.builder_reply}
                </div>
              ) : (
                canReply && (
                  <div className="ml-4 mt-1 flex gap-2">
                    <input
                      type="text"
                      value={replyDrafts[c.id] ?? ''}
                      onChange={(e) => setReplyDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))}
                      placeholder="Reply once to this comment…"
                      className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
                    />
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleReply(c.id)}
                      className="rounded border border-zinc-300 px-2 py-1 text-xs font-medium text-zinc-700 disabled:opacity-50"
                    >
                      Reply
                    </button>
                  </div>
                )
              )}
            </div>
          ))}

          {canComment && (
            <div className="flex gap-2 pt-2">
              <input
                type="text"
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Add a comment about this slide…"
                className="flex-1 rounded border border-zinc-300 px-2 py-1 text-sm"
              />
              <button
                type="button"
                disabled={isPending}
                onClick={handleAddComment}
                className="rounded bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                Comment
              </button>
            </div>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      </div>
    </div>
  )
}
