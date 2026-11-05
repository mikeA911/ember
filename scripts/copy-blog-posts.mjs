// Copies Blog posts from one Ember instance (the source, e.g. Ember Core)
// into another (the target, e.g. ember-sli). Each instance has its own
// Supabase project, so this reads the source with its service key and
// writes the target with its own.
//
//   node --env-file=.env.local --env-file=.env.source.local scripts/copy-blog-posts.mjs [--apply] [--include-drafts] [--update]
//
// .env.local is the TARGET (as for every other script):
//   NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// .env.source.local holds the SOURCE (keep it out of git: *.local is ignored):
//   SOURCE_SUPABASE_URL=https://<source-project>.supabase.co
//   SOURCE_SUPABASE_SERVICE_ROLE_KEY=...
//
// What it does, per post (matched by slug):
// - copies the post's text, status, dates, cover image and alt text;
// - copies images in the blog-media bucket that the post uses (its cover and
//   any inline image in its content) and points the content at the target's
//   copies;
// - authors and editors are matched by email: someone with the same email on
//   the target is credited, otherwise the field is left empty;
// - a post whose slug already exists on the target is skipped, unless
//   --update (then it is overwritten);
// - drafts are left out unless --include-drafts;
// - "related posts" links are copied between posts that exist on both.
// Dry run by default: it lists what it would do. Add --apply to write.
import { createClient } from '@supabase/supabase-js'

const apply = process.argv.includes('--apply')
const includeDrafts = process.argv.includes('--include-drafts')
const update = process.argv.includes('--update')

const targetUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const targetKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const sourceUrl = process.env.SOURCE_SUPABASE_URL
const sourceKey = process.env.SOURCE_SUPABASE_SERVICE_ROLE_KEY
if (!targetUrl || !targetKey) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (the target, from .env.local)')
if (!sourceUrl || !sourceKey) throw new Error('Missing SOURCE_SUPABASE_URL or SOURCE_SUPABASE_SERVICE_ROLE_KEY (the source, e.g. in .env.source.local)')
if (new URL(sourceUrl).host === new URL(targetUrl).host) throw new Error('The source and target are the same Supabase project. Check the two env files.')

const opts = { auth: { autoRefreshToken: false, persistSession: false } }
const source = createClient(sourceUrl, sourceKey, opts)
const target = createClient(targetUrl, targetKey, opts)
const BUCKET = 'blog-media'
const PEOPLE = ['author_id', 'last_editor_id', 'submitted_by', 'published_by']

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`)
  return data
}

// People: source id -> email -> target id.
async function emailsById(db, ids) {
  if (ids.length === 0) return new Map()
  const rows = must(await db.from('profiles').select('id, email').in('id', ids), 'Profiles')
  return new Map(rows.map((r) => [r.id, r.email?.toLowerCase() ?? null]))
}

let query = source.from('blog_posts').select('*').order('created_at')
if (!includeDrafts) query = query.eq('status', 'published')
const posts = must(await query, 'Source posts')
if (posts.length === 0) {
  console.log('No posts to copy.')
  process.exit(0)
}

const sourceEmails = await emailsById(source, [...new Set(posts.flatMap((p) => PEOPLE.map((k) => p[k]).filter(Boolean)))])
const wanted = [...new Set([...sourceEmails.values()].filter(Boolean))]
const targetPeople = wanted.length ? must(await target.from('profiles').select('id, email').in('email', wanted), 'Target profiles') : []
const targetIdByEmail = new Map(targetPeople.map((r) => [r.email.toLowerCase(), r.id]))
const mapPerson = (id) => (id ? (targetIdByEmail.get(sourceEmails.get(id)) ?? null) : null)

const existing = must(await target.from('blog_posts').select('id, slug').in('slug', posts.map((p) => p.slug)), 'Target posts')
const targetIdBySlug = new Map(existing.map((r) => [r.slug, r.id]))

// Images: the source bucket's public URLs in content become the target's.
const sourcePublic = `${sourceUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`
const targetPublic = `${targetUrl.replace(/\/$/, '')}/storage/v1/object/public/${BUCKET}/`
const escaped = sourcePublic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const inlinePattern = new RegExp(`${escaped}([^\\s)"'<>]+)`, 'g')

async function copyObject(path) {
  const { data, error } = await source.storage.from(BUCKET).download(path)
  if (error) throw new Error(`Download ${path}: ${error.message}`)
  const up = await target.storage.from(BUCKET).upload(path, data, { upsert: true, contentType: data.type || undefined })
  if (up.error) throw new Error(`Upload ${path}: ${up.error.message}`)
}

const copiedSlugs = new Map()
let skipped = 0
for (const post of posts) {
  const exists = targetIdBySlug.has(post.slug)
  if (exists && !update) {
    console.log(`skip    ${post.slug} (already on the target; --update to overwrite)`)
    skipped++
    copiedSlugs.set(post.id, targetIdBySlug.get(post.slug))
    continue
  }
  const images = new Set()
  if (post.cover_image_path) images.add(post.cover_image_path)
  for (const m of (post.content ?? '').matchAll(inlinePattern)) images.add(decodeURIComponent(m[1]))
  const unmatched = PEOPLE.filter((k) => post[k] && !mapPerson(post[k]))

  console.log(
    `${exists ? 'update' : 'copy  '}  ${post.slug} (${post.status}${images.size ? `, ${images.size} image${images.size > 1 ? 's' : ''}` : ''}${
      unmatched.length ? `, no matching ${unmatched.join('/')} on the target` : ''
    })`
  )
  if (!apply) {
    copiedSlugs.set(post.id, `dry-run:${post.slug}`)
    continue
  }

  for (const path of images) await copyObject(path)
  const row = { ...post }
  delete row.id
  delete row.updated_at
  for (const k of PEOPLE) if (k in row) row[k] = mapPerson(post[k])
  row.content = (post.content ?? '').split(sourcePublic).join(targetPublic)
  const saved = must(await target.from('blog_posts').upsert(row, { onConflict: 'slug' }).select('id').single(), `Save ${post.slug}`)
  copiedSlugs.set(post.id, saved.id)
}

// Related posts, between posts present on both sides.
const relations = must(await source.from('blog_relations').select('from_post_id, to_post_id, relation_type'), 'Source relations')
const links = relations
  .filter((r) => copiedSlugs.has(r.from_post_id) && copiedSlugs.has(r.to_post_id))
  .map((r) => ({ from_post_id: copiedSlugs.get(r.from_post_id), to_post_id: copiedSlugs.get(r.to_post_id), relation_type: r.relation_type }))
if (apply && links.length) must(await target.from('blog_relations').upsert(links, { onConflict: 'from_post_id,to_post_id' }), 'Relations')

const copied = posts.length - skipped
console.log(
  `\n${apply ? 'Done' : 'Dry run'}: ${copied} post${copied === 1 ? '' : 's'} ${apply ? 'copied' : 'to copy'}, ${skipped} skipped${
    links.length ? `, ${links.length} related-post link${links.length === 1 ? '' : 's'}` : ''
  }.`
)
if (!apply) console.log('Nothing was written. Run again with --apply to copy.')
