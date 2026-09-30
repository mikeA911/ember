# Development Request — Ember External MCP Server (read-only, guarded)

**Status:** Proposed — design for review (revised: OAuth sign-in for mobile chatbots)  
**Priority:** P2  
**Public roadmap alignment:** M5 Apply, M7 Govern  
**Builds on:** `src/lib/mcp/tools.ts` (internal tool contract), `src/lib/workbench/identity.ts` (`resolveCallerIdentityFromToken`), `src/lib/ai/sensitivity.ts`, `docs/dev-request-ai-accessible-application-discovery-and-mcp-method-extension.md` (Stage 4), `docs/workbench-handbook-mcp-architecture.md`

## Objective

Builders (and later clients) on the go should be able to ask their favourite AI chatbot — Claude or ChatGPT on their phone — about their Ember projects and get instant, grounded answers: "what's the status of the Zadara onboarding project?", "which deliverables are still open on the ontology workstream?", "what does our approved knowledge say about X?". Ember then needs no dedicated mobile app beyond the existing PWA.

The chatbot connects to Ember as a **remote MCP server**. It must not become a back door around Ember's authorization, approvals or sensitivity policy, and it must have no path to change or damage Ember data.

**First consumers:** the owner and a few colleagues, all builders. **Scope:** read-only.

## Why OAuth, not pasted API keys

Mobile chatbot apps don't let a user paste a custom `Authorization` header into a connector. Claude's custom connectors and ChatGPT's connectors support exactly two options: **no authentication**, or **OAuth 2.1 per the MCP authorization spec** (discovery metadata + dynamic client registration + PKCE). The connector is added once (usually on the web or desktop app) and then works on the phone too.

"No authentication" is out of the question for private project data, so OAuth is the only safe option that meets the goal. It is also safer than pasted keys: the user signs in to Ember in a browser with their normal credentials, sees a consent screen, and no long-lived secret is ever copied around.

## Recommended approach: Supabase Auth as the OAuth server

Supabase Auth can act as an OAuth 2.1 authorization server (dynamic client registration, PKCE, refresh tokens) — built for exactly this "let an MCP client sign in as a Supabase user" case. Ember already uses Supabase Auth, so:

- **No new identity system and no new vendor.** Users sign in with their existing Ember account.
- **The issued access token is an ordinary Supabase user JWT** (`sub` = the Ember user, plus a `client_id` claim identifying the chatbot). It goes straight into `resolveCallerIdentityFromToken`, and RLS applies exactly as in the browser.
- **No JWT-secret minting in Ember**, so it works whether the Supabase project uses the legacy shared secret or the newer asymmetric signing keys.
- Ember only builds two small pieces: the **consent page** Supabase redirects to, and the **protected-resource metadata** that tells the chatbot where to sign in.

Alternatives considered and rejected:

| Option | Why not |
|---|---|
| Pasted personal access keys | Mobile chatbots can't send them. (Could be added later for Claude Code / scripts.) |
| Ember implements its own OAuth server | The most security-sensitive code in the system, written from scratch. Supabase already does it. |
| Third-party identity (Auth0, WorkOS, Stytch) | Extra vendor, and tokens would still have to be mapped to Supabase users for RLS. |
| No-auth server with a secret URL | A secret in a URL leaks through logs and history, and there's no per-user identity. Not acceptable. |

### Sign-in flow

```
Builder (phone or web)          Chatbot (Claude / ChatGPT)         Ember (/api/mcp)          Supabase Auth
        │  "Add connector: https://ember…/api/mcp"                        │                         │
        │ ─────────────────────────────────▶ │ ── unauthenticated call ─▶ │                         │
        │                                    │ ◀─ 401 + resource metadata (points to Supabase) ─    │
        │                                    │ ── register client (DCR) ────────────────────────▶   │
        │ ◀── browser opens Supabase authorize URL ──────────────────────────────────────────────  │
        │ ── redirected to Ember /oauth/consent ─▶ (normal Ember login if needed)                   │
        │     Consent: "Claude wants read-only access to your Ember projects" [Allow] [Deny]        │
        │     Ember checks: user on MCP allowlist? redirect URI on approved list?                   │
        │ ─────────────── approve ─────────────────────────────────────────────────────────────▶   │
        │                                    │ ◀─ code → access + refresh tokens ───────────────    │
        │                                    │ ── tool call, Bearer <Supabase JWT> ─▶ │ verify, RLS │
```

## Guardrails

### 1. Who can connect (allowlist)
- A new `mcp_access_users` table, managed by admins: only listed users can approve a connection. Starts as the owner plus named colleagues. Everyone else sees "Agent access is not enabled for your account" on the consent page and every MCP call from them is rejected.
- Anonymous-role and deactivated users are always refused (the existing `is_active` check in `resolveCallerIdentityFromToken`).

### 2. Which chatbots can connect (redirect-URI allowlist)
Dynamic client registration means anyone can *register* a client, so Ember's consent page only approves clients whose redirect URI is on an admin-maintained list. It starts with Claude (`https://claude.ai/api/mcp/auth_callback`, `https://claude.com/api/mcp/auth_callback`) and ChatGPT (`https://chatgpt.com/connector_platform_oauth_redirect`). A look-alike client with another redirect URI can't obtain a token even if a user is tricked into clicking Allow.

### 3. Read-only at the database, not just in the tools
A Supabase OAuth token is a full user token. If one leaked, it could be sent directly to Supabase's REST API and do whatever RLS lets that user do, including writes, skipping Ember's MCP layer entirely. To close that gap:
- **A restrictive RLS policy on every table** in `public` (and `storage.objects`) for `INSERT`, `UPDATE` and `DELETE`: `(auth.jwt() ->> 'client_id') is null`. Restrictive policies are ANDed with the existing permissive ones, so browser sessions are unaffected, but **any OAuth-issued token is read-only everywhere** by construction. A migration adds it to all current tables in one `DO` block; `migration_status_check.sql` and an automated test fail if a new table is missing it.
- **Audit `SECURITY DEFINER` functions** (16 migrations define some). They bypass RLS, so any that write and are executable by `authenticated` get a guard: raise an error if `auth.jwt() ->> 'client_id'` is set.
- Ember's MCP layer is also read-only (below). Two independent layers.

### 4. Which data the tools can reach
- Every call uses the user's own RLS-scoped client, never the service role. A unit test fails if the external tool registry (or anything it imports) imports `@/lib/supabase/admin`.
- A **separate external tool allowlist** (`src/lib/mcp/external-tools.ts`). The internal Ember map isn't exposed, because it contains `create_project`, `approve_project` and `classify_project`.
- A project the user can't see, or that is filtered out by sensitivity (below), returns the same "not found" error, so there's no existence oracle.
- Restricted evidence stays governed by `has_evidence_access` through RLS.

### 5. Sensitivity: data is leaving Ember for a third-party AI
Answers flow into Anthropic's or OpenAI's consumer apps, which makes them AI providers under Ember's own policy. The design reuses the existing admin-configured `ai_provider_sensitivity_eligibility` table:
- Each approved redirect URI maps to a provider id (claude.ai → `anthropic`, chatgpt.com → `openai`).
- That provider's `max_sensitivity` is the ceiling for the connection (no row → `internal`, the existing safe default). `restricted` is never returned over MCP.
- Projects above the ceiling are invisible. Knowledge hits pass through `getEffectiveSensitivity`, and anything above the ceiling is dropped with a note such as "2 results withheld by your organisation's AI policy".

### 6. Volume
- Rate limits per user + client: 30 calls/minute, 500/day, stored in Postgres (`mcp_rate_counters`) because serverless instances share no memory.
- Max 10 hits per search, per-item character caps, summary capped at ~20k characters. No bulk-export tool.
- Embedding calls are attributed with `requestedBy: user.id`, so existing AI metering sees them.

### 7. Tokens and revocation
- Short-lived access tokens (Supabase default 1 hour), refreshed by the chatbot.
- **Profile → Connected AI apps** lists the user's connections with last-used time and a Disconnect button, which revokes the Supabase grant. An Ember-side `mcp_revoked_clients` check on every call makes disconnection take effect immediately, not when the access token expires.
- Removing someone from `mcp_access_users` cuts them off on the next call.
- **Kill switch:** `EMBER_MCP_ENABLED` env var (off by default); when off, every call returns 503.

### 8. Audit
`mcp_access_log` records user id, OAuth client id and name, tool, project id, a short argument summary (queries truncated to 200 characters), result and withheld counts, status (ok / denied / rate_limited / error), latency and user agent. Inserts use the admin client only, with no client insert policy (same shape as `ai_operation_logs`). Users see their own activity; admins see everything.

### 9. Prompt injection
Retrieved content is returned in a labelled `untrustedContent` field, and tool descriptions tell the chatbot it is reference data, not instructions. With no write path at either layer, injected text cannot change Ember.

## Tool surface (Phase 1, read-only)

Designed around phone-sized questions: short, summarised answers that link back to Ember.

| Tool | Returns | Backed by |
|---|---|---|
| `whoami` | Email, role, connected app, sensitivity ceiling | profile + token claims |
| `list_my_projects` | id, name, type, status, objective for the user's active projects, above-ceiling ones hidden | `project_members` via RLS |
| `get_project_summary` | The Project summary Markdown (newcomer brief + builder status) | `buildProjectSummaryMarkdown` with its loader lifted out of `src/app/(app)/projects/[id]/page.tsx` |
| `list_workstreams` | Name, status, goal, deliverable progress, artifact counts | `runListWorkstreams` + workstream fields |
| `search_project_knowledge` | Top approved chunks (1,500-character cap) with source title and Ember link | `runSearchProjectKnowledge` |
| `search_wiki` | Approved platform Wiki articles, capped | existing `search_wiki` handler |
| `list_project_notes` | Open or resolved notes | `listProjectNotes` |
| `get_navigation_guide` | How to do something in Ember's UI | existing handler |

Every result includes an Ember URL, so the builder can tap through to the PWA for anything that needs action.

**Never exposed:** approvals and reviews; publishing; project creation, cloning, deletion or status changes; membership, roles and join-request decisions; access groups, evidence grants and sensitivity classification; admin, AI provider, model and branding settings; builder credentials and gateway invocations; bulk export; any delete.

## Components to build

| Component | Path |
|---|---|
| MCP endpoint (stateless Streamable HTTP, `POST`) | `src/app/api/mcp/route.ts` |
| Protected-resource metadata (points clients to Supabase Auth) | `src/app/.well-known/oauth-protected-resource/route.ts` |
| OAuth consent page (allowlist + redirect-URI checks, Allow/Deny) | `src/app/(auth)/oauth/consent/page.tsx` |
| External tool registry + per-request server | `src/lib/mcp/external-tools.ts`, `src/lib/mcp/server.ts` |
| Token verification, allowlist, revocation, rate limit, audit | `src/lib/mcp/access.ts` |
| Project summary loader (shared with the project page) | `src/lib/projects/summary-loader.ts` |
| Profile → Connected AI apps; Admin → Agent access | components under `src/components/profile`, `src/components/admin` |
| Migration: `mcp_access_users`, `mcp_redirect_uris` (+ provider mapping), `mcp_revoked_clients`, `mcp_access_log`, `mcp_rate_counters`, restrictive no-write policies | `supabase/migrations/2026100…_external_mcp.sql` |

## Prerequisites / setup

1. **Upgrade `@supabase/supabase-js`** from the pinned `2.45.4` to a release with the `auth.oauth` consent APIs, or call the Auth REST endpoints directly from the consent page if the upgrade is risky. Run the full test suite either way.
2. **Enable the OAuth 2.1 server** in the Supabase dashboard (Authentication → OAuth Server). Turn on dynamic client registration and set the authorization URL path to `/oauth/consent`.
3. Set `EMBER_MCP_ENABLED=true` on the deployment only once the steps above are verified on a preview.

## Connecting (for builders)

- **Claude (web, desktop, mobile):** Settings → Connectors → Add custom connector → `https://<ember-host>/api/mcp` → sign in to Ember → Allow. It then works on the phone too.
- **ChatGPT:** add the same URL as a connector (developer mode or workspace connector, depending on plan), then sign in and Allow.
- **Claude Code:** `claude mcp add --transport http ember https://<ember-host>/api/mcp`, then `/mcp` to sign in.

## Testing

- **Unit:** scope and allowlist checks, redirect-URI validation, sensitivity filtering, rate-limit windows, output caps, the "no admin client import" test, and zod schemas for each tool.
- **Adversarial:** user not on the allowlist → refused at consent and at call time; unapproved redirect URI → consent refuses; non-member project id → not found; above-ceiling project → not found; revoked client, expired token or deactivated user → 401.
- **Database read-only guarantee:** with an OAuth-issued token, direct PostgREST `insert`/`update`/`delete` against representative tables and storage fails, and each writing `SECURITY DEFINER` RPC raises. A browser-session token still writes normally.
- **Live:** connect Claude on a phone to a preview deployment, run through each tool, then disconnect and confirm the next call fails.

## Delivery sequence

1. Enable the Supabase OAuth server on a preview/branch project and upgrade `supabase-js`.
2. Migration: allowlist and redirect tables, audit, rate limits, restrictive no-write policies, `SECURITY DEFINER` guards, plus tests.
3. Consent page and protected-resource metadata; prove the sign-in round trip with Claude.
4. `/api/mcp` with `whoami` and `list_my_projects`, then the remaining Phase 1 tools, audit and rate limits.
5. Profile → Connected AI apps; Admin → Agent access (allowlist, redirect URIs, activity).
6. Pilot with the owner and colleagues; update the Capability and Navigation Catalogue.

## Later

- Clients (not just builders) via the same allowlist, possibly with a narrower default ceiling.
- Draft-only write tools (note, artifact for review, Wiki draft). This would require relaxing the restrictive policy for specific tables, deliberately, per tool.
- Personal access keys for scripts and CI, which can send headers.
- MCP resources (for example `ember://project/<id>/summary`).

## Acceptance criteria

1. With `EMBER_MCP_ENABLED` off, `/api/mcp` returns 503.
2. An allowlisted builder can add Ember as a connector in Claude (web and mobile) and ChatGPT, sign in with their Ember account, and ask about their projects.
3. A user not on the allowlist, or a client with an unapproved redirect URI, cannot complete sign-in.
4. The chatbot sees nothing the user couldn't see in the browser, and nothing above the provider's sensitivity ceiling.
5. An OAuth-issued token cannot insert, update or delete any row or storage object, whether through the MCP tools or directly against Supabase.
6. Disconnecting in Ember, or removal from the allowlist, takes effect on the next call.
7. Every call, including denied and rate-limited ones, produces an audit row visible to the user and admins.
