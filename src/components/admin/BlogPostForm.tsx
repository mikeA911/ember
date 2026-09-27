'use client'

import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { BlogPost } from '@/types/database'
import { Markdown } from '@/components/shared/Markdown'
import { applyToolbarAction, insertInlineImage, type ToolbarAction } from '@/lib/blog/editor-toolbar'
import { validateBlogPostFields, validateImageAltText, type BlogValidationErrors } from '@/lib/blog/validation'
import {
  createBlogPostAction,
  updateBlogPostAction,
  submitBlogPostForReviewAction,
  returnBlogPostToDraftAction,
  publishBlogPostAction,
  unpublishBlogPostAction,
  deleteBlogPostAction,
  uploadBlogCoverImageAction,
  uploadBlogInlineImageAction,
} from '@/app/actions/blog'
import { BlogRelatedPostsManager, BlogRelatedPostRemoveButton, type LinkableBlogPost } from '@/components/blog/BlogRelatedPostsManager'
import { SubstackExportPanel } from '@/components/blog/SubstackExportPanel'

function slugify(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

function emailFor(id: string | null, emailById: Map<string, string>): string {
  if (!id) return 'Ember editorial seed'
  return emailById.get(id) ?? id
}

type FieldSnapshot = { title: string; slug: string; excerpt: string; content: string }

const VALIDATION_BLOCKED_MESSAGE = 'Fix the highlighted fields before saving.'

const TOOLBAR_BUTTONS: { action: ToolbarAction; label: string; title: string }[] = [
  { action: 'heading', label: 'H', title: 'Heading' },
  { action: 'bold', label: 'B', title: 'Bold' },
  { action: 'italic', label: 'I', title: 'Italic' },
  { action: 'link', label: 'Link', title: 'Link' },
  { action: 'bulletList', label: '• List', title: 'Bulleted list' },
  { action: 'numberedList', label: '1. List', title: 'Numbered list' },
  { action: 'blockquote', label: 'Quote', title: 'Block quotation' },
]

// Same shape as PublishForm.tsx: local field state + a run() helper wrapping
// useTransition, window.confirm for destructive/publishing actions,
// router.refresh()/router.push() to reflect the result. viewerRole decides
// which actions render -- real enforcement is Server Actions + RLS (see
// updatePost/submitPostForReview in src/lib/blog/posts.ts), this only keeps
// the UI honest about what will actually be allowed.
//
// Stage 2 additions (docs/dev-request-blog-contributor-workflow-and-
// editorial-placeholders.md): Write/Preview tabs, a small formatting
// toolbar, a dirty-state indicator, and field validation. No full-page
// preview route -- that would need a non-guessable, non-indexed preview
// mechanism (tokened URL, noindex, etc.) to stay compatible with "never
// expose drafts through public routes," which is a bigger addition than
// this stage's scope; the in-editor Preview tab (reusing the exact public
// Markdown renderer and article wrapper) is the documented substitute.
export function BlogPostForm({
  post,
  viewerRole,
  emailById = new Map(),
  returnTo,
  coverImageUrl = null,
  relatedPosts = [],
  linkableCandidates = [],
  initialTitle,
  initialExcerpt,
  initialBody,
  importSummary,
}: {
  post?: BlogPost
  viewerRole: 'curator' | 'admin'
  emailById?: Map<string, string>
  // Deliberately required, not defaulted -- a silent '/admin' fallback
  // previously sent a freshly created admin post's redirect to
  // /admin/{id}/edit (404) instead of /admin/blog/{id}/edit, since nothing
  // forced every "new post" page to actually pass this. Making it required
  // means a wrong value is now a visible, deliberate choice at each call
  // site instead of a silent gap tsc can't catch.
  returnTo: string
  coverImageUrl?: string | null
  relatedPosts?: { relationId: string; post: { id: string; slug: string; title: string; status: string } }[]
  linkableCandidates?: LinkableBlogPost[]
  // Only meaningful for a brand-new (no `post`) draft, handed down from
  // BlogImportForm after a document conversion -- the contributor can
  // still edit every field before saving, per the dev request's "suggest
  // but do not silently commit."
  initialTitle?: string
  initialExcerpt?: string
  initialBody?: string
  importSummary?: {
    stats: { headings: number; links: number; listItems: number; tables: number }
    warnings: { message: string }[]
    imageCount: number
  }
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<BlogValidationErrors>({})
  const [activeTab, setActiveTab] = useState<'write' | 'preview'>('write')
  const contentRef = useRef<HTMLTextAreaElement>(null)

  const [coverAlt, setCoverAlt] = useState(post?.cover_image_alt ?? '')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverUploadPending, setCoverUploadPending] = useState(false)
  const [coverError, setCoverError] = useState<string | null>(null)

  const [showImagePanel, setShowImagePanel] = useState(false)
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageAlt, setImageAlt] = useState('')
  const [imageCaption, setImageCaption] = useState('')
  const [imageUploadPending, setImageUploadPending] = useState(false)
  const [imageError, setImageError] = useState<string | null>(null)

  const [title, setTitle] = useState(post?.title ?? initialTitle ?? '')
  const [slug, setSlug] = useState(post?.slug ?? '')
  const [excerpt, setExcerpt] = useState(post?.excerpt ?? initialExcerpt ?? '')
  const [content, setContent] = useState(post?.content ?? initialBody ?? '')

  const [savedSnapshot, setSavedSnapshot] = useState<FieldSnapshot>({
    title: post?.title ?? '',
    slug: post?.slug ?? '',
    excerpt: post?.excerpt ?? '',
    content: post?.content ?? '',
  })
  const isDirty = title !== savedSnapshot.title || slug !== savedSnapshot.slug || excerpt !== savedSnapshot.excerpt || content !== savedSnapshot.content

  const isSubmitted = Boolean(post?.submitted_for_review_at)
  const isPublished = post?.status === 'published'
  // Content editing is blocked once submitted for review (curator only --
  // an admin may still edit during review) and, for every role, once
  // published: updatePost's `.eq('status', 'draft')` predicate rejects the
  // write either way, so this mirrors the real enforcement rather than
  // letting Save silently fail or (for a published post) letting an edit
  // fall through to updatePost's generic "not editable" error. Editing a
  // published post must go through Unpublish first, per the dev request.
  const editingLocked = (viewerRole === 'curator' && isSubmitted) || isPublished

  function run(action: () => Promise<void>, successMessage: string, onSuccess?: () => void) {
    setError(null)
    setMessage(null)
    startTransition(async () => {
      try {
        await action()
        setMessage(successMessage)
        onSuccess?.()
        router.refresh()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Action failed')
      }
    })
  }

  // Clears a field's own error message as soon as the user edits it, rather
  // than leaving a stale "required" message visible after they've already
  // fixed it -- errors only reappear on the next failed Save.
  function clearFieldError(field: keyof BlogValidationErrors) {
    if (!fieldErrors[field]) return
    const next = { ...fieldErrors, [field]: undefined }
    setFieldErrors(next)
    // Once every field error is resolved, the general "fix the highlighted
    // fields" banner is stale too -- only clear it when it's that specific
    // message, so an unrelated save-failure message is left alone.
    if (error === VALIDATION_BLOCKED_MESSAGE && !Object.values(next).some(Boolean)) setError(null)
  }

  function handleToolbarAction(action: ToolbarAction) {
    const el = contentRef.current
    if (!el) return
    const result = applyToolbarAction(content, { start: el.selectionStart, end: el.selectionEnd }, action)
    setContent(result.text)
    clearFieldError('content')
    clearFieldError('links')
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(result.selectionStart, result.selectionEnd)
    })
  }

  async function handleCoverImageSave() {
    if (!post) return
    setCoverError(null)
    if (!coverFile) {
      setCoverError('Choose an image file first.')
      return
    }
    const altError = validateImageAltText(coverAlt)
    if (altError) {
      setCoverError(altError)
      return
    }
    setCoverUploadPending(true)
    try {
      const formData = new FormData()
      formData.set('file', coverFile)
      formData.set('alt', coverAlt.trim())
      await uploadBlogCoverImageAction(post.id, formData)
      setCoverFile(null)
      router.refresh()
    } catch (err) {
      setCoverError(err instanceof Error ? err.message : 'Failed to upload cover image')
    } finally {
      setCoverUploadPending(false)
    }
  }

  async function handleInsertInlineImage() {
    setImageError(null)
    if (!imageFile) {
      setImageError('Choose an image file first.')
      return
    }
    const altError = validateImageAltText(imageAlt)
    if (altError) {
      setImageError(altError)
      return
    }
    const el = contentRef.current
    setImageUploadPending(true)
    try {
      const formData = new FormData()
      formData.set('file', imageFile)
      formData.set('alt', imageAlt.trim())
      const { url } = await uploadBlogInlineImageAction(formData)
      const selection = el ? { start: el.selectionStart, end: el.selectionEnd } : { start: content.length, end: content.length }
      const result = insertInlineImage(content, selection, imageAlt.trim(), url, imageCaption.trim() || undefined)
      setContent(result.text)
      clearFieldError('content')
      setShowImagePanel(false)
      setImageFile(null)
      setImageAlt('')
      setImageCaption('')
      requestAnimationFrame(() => {
        el?.focus()
        el?.setSelectionRange(result.selectionStart, result.selectionEnd)
      })
    } catch (err) {
      setImageError(err instanceof Error ? err.message : 'Failed to upload image')
    } finally {
      setImageUploadPending(false)
    }
  }

  function handleSave() {
    const fields = { title: title.trim(), slug: slug.trim() || slugify(title), excerpt: excerpt.trim(), content }
    const validation = validateBlogPostFields(fields)
    setFieldErrors(validation.errors)
    if (!validation.valid) {
      setError(VALIDATION_BLOCKED_MESSAGE)
      return
    }
    if (post) {
      run(() => updateBlogPostAction(post.id, fields), 'Saved.', () => setSavedSnapshot({ title: fields.title, slug: fields.slug, excerpt: fields.excerpt, content: fields.content }))
    } else {
      setError(null)
      setMessage(null)
      startTransition(async () => {
        try {
          const { id } = await createBlogPostAction(fields)
          router.push(`${returnTo}/${id}/edit`)
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to create post')
        }
      })
    }
  }

  function handleSubmitForReview() {
    if (!post) return
    run(() => submitBlogPostForReviewAction(post.id), 'Submitted for review.')
  }

  function handleReturnToDraft() {
    if (!post) return
    run(() => returnBlogPostToDraftAction(post.id), 'Returned to draft.')
  }

  function handlePublish() {
    if (!post) return
    if (
      !window.confirm(
        `Approve and publish "${post.title}"?\n\nThis makes the current saved content of this post publicly visible at /blog/${post.slug}.`
      )
    )
      return
    run(() => publishBlogPostAction(post.id), 'Published.')
  }

  function handleUnpublish() {
    if (!post) return
    if (!window.confirm('Unpublish this post? It will no longer be visible to anonymous visitors.')) return
    run(() => unpublishBlogPostAction(post.id), 'Unpublished.')
  }

  function handleDelete() {
    if (!post) return
    if (!window.confirm(`Delete the draft "${post.title}"? This cannot be undone.`)) return
    startTransition(async () => {
      try {
        await deleteBlogPostAction(post.id)
        router.push('/admin')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete post')
      }
    })
  }

  const saveLabel = !post ? 'Save draft' : viewerRole === 'admin' ? 'Save without publishing' : 'Save draft'

  return (
    <div className="flex flex-col gap-6">
      {importSummary && (
        <div className="rounded border border-amber-200 bg-amber-50 p-4" role="status">
          <p className="text-sm font-medium text-amber-900">Document converted -- review before saving</p>
          <p className="mt-1 text-xs text-amber-800">
            Recognised {importSummary.stats.headings} heading{importSummary.stats.headings === 1 ? '' : 's'}, {importSummary.stats.links} link
            {importSummary.stats.links === 1 ? '' : 's'}, {importSummary.stats.listItems} list item{importSummary.stats.listItems === 1 ? '' : 's'}, and{' '}
            {importSummary.stats.tables} table{importSummary.stats.tables === 1 ? '' : 's'}. Title and excerpt were suggested from the document --
            check them below.
          </p>
          {importSummary.warnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1">
              {importSummary.warnings.map((w, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-amber-800">
                  <span aria-hidden="true">⚠</span>
                  <span>{w.message}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {post && (
        <div className="flex flex-col gap-3 rounded border border-zinc-200 bg-white p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">
                Status:{' '}
                <span className={isPublished ? 'text-green-700' : isSubmitted ? 'text-amber-700' : 'text-zinc-500'}>
                  {isPublished ? 'published' : isSubmitted ? 'ready for review' : 'draft'}
                </span>
              </p>
              {isPublished && <p className="text-xs text-zinc-500">Live at /blog/{post.slug}</p>}
              {isSubmitted && !isPublished && (
                <p className="text-xs text-amber-700">
                  Submitted by {emailFor(post.submitted_by, emailById)} on {new Date(post.submitted_for_review_at!).toLocaleString()}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {viewerRole === 'curator' && post.status === 'draft' && !isSubmitted && (
                <button
                  disabled={isPending}
                  onClick={handleSubmitForReview}
                  className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                >
                  Submit for review
                </button>
              )}
              {viewerRole === 'admin' && isSubmitted && !isPublished && (
                <button
                  disabled={isPending}
                  onClick={handleReturnToDraft}
                  className="rounded border border-zinc-300 px-3 py-1.5 text-sm disabled:opacity-50"
                >
                  Return to draft
                </button>
              )}
              {viewerRole === 'admin' && post.status === 'draft' && (
                <button
                  disabled={isPending}
                  onClick={handleDelete}
                  className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
              {viewerRole === 'admin' &&
                (isPublished ? (
                  <button
                    disabled={isPending}
                    onClick={handleUnpublish}
                    className="rounded border border-red-300 px-3 py-1.5 text-sm text-red-700 disabled:opacity-50"
                  >
                    Unpublish
                  </button>
                ) : (
                  <button
                    disabled={isPending}
                    onClick={handlePublish}
                    className="rounded bg-zinc-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
                  >
                    Approve and publish
                  </button>
                ))}
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Original author: {emailFor(post.author_id, emailById)}
            {post.last_editor_id && post.last_editor_id !== post.author_id && <> · Last edited by: {emailFor(post.last_editor_id, emailById)}</>}
            {post.published_by && <> · Published by: {emailFor(post.published_by, emailById)}</>}
          </p>
          {editingLocked && isPublished && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This post is published and can&apos;t be edited directly. Unpublish it first to make changes, then republish when ready.
            </p>
          )}
          {editingLocked && !isPublished && (
            <p className="rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              This draft is awaiting administrator review and can&apos;t be edited right now. An administrator can return it to draft.
            </p>
          )}
        </div>
      )}

      <fieldset disabled={editingLocked} className="flex flex-col gap-4 rounded border border-zinc-200 bg-white p-4 disabled:opacity-60">
        {post && (
          <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3">
            <span className="text-sm font-medium">Cover image (optional)</span>
            {coverImageUrl && (
              // eslint-disable-next-line @next/next/no-img-element -- Supabase Storage public URL, not a static asset.
              <img src={coverImageUrl} alt={post.cover_image_alt ?? ''} className="h-32 w-full rounded object-cover" />
            )}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              onChange={(e) => setCoverFile(e.target.files?.[0] ?? null)}
              className="text-sm"
            />
            <input
              value={coverAlt}
              onChange={(e) => setCoverAlt(e.target.value)}
              placeholder="Alternative text (required to save a cover image)"
              className="rounded border border-zinc-300 px-3 py-2 text-sm"
            />
            {coverError && <span className="text-xs text-red-600">{coverError}</span>}
            <button
              type="button"
              disabled={coverUploadPending || !coverFile || !coverAlt.trim()}
              onClick={handleCoverImageSave}
              className="self-start rounded border border-zinc-300 px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              {coverUploadPending ? 'Uploading…' : 'Save cover image'}
            </button>
          </div>
        )}
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Title</span>
          <input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              clearFieldError('title')
            }}
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          {fieldErrors.title && <span className="text-xs text-red-600">{fieldErrors.title}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">URL slug</span>
          <input
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value)
              clearFieldError('slug')
            }}
            placeholder={slugify(title || 'post-title')}
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          {fieldErrors.slug && <span className="text-xs text-red-600">{fieldErrors.slug}</span>}
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">Excerpt (shown in the blog listing and page description)</span>
          <textarea
            rows={2}
            value={excerpt}
            onChange={(e) => {
              setExcerpt(e.target.value)
              clearFieldError('excerpt')
            }}
            className="rounded border border-zinc-300 px-3 py-2 text-sm"
          />
          {fieldErrors.excerpt && <span className="text-xs text-red-600">{fieldErrors.excerpt}</span>}
        </label>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Article body</span>
            <div className="flex rounded border border-zinc-300 text-xs">
              <button
                type="button"
                onClick={() => setActiveTab('write')}
                className={`rounded-l px-2.5 py-1 ${activeTab === 'write' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600'}`}
              >
                Write
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('preview')}
                className={`rounded-r px-2.5 py-1 ${activeTab === 'preview' ? 'bg-zinc-900 text-white' : 'bg-white text-zinc-600'}`}
              >
                Preview
              </button>
            </div>
          </div>
          <p className="text-xs text-zinc-500">
            Use the toolbar for headings, emphasis, links, lists, and quotations. Preview shows how the published article will appear.
          </p>

          {activeTab === 'write' ? (
            <>
              <div className="flex flex-wrap gap-1 rounded-t border border-b-0 border-zinc-300 bg-zinc-50 p-1">
                {TOOLBAR_BUTTONS.map((btn) => (
                  <button
                    key={btn.action}
                    type="button"
                    title={btn.title}
                    onClick={() => handleToolbarAction(btn.action)}
                    className="rounded px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
                  >
                    {btn.label}
                  </button>
                ))}
                <button
                  type="button"
                  title="Add image"
                  onClick={() => setShowImagePanel((v) => !v)}
                  className="rounded px-2 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-200"
                >
                  Image
                </button>
              </div>
              {showImagePanel && (
                <div className="flex flex-col gap-2 border border-b-0 border-zinc-300 bg-zinc-50 p-2">
                  <input
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    onChange={(e) => setImageFile(e.target.files?.[0] ?? null)}
                    className="text-xs"
                  />
                  <input
                    value={imageAlt}
                    onChange={(e) => setImageAlt(e.target.value)}
                    placeholder="Alternative text (required)"
                    className="rounded border border-zinc-300 px-2 py-1 text-xs"
                  />
                  <input
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                    placeholder="Caption (optional)"
                    className="rounded border border-zinc-300 px-2 py-1 text-xs"
                  />
                  {imageError && <span className="text-xs text-red-600">{imageError}</span>}
                  <button
                    type="button"
                    disabled={imageUploadPending || !imageFile || !imageAlt.trim()}
                    onClick={handleInsertInlineImage}
                    className="self-start rounded bg-zinc-900 px-2 py-1 text-xs font-medium text-white disabled:opacity-50"
                  >
                    {imageUploadPending ? 'Uploading…' : 'Insert image'}
                  </button>
                </div>
              )}
              <textarea
                ref={contentRef}
                rows={20}
                value={content}
                onChange={(e) => {
                  setContent(e.target.value)
                  clearFieldError('content')
                  clearFieldError('links')
                }}
                className="rounded-b border border-zinc-300 px-3 py-2 font-mono text-sm"
              />
            </>
          ) : (
            <div className="rounded border border-zinc-200 bg-white p-5" data-testid="blog-preview">
              <h1 className="text-2xl font-semibold">{title || 'Untitled post'}</h1>
              <div className="mt-4">
                <Markdown text={content || '*Nothing to preview yet.*'} />
              </div>
            </div>
          )}
          {fieldErrors.content && <span className="text-xs text-red-600">{fieldErrors.content}</span>}
          {fieldErrors.links && <span className="text-xs text-red-600">{fieldErrors.links}</span>}
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        {message && <p className="text-sm text-green-700">{message}</p>}

        <div className="flex items-center gap-3">
          <button disabled={isPending} onClick={handleSave} className="self-start rounded bg-zinc-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {saveLabel}
          </button>
          {isDirty && <span className="text-xs font-medium text-amber-700">Unsaved changes</span>}
        </div>
      </fieldset>

      {post && (
        <div className="rounded border border-zinc-200 bg-white p-4">
          <h3 className="text-sm font-semibold">Related articles</h3>
          <p className="mt-1 text-xs text-zinc-500">Shown on the public article page once this post is published. Only published posts can be linked.</p>
          <ul className="mt-2 flex flex-col gap-1">
            {relatedPosts.map((r) => (
              <li key={r.relationId} className="flex items-center justify-between gap-2 text-sm">
                <span>
                  {r.post.title} {r.post.status !== 'published' && <span className="text-xs text-zinc-400">({r.post.status})</span>}
                </span>
                <BlogRelatedPostRemoveButton relationId={r.relationId} postId={post.id} />
              </li>
            ))}
            {relatedPosts.length === 0 && <li className="text-sm text-zinc-500">No related articles linked yet.</li>}
          </ul>
          <BlogRelatedPostsManager postId={post.id} posts={linkableCandidates} excludeSlugs={relatedPosts.map((r) => r.post.slug)} />
        </div>
      )}

      {post && <SubstackExportPanel postId={post.id} />}
    </div>
  )
}
