# Development Request — Ember External MCP Server (read-first, guarded)

**Status:** Proposed — design for review  
**Priority:** P2  
**Public roadmap alignment:** M5 Apply, M7 Govern  
**Builds on:** `src/lib/mcp/tools.ts` (internal tool contract), `src/lib/workbench/identity.ts` (`resolveCallerIdentityFromToken`), `src/lib/ai/sensitivity.ts`, `docs/dev-request-ai-accessible-application-discovery-and-mcp-method-extension.md` (Stage 4), `docs/workbench-handbook-mcp-architecture.md`

## Objective

Let another AI assistant or agent (Claude Code, Claude Desktop, a colleague's agent, an internal automation) connect to Ember over the Model Context Protocol and **look things up** — projects, workstreams, status, approved knowledge, notes, navigation — without becoming a back door around Ember's authorization, approvals or sensitivity policy, and without any path to damage Ember data.

This is the "implement an external transport" step the AI-Accessible Application Discovery request (Stage 4, step 6) deferred until a concrete consumer and authentication design existed. This document is that design.

## What already exists

| Piece | Where | Reuse |
|---|---|---|
| Transport-independent tool contract with zod input/output schemas | `src/lib/mcp/tools.ts` | Pattern reused; **the map itself is not exposed** (it includes `create_project`, `approve_project`, `classify_project`) |
| Bearer-token → `WorkbenchCallerContext` with RLS-scoped client | `src/lib/workbench/identity.ts` | Used as-is — explicitly built for "Phase D's MCP tool layer" |
| Project-scoped knowledge search, workstream list | `src/lib/chat/project-knowledge-tool.ts`, `workstream-list-tool.ts` | Called directly with a server-validated project id |
| Project summary Markdown | `src/lib/projects/status-summary.ts` | Needs its data loader lifted out of `src/app/(app)/projects/[id]/page.tsx` |
| Sensitivity tiers and effective-sensitivity calculation | `src/lib/ai/sensitivity.ts` | Reused to cap what leaves Ember |
| HS256 signing with `jose` | `src/lib/mcp-gateway/delegation.ts` | Same library, same approach for minting short-lived Supabase JWTs |
| MCP SDK | `@modelcontextprotocol/sdk` (already a dependency) | Server side of the transport the Gateway already speaks as a client |

## Design principles

1. **The agent is always a named Ember user, never the service role.** Every tool call runs through that user's RLS-scoped Supabase client. The MCP layer adds restrictions; it can never add access.
2. **Allowlist, not denylist.** A separate external registry lists exactly which tools exist externally. A new internal Ember tool is never exposed by accident.
3. **Read first.** Phase 1 exposes no tool that inserts, updates or deletes anything in Ember's domain tables. Writes arrive later only as drafts that still need a human in the Ember UI.
4. **Narrower than the human.** A key can be restricted to fewer projects, a lower sensitivity ceiling and fewer capabilities than its owner has — never more.
5. **Everything is attributable.** Every call is logged against the key, the user, the tool and the project.

## Architecture

```
External agent ──HTTP (MCP Streamable HTTP)──▶ /api/mcp  (Next.js route handler)
   Authorization: Bearer ember_pat_…                │
                                                     ├─ 1. kill switch + key lookup (hash)  ── agent_access_keys
                                                     ├─ 2. rate limit                      ── mcp_rate_counters
                                                     ├─ 3. mint 5-min Supabase JWT for key.user_id
                                                     │     → resolveCallerIdentityFromToken() → RLS-scoped ctx
                                                     ├─ 4. external tool registry (allowlist)
                                                     │     ├─ scope check (read / draft)
                                                     │     ├─ project allowlist check
                                                     │     ├─ sensitivity ceiling check
                                                     │     └─ handler → existing service function (RLS)
                                                     ├─ 5. output cap + provenance tags
                                                     └─ 6. audit row                        ── mcp_access_log
```

- **Route:** `src/app/api/mcp/route.ts`, stateless `StreamableHTTPServerTransport` (no session affinity; suits Vercel). `POST` only; `GET`/`DELETE` return 405.
- **Registry:** `src/lib/mcp/external-tools.ts` — its own map of tool definitions. Handlers call existing `src/lib/workbench/*`, `src/lib/projects/*`, `src/lib/chat/*-tool.ts` functions. A unit test asserts this file (and anything it imports) never imports `@/lib/supabase/admin`.
- **Server:** `src/lib/mcp/server.ts` builds an `McpServer` per request from the registry, filtered to the key's scopes, so an agent holding a read key never even sees a draft tool in `tools/list`.

## Identity: agent access keys

Users create keys themselves at **Profile → Agent access**.

- Format `ember_pat_<32 random bytes base64url>`; the prefix makes leaked keys findable by secret scanners.
- Shown **once**; stored as SHA-256 hash plus the first 8 characters for display.
- Required name ("Claude Code on my laptop"), required expiry (default 30 days, max 90), revocable instantly.
- Settings per key:
  - **Capabilities:** `read` (default, Phase 1 only option) · `draft` (Phase 2).
  - **Projects:** "all projects I can see" or an explicit list. Enforced by the MCP layer *on top of* RLS.
  - **Sensitivity ceiling:** `public` / `internal` (default) / `confidential`. `restricted` is not offered.
- Anonymous-role users cannot create keys. Deactivating a user (`profiles.is_active = false`) disables their keys immediately via the existing check in `resolveCallerIdentityFromToken`.

**How the key reaches RLS.** After validating the key, the route mints a 5-minute JWT for `key.user_id` (`role: authenticated`, `aud: authenticated`) with `SUPABASE_JWT_SECRET` and passes it to `resolveCallerIdentityFromToken`. RLS then behaves exactly as it does for that user in the browser. The minted token never leaves the server.

> **Open item to verify first:** this requires the project's Supabase JWT signing to be the legacy shared secret (HS256). If the project has moved to asymmetric signing keys, the alternative is Supabase's OAuth 2.1 server with the MCP authorization flow — more setup, but also the long-term target (see "Later").

## Tool surface

### Phase 1 — read-only

| Tool | Returns | Backed by |
|---|---|---|
| `whoami` | Email, platform role, key name, capabilities, project scope, ceiling, expiry | key row + profile |
| `list_my_projects` | id, name, type, status, objective for projects the user is an active member of (filtered to the key's allowlist) | `searchProjects` / `project_members` via RLS |
| `get_project_summary` | The Project summary Markdown (newcomer brief + builder status) | `buildProjectSummaryMarkdown` with an extracted loader |
| `list_workstreams` | id, name, slug, status, goal, deliverable progress | `runListWorkstreams` (+ goal/deliverables) |
| `search_project_knowledge` | Top N approved chunks, 1,500-char cap each, with source title and route | `runSearchProjectKnowledge` |
| `search_wiki` | Approved platform Wiki articles, capped | existing `search_wiki` handler |
| `list_project_notes` | Notes, optionally open/resolved | `listProjectNotes` |
| `get_navigation_guide` | How to do something in Ember's UI | existing handler |

Every result carries `source: "ember"`, the project id and an Ember URL, so the consuming agent can cite and a human can click through.

### Phase 2 — draft-only (requires a `draft` key)

| Tool | Effect | Guardrail |
|---|---|---|
| `add_project_note` | Creates an open note, author = key owner | Body cap; tagged "via agent: <key name>" |
| `attach_workstream_artifact` | Artifact lands as `ready_for_review` / `validation_failed` | Never `approved`; human review in Ember |
| `create_wiki_draft` | Draft Wiki article | Curator+ only (existing check); always `draft` |

Each write tool requires an `idempotencyKey` argument; a repeat within 24h returns the original result instead of creating a duplicate.

### Never exposed

Approvals and reviews of any kind; publishing / unpublishing; project creation, cloning, deletion or status changes; membership, roles, ownership, join-request decisions; access groups, evidence grants, sensitivity classification; admin, AI provider, model and branding configuration; builder credentials and gateway invocations (no agent-to-agent chaining through Ember); bulk export (no "dump every source document" tool); any delete.

## Guardrails

### Access
- RLS is the floor; key scope and project allowlist narrow it.
- Project ids from tool arguments are validated against `(RLS-visible projects) ∩ (key allowlist)` before any handler runs, and the same "not found" error is returned whether the project doesn't exist or isn't allowed — no existence oracle.
- Restricted evidence (`resource_access_policies.classification <> 'project_general'`) stays governed by `has_evidence_access` through RLS; nothing new is needed.

### Sensitivity (data leaving Ember)
An external agent is an unreviewed AI consumer, so the key's ceiling acts like a provider's `max_sensitivity`:
- A project whose `information_sensitivity` exceeds the ceiling is invisible to the key (filtered out of lists, "not found" if named).
- Knowledge hits are run through `getEffectiveSensitivity`; any chunk above the ceiling is dropped and the response says `n results withheld by sensitivity policy`. Unclassified content counts as `internal`, same as today.

### Volume and cost
- Rate limits per key: 30 calls/minute, 1,000/day (configurable). Stored in Postgres (`mcp_rate_counters`), since serverless instances share no memory. Exceeding returns an MCP error with a retry hint.
- Result caps: max 10 hits per search, per-item character caps, summary capped at ~20k characters.
- Embedding calls made on behalf of a key are attributed via `requestedBy: user.id` so existing AI metering sees them.

### Audit
`mcp_access_log`: key id, user id, tool, project id, argument summary (query text truncated to 200 chars, never full payloads), result count, withheld count, status (ok / denied / rate_limited / error), latency, IP, user agent. Admin-client insert only (no client insert policy, same shape as `ai_operation_logs` / `resource_access_audit_log`). Users see their own keys' activity on the Agent access page; admins see everything.

### Prompt injection
Retrieved content is data, not instructions. Tool results wrap content in a labelled field (`untrustedContent`) and tool descriptions say so. With no write tools in Phase 1 there is no way for injected content to change Ember. In Phase 2 every write is a draft a human reviews.

### Operational controls
- **Kill switch:** `EMBER_MCP_ENABLED` env var (off by default) plus an admin toggle in settings; either off → 503 for every call.
- **Admin page:** list all keys, revoke any, "revoke all keys".
- Keys expire; `last_used_at` is updated per call; unused keys are highlighted for cleanup.

## Data model (one migration)

```sql
create table agent_access_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  key_hash text not null unique,
  key_prefix text not null,
  capabilities text[] not null default '{read}',
  project_ids uuid[],                    -- null = all projects the user can see
  max_sensitivity information_sensitivity not null default 'internal'
    check (max_sensitivity <> 'restricted'),
  expires_at timestamptz not null,
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);
-- RLS: owner select/update(revoked_at only); admin select/update. Insert via server action only.

create table mcp_access_log ( ... );     -- no client insert policy
create table mcp_rate_counters ( key_id uuid, window_start timestamptz, count int, primary key (key_id, window_start) );
```

## Connecting an agent

Claude Code:

```bash
claude mcp add --transport http ember https://<ember-host>/api/mcp \
  --header "Authorization: Bearer ember_pat_…"
```

Any MCP client supporting Streamable HTTP with a custom header works the same way. The Agent access page shows this snippet pre-filled after a key is created.

## Testing

- **Unit:** key hashing/format; scope filtering of `tools/list`; project-allowlist and sensitivity filtering; rate-limit windowing; output caps; the "no admin client import" test; every tool's zod schemas.
- **Authorization (adversarial):** non-member project id → not found; project outside allowlist → not found; above-ceiling project → not found; revoked / expired key → 401; deactivated user → 401; read key calling a draft tool → tool not listed and rejected if called anyway; wrong-role caller for `create_wiki_draft` → existing error.
- **RLS integration** (same style as the existing `*-rls.test.ts` files): a minted JWT sees exactly what the same user sees via cookie session.
- **Live:** connect Claude Code to a preview deployment and exercise each tool.

## Delivery sequence

1. Verify Supabase JWT signing mode (decides minted-JWT vs OAuth).
2. Migration + key service (`src/lib/mcp/access-keys.ts`) + Profile → Agent access UI.
3. `/api/mcp` route, external registry, Phase 1 tools, audit log, rate limits, kill switch.
4. Extract the project-summary loader from the project page so both the page and `get_project_summary` use it.
5. Admin key management page; update the Capability and Navigation Catalogue.
6. Phase 2 draft tools, after Phase 1 has run with a real consumer.

## Later

- Replace pasted keys with OAuth 2.1 (MCP authorization spec) so users approve an agent in the browser instead of copying a secret.
- MCP resources (e.g. `ember://project/<id>/summary`) alongside tools.
- Per-organisation policy on who may create keys and the maximum ceiling.

## Acceptance criteria

1. With `EMBER_MCP_ENABLED` off, `/api/mcp` returns 503.
2. A valid read key can list its owner's projects and read summaries, workstreams, notes and approved knowledge — and nothing its owner couldn't see in the browser.
3. No Phase 1 tool changes any row outside `mcp_access_log`, `mcp_rate_counters` and `agent_access_keys.last_used_at`.
4. Project allowlist and sensitivity ceiling are enforced and indistinguishable from "not found".
5. Revoked, expired and deactivated-user keys are rejected immediately.
6. Every call, including denied and rate-limited ones, produces an audit row visible to the key owner.
7. No tool in the "Never exposed" list is reachable, and a test fails if the external registry imports the service-role client.
