# Running Ember on self-hosted Supabase (Zadara)

Ember-specific additions to the **Supabase Per-Client Stack — Template and Method** runbook (Mike Aguilar, 2 October 2026). Follow the runbook for Steps 1–9. This guide covers only what Ember needs on top of it, or does differently.

**Topology:** Ember's Next.js app stays on **Vercel**. Supabase moves to one Docker Compose stack per environment on a **Zadara zCompute VM in the Philippines** (`sandz-ember-lab`, `sandz-ember-prod`).

```text
Browser ──HTTPS──▶ Vercel (Ember, region hkg1) ──HTTPS──▶ Caddy :443 on the Zadara VM ──▶ Supabase gateway :8000 (localhost) ──▶ Auth / REST / Storage ──▶ Postgres
Browser ──HTTPS────────────────────────────────────────▶ Caddy :443   (sign-in and password reset go straight to Supabase Auth)
                                                          Storage objects ──▶ Zadara S3 bucket
```

Ember reaches Supabase only through `supabase-js` over HTTPS. It never opens a direct Postgres connection from Vercel, so the pooler ports (5432/6543) stay closed exactly as the runbook says.

## VM sizing for Ember

The runbook's sizes fit Ember. Ember uses fewer Supabase services than a typical app (no Realtime, Edge Functions or `pg_cron`), and its files live in Zadara S3, so the VM disk only holds Postgres, the container images, logs and three days of local dumps.

| | lab | prod |
|---|---|---|
| vCPU | 2 | 4 |
| RAM | 4 GB | 8 GB |
| Disk (SSD) | 60 GB | 100 GB |
| OS | Ubuntu 24.04 LTS | Ubuntu 24.04 LTS |

What drives the size:

- **Idle stack:** the full Docker Compose stack takes roughly 2–3 GB of RAM before any load. A 4 GB lab is workable but tight; move lab to 8 GB if you turn on the optional log stack (`run.sh config add logs`, Logflare), which adds RAM.
- **Vectors:** each approved chunk stores a 1536-dimension embedding, about 6 KB plus index. 100,000 chunks is roughly 1–1.5 GB including the index. Postgres is fastest when the vector index fits in memory, so **plan 16 GB for prod once `kb_vectors` passes about 500,000 rows**.
- **Concurrency:** Ember's traffic is people using the app plus evaluation runs. Evaluation runs execute synchronously in a Vercel function and spend most of their time waiting on AI providers, not Postgres. 4 vCPU is ample for a team of tens of users.
- **Disk:** Postgres plus vector indexes, the Supabase images (about 10–15 GB), logs, and the local dump copies kept by `backup.sh`. Alert at 80% as the runbook says, and grow the volume rather than the VM when it fills.

Check prod at one month: `select pg_size_pretty(pg_database_size('postgres'));` and `free -h`. Resize from those numbers rather than estimates.

## What Ember needs from the stack

| Need | Status in the runbook | Ember action |
|---|---|---|
| Public HTTPS API on `<api-domain>` | Step 4 | Must be reachable from the public internet. Vercel's outbound IPs are not fixed, and browsers call Auth directly. |
| `vector` and `pgcrypto` extensions | Included in the `supabase/postgres` image | None |
| Storage on Zadara S3 | Step 5 | Ember's migrations create its buckets; no manual bucket setup |
| SMTP | Step 2b | Test **password reset**, not sign-up (see below) |
| Realtime, Edge Functions | Included | Not used by Ember; skip their smoke tests |
| `pg_cron`, `pg_net` | n/a | Not used. Scheduled presentation reviews run as a **Vercel cron** (`vercel.json`). |
| OAuth 2.1 server (external MCP) | **Not covered** | Extra step below; needs Mike's sign-off because it changes `docker-compose.yml` |

## 1. API keys → Vercel environment variables

The runbook generates the newer key pair. Ember's environment variable names predate it; `supabase-js` 2.117 accepts either key format in the same place.

| Vercel variable | Value from the stack's `.env` | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | `https://<api-domain>` (= `SUPABASE_PUBLIC_URL`) | No trailing slash |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `SUPABASE_PUBLISHABLE_KEY` | Safe in the browser |
| `SUPABASE_SERVICE_ROLE_KEY` | `SUPABASE_SECRET_KEY` | Server-only. Never prefix with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | `<app-url>` | Used for links, sitemap and MCP answers |

`NEXT_PUBLIC_*` values are baked in at **build** time. **Redeploy** after changing them.

On lab, test the server-side admin paths with the secret key before cutting over: creating a user from **Admin → Users**, adding a member by email on a Project, and (if MCP is enabled) connecting an AI app. If any of these fail with the secret key, fall back to the legacy `SERVICE_ROLE_KEY` from the same `.env` and tell Mike.

### Two stacks, one Vercel project

| Vercel environment | Supabase stack |
|---|---|
| Production | `sandz-ember-prod` |
| Preview | `sandz-ember-lab` |

Set the four variables above separately for each Vercel environment.

## 2. Auth URL settings

In each stack's `.env` (then `sh run.sh recreate auth`):

- `SITE_URL` = the Ember URL for that environment.
- `ADDITIONAL_REDIRECT_URLS` must include every origin Ember runs on, because password reset redirects to `${window.location.origin}/reset-password` (`src/components/auth/ForgotPasswordForm.tsx`). For **lab**, add the Vercel preview wildcard, for example `https://*-<vercel-team>.vercel.app/**`, so reset links from preview deployments are accepted.

## 3. Email: test password reset, not sign-up

Ember has **no self-service sign-up**. Admins create accounts with the email already confirmed, so the runbook's "sign-up email arrives" check can never pass. Password reset is the only email Ember sends. Replace that checklist line with:

> ☐ Password-reset email arrives within 2 minutes in a Gmail and an Outlook inbox (not spam), with SPF and DKIM passing, and the link opens Ember's `/reset-password` page.

### Choosing an SMTP provider

Ember's volume is tiny: password resets only, a handful a week. Deliverability and simple setup matter more than price.

**Recommendation for Sandz-internal stacks (Ember, sandz-pages): one transactional email provider account,** with a dedicated sending subdomain such as `mail.<sandz-domain>` and one sender address per app (`no-reply@mail.<sandz-domain>`). Using a subdomain keeps app email from affecting the reputation of people's own mailboxes.

| Option | Good for | Watch out for |
|---|---|---|
| **Postmark** | Best-in-class deliverability for password resets; simple SMTP credentials | Paid beyond a small free tier; check current pricing |
| **Resend** | Simple setup and a free tier that covers Ember's volume | Newer provider; check current limits |
| **Amazon SES** (Singapore, `ap-southeast-1`) | Cheapest at volume, close to the Philippines, and reusable for client stacks | Starts in a sandbox: request production access before go-live |
| **Brevo** | Free daily allowance, EU-based | Daily cap on the free plan |
| Google Workspace SMTP relay | If Sandz is already on Workspace and wants no new vendor | Must be restricted to the VM's IP, which needs a fixed outbound IP from Zadara; daily limits |
| Microsoft 365 | Not recommended | Password-based SMTP sign-in is being switched off from the end of December 2026 (see runbook Step 2b) |

Any of the first three is a good choice; pick by who will own the account. All of them give SMTP host, port 587, username and password, which go straight into the runbook's `SMTP_*` settings. For government clients such as Bacolod, expect to use the client's own relay instead (runbook Step 2b).

## Sign-in options for Ember users

Ember signs people in with **email and password** only (`src/components/auth/LoginForm.tsx`). Accounts are created by an admin. Self-hosting doesn't change this; it works as soon as the stack is up.

If you want single sign-on, Supabase Auth supports it out of the box with **Google** (if Sandz uses Google Workspace) or **Microsoft Entra ID** (if Sandz uses Microsoft 365). Setting it up takes three things:

1. Register Ember as an app in Google Cloud Console or Entra, with the redirect URL `https://<api-domain>/auth/v1/callback`.
2. Add that provider's client ID and secret to the stack's `.env` (`GOOGLE_*` or `AZURE_*` settings for the auth service).
3. Add a "Sign in with Google/Microsoft" button to Ember's login page. That is a small code change: `signInWithOAuth` plus an auth callback route.

**Recommendation:** go live with email and password, which needs no extra work, and add SSO later as its own change. When you add it, decide whether signing in with SSO may create a new Ember account or may only match accounts an admin already created. The second keeps today's admin-controlled access model.

This is separate from the **OAuth 2.1 server** in section 6. That one lets AI apps such as Claude and ChatGPT sign in *to* Ember. It is built into Supabase Auth, so there is no third-party OAuth service to choose; the only decision is whether to switch it on.

## 4. Apply Ember's migrations to a new stack

Ember has 129 migrations in `supabase/migrations/`, all correctly named for the Supabase CLI. **They have never been applied in order to an empty database:** the existing cloud project was built by hand in the SQL Editor and with `scripts/run-migrations.mjs`, so there is no CLI migration history and no `supabase/config.toml`.

Do this on **lab first**:

1. Open an SSH tunnel to the VM (runbook Step 8).
2. Apply all migrations in filename order, for example `supabase db push --db-url <session-mode connection string>`.
3. Expect a few files to fail on a clean apply (non-idempotent `create policy`, or "fix" migrations that assume an earlier hand-applied state). Fix each one as a corrected migration in the repo. Never edit the database by hand to get past it.
4. Run `supabase/migration_status_check.sql` and confirm every check passes.
5. Seed lab with synthetic data only (`npm run db:seed-kbs`, `npm run db:seed-users`), per the runbook's data rule.
6. **Rebuild the vector index after loading data.** `kb_vectors_embedding_idx` is an `ivfflat` index (`lists = 100`), which computes its clusters when it is built. Built on an empty table, as on a fresh stack, it gives poor search results. After seeding lab, and again after loading prod data (section 5), run `reindex index kb_vectors_embedding_idx;`.

Once lab applies cleanly from an empty database, use the same command for prod and for every later release.

> Any new migration that creates a table must end with `select apply_oauth_read_only_policies();`. A test enforces this (`src/lib/mcp/read-only-migrations.test.ts`).

## 5. Move existing data to prod (one time)

The runbook builds empty stacks. Ember already has live data in the Supabase cloud project `cstuqporwuhkuysydxyc`, and that data belongs on **prod only**, never lab.

1. Announce a maintenance window and stop writes. Pausing the Vercel deployment is enough.
2. Dump the cloud project's `auth`, `public` and `storage` schemas (data and schema), using the cloud connection string.
3. Restore into prod after the migrations have created the schema, or restore schema and data together and then run `migration_status_check.sql`. Choose one approach and rehearse it on a throwaway VM first, as in the runbook's restore test.
4. Copy the Storage objects from the cloud project's buckets into the prod Zadara bucket, keeping the same bucket names and object paths, because the database stores those paths.
5. Run `reindex index kb_vectors_embedding_idx;` (section 4, step 6).
6. Point Vercel Production at prod (section 1), redeploy, and smoke-test: sign in, open a Project, view the uploaded logo and a blog image, upload a document, ask Ember a question.
7. Keep the cloud project read-only for at least two weeks as a fallback, then retire it.

Passwords carry over with the `auth` schema. Everyone has to **sign in again**, because the new stack signs sessions with different keys.

Escalate to Mike on any role or permission error during the dump or restore (runbook rule).

## 6. External MCP server (optional, needs sign-off)

Ember's read-only MCP connection for Claude and ChatGPT (`docs/guides/ember-mcp-oauth-setup.md`) relies on Supabase Auth's **OAuth 2.1 server**. On Supabase cloud that is a dashboard toggle. On self-hosted it is configuration on the `auth` service, which is a change to `docker-compose.yml` beyond runbook Steps 4–5, so **ask Mike first**.

1. Confirm the auth image in the pinned `self-hosted/v*` release includes the OAuth server, using the Supabase Auth release notes. If it does not, leave `EMBER_MCP_ENABLED` unset. The rest of Ember is unaffected.
2. Enable the OAuth server on the `auth` service with:
   - **authorization path:** `/oauth/consent`
   - **dynamic client registration:** on

   Take the exact `GOTRUE_*` variable names from the release notes for that version. They are not listed here because they have changed between releases.
3. Confirm Caddy and the gateway expose the discovery document. One of these must return JSON containing `authorization_endpoint`, `token_endpoint` and `registration_endpoint`; Ember tries both (`src/lib/mcp/discovery-metadata.ts`):
   - `https://<api-domain>/.well-known/oauth-authorization-server/auth/v1`
   - `https://<api-domain>/auth/v1/.well-known/oauth-authorization-server`
4. Continue from step 3 of `docs/guides/ember-mcp-oauth-setup.md`.

## 7. Studio access

Ember's API must stay public (section "What Ember needs"). Studio is served from the same domain behind basic auth only. **Recommendation:** restrict Studio's paths to office/VPN IPs in the Caddyfile and leave `/auth/v1`, `/rest/v1` and `/storage/v1` public. This is the runbook's open question in Step 4; get Mike's approval before changing the Caddyfile.

## 8. Backups: include Storage

The runbook's `backup.sh` dumps the database only. Uploaded files (branding, blog media, documents) live in the Zadara Storage bucket. Turn on **versioning** (or replication) for `sandz-ember-<env>-storage` as well, so a deleted or overwritten file can be recovered.

## 9. Vercel region

`vercel.json` pins Ember's functions to **`hkg1` (Hong Kong)**, the Vercel region generally closest to the Philippines. Each page checks the user with Supabase and then makes several more database calls, so this round trip matters.

After prod is up, compare the two candidates. Open a Project page several times and note the function duration in Vercel's Observability view. Then deploy a preview with `"regions": ["sin1"]` against the same stack and repeat. If Singapore (`sin1`) is consistently faster from the Zadara site, change `regions` in `vercel.json`.

## 10. AI processing stays outside Zadara

Moving Supabase moves **stored data** to Zadara. Ember's AI calls still go from Vercel to the configured providers (OpenAI, Gemini and others).

- For projects such as Bacolod, set each provider's **maximum sensitivity** in **Admin → AI Config**, and classify sensitive Projects and sources, so incident data is blocked before it reaches an external model.
- When the self-hosted LLM (rollout priority 5) is available, register it as an **OpenAI-compatible provider** with a **Restricted** ceiling. Ember then routes sensitive material to it.

## Acceptance additions for Ember

Add these to the runbook checklist for each Ember environment:

- ☐ Vercel environment variables set for this stack (section 1) and a redeploy done
- ☐ Sign in works; a Project page loads; the header logo loads from `https://<api-domain>/storage/...`
- ☐ Password-reset email test passed (section 3); SMTP provider recorded in the client sheet
- ☐ `kb_vectors_embedding_idx` rebuilt after data load (section 4)
- ☐ All migrations applied from an empty database; `migration_status_check.sql` clean (section 4)
- ☐ Admin-created user, Project member added by email, and document upload all work with the secret key
- ☐ Storage bucket versioning on (section 8)
- ☐ (prod only) Cloud data migrated and smoke-tested; cloud project read-only (section 5)
- ☐ (if MCP enabled) Discovery document reachable and an AI app connects read-only (section 6)
