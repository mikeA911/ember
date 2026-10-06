# Local end-to-end stack

A throwaway, local copy of what Ember needs from Supabase, so features that
need two signed-in people in two browsers (shared workspace sessions) can
be exercised against the real UI, the real migrations and real PostgREST --
without touching the shared Supabase backend. Every script here refuses a
non-local database.

What's real: Postgres with every migration in `supabase/migrations`,
PostgREST, the Next.js app (production build). What's stood in for:
`supabase-stub.sql` (API roles, `auth`/`storage` schemas, `auth.uid()`
reading PostgREST's claims) and `gateway.mjs` (Supabase's `/auth/v1`
endpoints with any password accepted, and `/rest/v1` forwarded to
PostgREST; no Storage, so branding images are missing).

## Run it

Needs Postgres 16 with pgvector, a PostgREST 12 binary, and Playwright's
`playwright-core` plus a Chromium (not dependencies of this repo).

```bash
# 1. Database: stand-in, all migrations, seed (Hana and Gil in one Project).
PGHOST=/tmp PGPORT=54329 scripts/local-e2e/build-db.sh ember_e2e

# 2. PostgREST on 54330 (jwt-secret = the same 32+ character secret).
cat > /tmp/postgrest.conf <<CONF
db-uri = "postgres://authenticator:local-only@localhost:54329/ember_e2e?host=/tmp"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "$E2E_JWT_SECRET"
server-port = 54330
CONF
postgrest /tmp/postgrest.conf &

# 3. Gateway on 54321, and the keys the app needs.
export E2E_DATABASE_URL="postgres://postgres@localhost/ember_e2e?host=/tmp&port=54329"
node scripts/local-e2e/gateway.mjs &
eval "$(node scripts/local-e2e/gateway.mjs keys)"   # sets ANON and SERVICE

# 4. The app, built against the local stack.
export NEXT_PUBLIC_EMBER_COLLABORATION=true NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 \
  NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON SUPABASE_SERVICE_ROLE_KEY=$SERVICE
npx next build && npx next start -p 3100 &

# 5. Two browsers.
PLAYWRIGHT_DIR=/dir/whose/node_modules/has/playwright-core CHROMIUM_PATH=/path/to/chrome \
  SHOTS=/tmp/shots node scripts/local-e2e/collaboration-two-browsers.mjs
```

For Phase 2 (shared editing), run `collaboration-shared-editing.mjs` the
same way.

Sign-in is `hana@e2e.local` / `gil@e2e.local` / `vera@e2e.local` with any password. The
script resets only the collaboration tables before it runs.
