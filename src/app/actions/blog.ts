'use server'

import { revalidatePath } from 'next/cache'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveStructuredOutputProvider } from '@/lib/ai'
import { env } from '@/lib/env'
import {
  createDraftPost,
  updatePost,
  submitPostForReview,
  returnPostToDraft,
  publishPost,
  unpublishPost,
  deleteDraftPost,
  getPostById,
  setCoverImage,
  listPublishablePostsForLinking,
  BlogValidationError,
} from '@/lib/blog/posts'
import { validateBlogImageFile, buildBlogMediaPath, getBlogMediaUrl, BLOG_MEDIA_BUCKET } from '@/lib/blog/media'
import { validateImageAltText } from '@/lib/blog/validation'
import { linkRelatedPost, unlinkRelatedPost } from '@/lib/blog/relations'
import { generateSubstackPackage } from '@/lib/blog/substack-export'
import { checkImportFileBasics, convertDocxImport, convertMarkdownImport, convertPlainTextImport, type ImportResult } from '@/lib/blog/import'

function slugify(title: string) {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function createBlogPostAction(input: { title: string; slug: string; excerpt: string; content: string }) {
  const { user, supabase } = await requireRole('curator')
  const post = await createDraftPost(supabase, {
    title: input.title,
    slug: input.slug.trim() || slugify(input.title),
    excerpt: input.excerpt.trim() || null,
    content: input.content,
    authorId: user.id,
  })
  revalidatePath('/admin')
  revalidatePath('/contribute/blog')
  return { id: post.id }
}

export async function updateBlogPostAction(id: string, input: { title: string; slug: string; excerpt: string; content: string }) {
  const { user, supabase } = await requireRole('curator')
  await updatePost(
    supabase,
    id,
    {
      title: input.title,
      slug: input.slug.trim() || slugify(input.title),
      excerpt: input.excerpt.trim() || null,
      content: input.content,
    },
    user.id
  )
  revalidatePath('/admin')
  revalidatePath('/contribute/blog')
  revalidatePath(`/admin/blog/${id}/edit`)
  revalidatePath(`/contribute/blog/${id}/edit`)
  revalidatePath('/blog')
}

export async function submitBlogPostForReviewAction(id: string) {
  const { user, supabase } = await requireRole('curator')
  await submitPostForReview(supabase, id, user.id)
  revalidatePath('/admin')
  revalidatePath('/contribute/blog')
  revalidatePath(`/contribute/blog/${id}/edit`)
}

export async function returnBlogPostToDraftAction(id: string) {
  const { supabase } = await requireRole('admin')
  await returnPostToDraft(supabase, id)
  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${id}/edit`)
}

export async function publishBlogPostAction(id: string) {
  const { user, supabase } = await requireRole('admin')
  await publishPost(supabase, id, user.id)
  const post = await getPostById(supabase, id)
  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${id}/edit`)
  revalidatePath('/blog')
  if (post) revalidatePath(`/blog/${post.slug}`)
}

export async function unpublishBlogPostAction(id: string) {
  const { supabase } = await requireRole('admin')
  const before = await getPostById(supabase, id)
  await unpublishPost(supabase, id)
  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${id}/edit`)
  revalidatePath('/blog')
  if (before) revalidatePath(`/blog/${before.slug}`)
}

export async function deleteBlogPostAction(id: string) {
  const { supabase } = await requireRole('admin')
  await deleteDraftPost(supabase, id)
  revalidatePath('/admin')
}

// Uploads go through the admin (service-role) client, same pattern as
// updateBrandingIconAction -- the Server Action's requireRole call is the
// enforcement point, not storage RLS, so a curator can upload without
// needing broader storage access than that. setCoverImage's own
// status='draft' predicate (src/lib/blog/posts.ts) still governs whether
// the *post row* can be updated with the result.
export async function uploadBlogCoverImageAction(postId: string, formData: FormData) {
  const { supabase } = await requireRole('curator')

  const file = formData.get('file') as File | null
  const alt = (formData.get('alt') as string | null)?.trim() ?? ''
  if (!file) throw new BlogValidationError('No file provided')
  validateBlogImageFile(file)
  const altError = validateImageAltText(alt)
  if (altError) throw new BlogValidationError(altError)

  const existing = await getPostById(supabase, postId)

  const admin = createAdminClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const path = buildBlogMediaPath(file.name)
  const { error: uploadError } = await admin.storage.from(BLOG_MEDIA_BUCKET).upload(path, buffer, { contentType: file.type })
  if (uploadError) throw uploadError

  try {
    await setCoverImage(supabase, postId, path, alt)
  } catch (err) {
    // Compensating delete -- the row update failed (RLS/status predicate,
    // post not found), so the just-uploaded object must not become an
    // orphan. Best-effort: a cleanup failure here should surface the
    // original error, not mask it.
    await admin.storage
      .from(BLOG_MEDIA_BUCKET)
      .remove([path])
      .catch(() => {})
    throw err
  }

  // The update succeeded, so the previous cover object (if any) is now
  // superseded -- remove it so replacing a cover image doesn't
  // accumulate orphans. Best-effort: the post row is already correct
  // either way.
  if (existing?.cover_image_path && existing.cover_image_path !== path) {
    await admin.storage
      .from(BLOG_MEDIA_BUCKET)
      .remove([existing.cover_image_path])
      .catch(() => {})
  }

  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${postId}/edit`)
  revalidatePath(`/contribute/blog/${postId}/edit`)
  revalidatePath('/blog')
  return { url: getBlogMediaUrl(admin, path) }
}

// Inline images don't touch blog_posts at all -- the editor inserts the
// returned URL as Markdown at the cursor position (see
// insertInlineImage in src/lib/blog/editor-toolbar.ts) and it becomes
// "referenced" only once the post itself is saved with that Markdown in
// its content, same as any other content edit.
export async function uploadBlogInlineImageAction(formData: FormData) {
  await requireRole('curator')

  const file = formData.get('file') as File | null
  const alt = (formData.get('alt') as string | null)?.trim() ?? ''
  if (!file) throw new BlogValidationError('No file provided')
  validateBlogImageFile(file)
  const altError = validateImageAltText(alt)
  if (altError) throw new BlogValidationError(altError)

  const admin = createAdminClient()
  const buffer = Buffer.from(await file.arrayBuffer())
  const path = buildBlogMediaPath(file.name)
  const { error: uploadError } = await admin.storage.from(BLOG_MEDIA_BUCKET).upload(path, buffer, { contentType: file.type })
  if (uploadError) throw uploadError

  return { url: getBlogMediaUrl(admin, path), alt }
}

export async function linkRelatedBlogPostAction(fromPostId: string, toSlug: string) {
  const { supabase } = await requireRole('curator')
  const { data: target, error } = await supabase.from('blog_posts').select('id').eq('slug', toSlug).maybeSingle()
  if (error) throw error
  if (!target) throw new BlogValidationError(`No post found with slug "${toSlug}"`)
  if (target.id === fromPostId) throw new BlogValidationError('A post cannot be related to itself')
  await linkRelatedPost(supabase, fromPostId, target.id)
  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${fromPostId}/edit`)
  revalidatePath(`/contribute/blog/${fromPostId}/edit`)
  revalidatePath('/blog')
}

export async function unlinkRelatedBlogPostAction(relationId: string, fromPostId: string) {
  const { supabase } = await requireRole('curator')
  await unlinkRelatedPost(supabase, relationId)
  revalidatePath('/admin')
  revalidatePath(`/admin/blog/${fromPostId}/edit`)
  revalidatePath(`/contribute/blog/${fromPostId}/edit`)
  revalidatePath('/blog')
}

export async function listRelatedBlogPostCandidatesAction(excludePostId: string) {
  const { supabase } = await requireRole('curator')
  return listPublishablePostsForLinking(supabase, excludePostId)
}

// Pure export -- resolves a provider and generates a reviewable package
// (src/lib/blog/substack-export.ts). Nothing here writes to blog_posts;
// the caller only ever gets a package back to review, copy from, and
// discard. Available to a saved draft or a published post, any status,
// per the dev request's own scope for this action.
export async function generateSubstackExportAction(postId: string) {
  const { user, supabase } = await requireRole('curator')
  const post = await getPostById(supabase, postId)
  if (!post) throw new BlogValidationError('Post not found')

  const provider = await getActiveStructuredOutputProvider(supabase, { task: 'blog_export', requestedBy: user.id })
  const canonicalUrl = `${env.siteUrl()}/blog/${post.slug}`
  return generateSubstackPackage(provider, post, canonicalUrl)
}

// Converts an uploaded document into suggested draft fields -- never
// touches blog_posts. Failed/successful conversion alike returns a plain
// result to the client; saving is the existing, separate
// createBlogPostAction call, which is what makes "a failed conversion
// leaves no partial record" and "retrying doesn't duplicate drafts" true
// without any special-case logic here.
export async function importBlogDraftAction(formData: FormData): Promise<ImportResult> {
  await requireRole('curator')

  const file = formData.get('file') as File | null
  if (!file) throw new BlogValidationError('No file provided')

  const ext = checkImportFileBasics(file.name, file.size)
  const buffer = Buffer.from(await file.arrayBuffer())

  if (ext === '.docx') return convertDocxImport(buffer, file.name)
  if (ext === '.md' || ext === '.markdown') return convertMarkdownImport(buffer, file.name)
  return convertPlainTextImport(buffer, file.name)
}
