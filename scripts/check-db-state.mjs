import { createClient } from '@supabase/supabase-js'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url || !serviceKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

const tables = ['profiles', 'knowledge_bases', 'documents', 'document_chunks', 'kb_vectors', 'settings', 'wiki_articles', 'wiki_versions']

let missing = 0
for (const table of tables) {
  // Not a head:true request -- a HEAD 404 has no body, so supabase-js reports
  // no error and a null count for a table that doesn't exist.
  const { error, count } = await admin.from(table).select('*', { count: 'exact' }).limit(0)
  if (error || count === null) {
    missing++
    console.log(`${table}: MISSING (${error?.message ?? 'no row count returned'})`)
  } else {
    console.log(`${table}: OK (${count} rows)`)
  }
}
if (missing > 0) process.exit(1)
