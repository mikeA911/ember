# Shared workspace: Phase 0 findings

Updated: 6 October 2026. Working branch: `codex/shared-workspace-phase0`.
Status: source assessment and initial live UI/backend checks complete; collaborative prototype validation outstanding. No application code, migrations, application dependencies or deployment settings were changed by the agent. A PostgreSQL client was installed only in Git-ignored `.tmp` for read-only probes. One new member-level test account and its profile were created with user authorization; no existing application records were modified or deleted.

Parent plan: [Shared workspace sessions](../dev-request-shared-workspace-sessions.md).

## 6 October: Phase 1 built

Phase 1 replaces the prototype; see [the plan](../dev-request-shared-workspace-sessions.md#phase-1-as-built-6-october-2026) and [the Phase 1 test report](../test-reports/2026-10-06-shared-workspace-phase-1.md). New evidence against the proof table below:

- **Control/concurrency (local):** proven on a disposable local Postgres 16 built from all 147 migrations, over real parallel connections -- duplicate accept, crossing invitations, handover racing navigation, grant racing reclaim, and parallel tab take-overs (`scripts/collaboration-concurrency-check.mjs`, 20 rounds each). Previously "Not run".
- **Admission, revocation, expiry (database):** 25 tests against the migration in in-memory Postgres. Browser-level and live-backend runs are still outstanding.
- **Environment:** unchanged -- `MissingPartition` not re-investigated (that needs read access to the hosted project's Realtime configuration and the owner's go-ahead); Phase 1 polls instead.

## 6 October connection and handoff update

**Development supersedes the earlier assessment-only status:** the user subsequently authorized implementation on the existing branch and required architecture, roadmap and Ember navigation-guide updates alongside code. The first foundation now includes an unapplied additive migration, authenticated RPC, opt-in shared-session UI and isolated SQL tests. Application dependencies now include development-only PGlite for those tests. Historical statements below about no code/dependency changes describe the earlier checkpoint, not the current branch.

The foundation uses a dedicated shared location view and temporary polling; it does not yet integrate editable fields or execute shared AI. New code has not changed the live backend. Local SQL evidence covers admission, direct-table denial, history isolation, control generations, browser connection binding, session replacement, expired leases and membership/profile revocation. Multi-connection races, target-browser behavior and deployed-schema compatibility remain unverified; retain the remaining proof matrix as open.

Validation at that checkpoint: 40 selected tests passed (11 SQL, 4 collaboration actions, 25 existing MCP tools), focused lint, TypeScript and the production build passed. That prototype was superseded by Phase 1 (see below); its report stayed on the prototype branch.

- The saved database connection now uses Supabase's session pooler. The supplied `.tmp/prod-ca-2021.crt` allowed TLS certificate verification to pass; disabling verification or changing SSL enforcement was not necessary.
- Agent connection attempts then received authentication failures. The user reset the database password and updated local configuration. The agent did not perform the reset; dependent external consumers of that password have not been audited.
- The user ran the supplied Node/PostgreSQL test from PowerShell and reported `Connection successful: { current_database: 'postgres', current_user: 'postgres' }`. This is user-reported successful connectivity, not an agent-observed catalog inspection. No Realtime partition query succeeded in the recorded agent attempts.
- Realtime's earlier `MissingPartition` error remains unresolved. There is no evidence yet that changing credentials or obtaining the CA fixed it.
- The user requested a coder-facing requirements and phased handoff. The parent plan now records requirement IDs, distinguishes requested scope from proposed defaults, includes Phase 5 voice/transcription, and identifies the next Phase 0 steps. Both documents belong on `codex/shared-workspace-phase0`; no feature code is included.

Next: reproduce the verified read-only connection, inspect Realtime metadata, and then progress through the remaining proof table below. Do not mark Phase 0 complete based on connection setup alone.

## Decision at this checkpoint

The user selected the existing Vercel preview and subsequently confirmed that it intentionally shares the live Supabase backend; no separate Ember Supabase exists. Authenticated browser access now works. Continue with additive, clearly labeled tests only, preserving all existing data. Private-channel Realtime readiness remains unresolved after the initial probe returned `MissingPartition`. The repository provides the right building blocks, but shared chat cannot safely be implemented by copying a conversation ID between browsers or broadcasting the current chat panel.

Do not call Phase 0 complete yet: two-user synchronization, database concurrency, collaborative RLS, revocation and latency tests have not run. Initial connection and personal-history isolation checks are recorded below; they do not validate the proposed collaboration design.

## Live checkpoint after desktop access was established

The user explicitly authorized use of the live backend provided nothing is deleted, and permitted clearly identified chat tests. This supersedes the earlier assumption that a separate lab backend would be available. No production policy changes, schema changes or service resets were performed.

| Check | Observed result | What it establishes |
|---|---|---|
| Browser access | Signed-in administrator reached Project and Workstream pages on the supplied preview in the in-app browser | Both Vercel protection and Ember sign-in passed for that browser session; the separate Chrome tab remained at Vercel login |
| Project UI | Goal/objective controls, personal Working Knowledge and administrative actions coexist on the page | A shared view must deliberately select supported sections rather than mirror all rendered content |
| Workstream summary | Opened editor; observed Save summary and Cancel; cancelled without typing or saving | The existing draft/save UI supports a future adapter; no shared-state behavior was tested |
| Workstream chat | Opened Ember; header resolved to the bound Project; history expanded and listed the existing conversation | The Project-level conversation is reachable from a Workstream; shared history is not implemented |
| Local backend configuration | Required Supabase URL, public key and service key are now present in `.env.local`; host is `cstuqporwuhkuysydxyc.supabase.co` | Connection configuration exists; keys were not printed |
| Backend identity | Read-only API lookup matched the Project ID and name visible in the preview | Corroborates the selected backend; exact deployed commit and schema version remain unverified |
| Fresh test account | Created `test-collaboration-phase0-20261005@kbsandbox.local`, active platform role `member` | Provides an isolated non-admin identity; no Project memberships were added and no existing passwords were reset |
| Test sign-in/profile | Password sign-in succeeded; authenticated account could read its own active member profile | Auth and minimum Ember profile requirements are satisfied through the API; browser login as the test account is not yet tested |
| Personal-history isolation | Authenticated test account's unfiltered conversation-list query returned zero rows | Existing personal chats were not exposed to this new account in this query; this is not a comprehensive RLS audit |
| Realtime transport | Authenticated WebSocket connection opened | Endpoint reachable from the desktop command environment, not yet a two-browser network result |
| Private channel join | Empty random private topic returned `MissingPartition: Realtime was unable to find the expected messages partition` at 2026-10-05 13:43:17 UTC | Private-channel readiness not demonstrated; error must be diagnosed before collaboration tests |

Realtime probe sent no content broadcasts, tracked no presence and subscribed to no database tables. It closed the connection after the join response. Supabase lists `MissingPartition` as an operational error concerning the expected message partition; it is not evidence of correct allow/deny policy behavior. The root cause has not been established. [Supabase error reference](https://supabase.com/docs/guides/realtime/error_codes).

Test account ID: `d2ac33bc-3226-41c3-800d-4edcb5db6966`. Its random password is stored only in Git-ignored `.tmp/collaboration-phase0-test-account.json`; do not copy it into this report, source code or chat. The account was created through the same Auth-admin-plus-profile pattern as the repository scripts, using insert-only operations rather than their reset/upsert behavior. Unlike the normal admin UI path, no Organization Home auto-enrollment was performed: the account has no added memberships. It cannot yet exercise a Project collaboration flow.

Initial runtime tools used built-in Node fetch/WebSocket support; no dependencies or source scripts were added. The workstation reports Node 24 while the repository targets Node 22, so this is infrastructure-probe evidence, not verification of the application build/runtime.

Next infrastructure step: inspect the hosted project's Realtime logs/configuration and partition state using read-only administration access, then decide on a supported remedy. Do not drop/recreate Realtime tables, loosen RLS, apply synthetic migrations or reset services on the live backend as a troubleshooting shortcut. The user's no-deletion instruction remains in effect.

## Product model, incorporating the Ember entry point

There are two distinct objects:

| Object | Lifetime | What users see |
|---|---|---|
| Shared conversation | Persists between meetings | One chat listed in both participants' histories, marked Shared and showing the other person's name |
| Live workspace session | Starts when both join; ends or expires | Current page, shared form draft, controller, connection status and live chat participation |

Start from Project-bound Ember by asking to collaborate with a colleague or using a button. Resolve the person from existing Project members, then require an explicit invitation click. Acceptance creates a new shared conversation; it never shares earlier personal prompts, summaries or history. If a general chat starts this flow, first select a Project. An invitation grants session admission only, not Project membership or evidence access.

Both histories reference the same shared conversation, not separate transcript copies. Multiple successive live sessions can belong to it, with at most one active session at a time. Fix the participant pair for the initial version; changing the pair starts a different conversation.

Ending the live session stops synchronization but keeps authorized history. Initially, opening history alone is read-only; resuming shared AI work requires both to rejoin. Show invitations, live sessions and retained conversations as different states. Per-user read/hidden/archive preferences must not delete the other participant's history.

Both users have their own composer, private until Send. Both can send; accepted messages get server ordering and are processed one at a time. Navigation and form editing use one controller. Chat send rights do not depend on that controller. A read-only AI reply must not navigate both browsers automatically; the current controller can choose its navigation suggestion.

## Source findings and their consequences

| Finding | Source anchor | Consequence |
|---|---|---|
| Conversation and message policies grant access by a single `user_id`, deliberately without an admin bypass | `supabase/migrations/20260818120001_chat_assistant.sql`, policies `conversations_owner` and `chat_messages_owner` | Keep personal tables and policies intact; introduce explicit shared records |
| History queries additionally filter `user_id` and `kind = chat` | `src/lib/chat/conversations.ts`, `listRecentConversations`; `src/app/actions/chat.ts`, history actions | Add a unified history response combining personal and explicitly joined shared chats; a UI flag alone cannot expose the correct records |
| Human display messages contain role/content, not a distinct displayed participant | `src/lib/chat/conversations.ts`, `DisplayMessage` and `toDisplayMessages` | Shared messages need authenticated author IDs and separately resolved display names; preserve initiator identity on AI turns |
| The loop unconditionally sets `pending_turn_started_at` before reading history | `src/lib/chat/loop.ts`, `runAssistantTurn` | This is a recovery indicator, not a lock or queue; two callers could build incompatible histories |
| ChatPanel has client-local input, pending state and stale-turn tracking | `src/components/chat/ChatPanel.tsx`, `performTurn` and state declarations | Local guards cannot coordinate two users; use a durable server queue and authoritative transcript |
| Evidence retrieval uses the caller's authenticated Supabase client | `src/lib/chat/project-knowledge-tool.ts`, `runSearchProjectKnowledge` | Neither participant's normal retrieval scope is sufficient for a shared reply |
| `has_evidence_access(type,id,uid)` explicitly accepts a user, but is only one conjunct of complete read policies | `supabase/migrations/20260825110001_project_evidence_access_enforcement.sql` | Reuse the grant predicate, but also check scope, membership, publication/version rules and active profile for both users |
| Project context includes knowledge-base names, linked article titles and starter prompt | `src/lib/chat/project-context.ts`, `getProjectContext` | Common-access filtering must cover prompt metadata as well as returned search snippets |
| History link resolution rechecks current access, but ordinary response text is rendered from stored content | `src/lib/chat/conversations.ts`, `toDisplayMessages` | Hiding revoked citations alone cannot protect text derived from revoked evidence |
| Summary generation rereads persisted content and resource provenance | `src/lib/chat/summary.ts`, `maybeRefreshSummary` | Shared summaries require their own access/provenance rules, not the personal summary job unchanged |
| The normal loop exposes personal notebook, mutation, web and gateway tools; it can choose a builder's own LLM | `src/lib/chat/loop.ts`, tool assembly and BYOLLM selection | Use a small shared-mode allowlist and deployment-approved models; do not inherit personal credentials or tool availability |
| Goal, objective, starter prompt and summary forms use local state | `src/components/projects/ProjectGoalForm.tsx`, `ProjectObjectiveForm.tsx`, `ProjectStarterPromptForm.tsx`, `WorkstreamSummaryForm.tsx` | Shared form state needs explicit adapters and acknowledged draft revisions |
| Project objective/starter prompt saves use an admin client after a role check; goal uses caller RLS | `src/lib/workbench/projects.ts`, corresponding update functions | Reuse the permission semantics, not a blanket assumption that every save runs under caller RLS |
| Deliverable click reads JSON, flips a boolean and writes the whole array | `src/lib/workbench/workstreams.ts`, `toggleDeliverable`; `DeliverableChecklist.tsx` | A retry can flip back and concurrent writes can overwrite: use explicit desired value, operation ID and resource revision |
| Inspected update functions do not compare an expected resource version | Project and Workstream update functions | Add optimistic concurrency across ordinary and collaborative writers; session locking alone cannot detect external edits |
| Existing RLS-related tests include SQL-text assertions; service tests use fake Supabase clients | `src/lib/chat/conversations-project-binding-rls.test.ts`, `src/lib/projects/evidence-access.test.ts` | These do not demonstrate real database concurrency or deployed RLS; the spike must test both |

Source references describe this checkout, not the deployed schema. The repository contains migrations dated beyond the environment date; no inference is made that those migrations are deployed.

## Decision 1: separate shared storage, common UI

Recommended first implementation: separate shared conversation, participant, message and turn tables, with new collaboration session/draft tables. Keep existing personal storage unchanged. Reuse display components and pure prompt/response helpers where appropriate; introduce an explicit conversation-access abstraction before attempting to reuse the entire personal loop.

Proposed minimum records:

- Shared conversation: Project, fixed pair, title, created/last-message timestamps, access state.
- Participant: authenticated account, accepted membership, per-user history/read preferences.
- Invitation: inviter, invitee, Project, expiry and accepted/declined/cancelled state. Existing Project notes may offer a delivery surface, but the invitation is its own authority and cannot depend on curator-only note creation rules.
- Shared message: conversation, ordered sequence, human author or AI identity, initiating turn, content and complete dependency/provenance references.
- Turn: submitted-by user, unique client request ID, accepted sequence/context, queued/running/completed/failed state, execution lease/generation, reply reference and usage attribution.
- Live session: conversation, host, admitted browser connections, controller connection, lease/control generation, state revision, location and status.
- Draft: session, entity/field allowlist, acknowledged revision, base resource revision, value and expiry.

Keep a controller connection ID as well as account ID: two tabs signed into the controller's account must not become independent simultaneous controllers. Browser IDs are server-bound to authenticated participants, never accepted as proof by themselves.

A history DTO can represent personal/shared kind, ID, title, Project, other participant, last activity and live status. Use it in both the floating panel and Project history. Do not feed shared history into personal journals, memory, knowledge-gap reporting or notebook export until those pathways explicitly support attribution and authorization.

## Decision 2: authoritative transactions with notification-and-fetch

Use short database transactions for admission, control handover, draft updates and domain saves. Realtime sends minimal change hints; clients fetch fresh authorized snapshots. Do not send draft values, route labels, chat text, raw tool output or evidence over Broadcast in the initial prototype.

Why: Supabase documents that channel policies are cached until reconnect or a new JWT, so revoking a database grant does not immediately remove an existing subscriber. Authorization therefore belongs on every content fetch/write. A Broadcast acknowledgment confirms Realtime receipt, not a domain save or the other browser applying it. [Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), [Broadcast acknowledgment](https://supabase.com/docs/guides/realtime/broadcast).

Even content-free hints can reveal activity timing. Validate topic rotation or suppression on session/access changes; never promise that disconnecting an honest UI enforces revocation against a modified client. Define revocation at the server authorization boundary: requests authorized after revocation must fail. Already-delivered data cannot be recalled, and in-flight deliveries need explicit race tests.

The same snapshot API can support low-frequency polling when a socket is unavailable. Measure notification-and-fetch latency before considering direct content events. A fallback should show degraded connectivity and must not bypass normal checks.

### Proposed save transaction

1. Resolve the caller from authenticated server context. Lock the session row.
2. Validate active profiles/memberships, session state, caller connection, controller lease/generation and request ID.
3. Validate supported entity/field, Project binding and the acting user's domain permission.
4. Compare the draft revision and base resource revision; reject conflicts with a recoverable result.
5. Save the domain value, increment revisions, and record the operation result together.
6. Commit; then notify listeners. Clients fetch the committed snapshot. Repeating a request ID returns its recorded result.

Handover locks the same session row. If a save commits first, the new controller inherits its result; if handover commits first, a request with the old generation is rejected. No check-then-save split across separate HTTP calls. Add a database-managed integer resource revision for supported tables so updates from ordinary editing paths also invalidate stale drafts. Avoid holding a database transaction open during AI inference.

## Decision 3: common evidence and a narrow shared assistant

Start with Project-bound Q&A, shared-safe retrieval and navigation suggestions. No personal notebooks, inherited personal summaries, uploads, external gateway actions, membership changes, approvals or auto-publishing in the first shared assistant. Both participants use the deployment-approved model policy; personal BYOLLM selection is excluded initially. Record who submitted the turn and charge/log one execution according to an explicit deployment rule.

Implement a narrow server-side access function taking a validated shared conversation ID. Resolve both participants from the database, not caller-supplied arbitrary user IDs. Check full read eligibility for each candidate before its text reaches the model or either browser. Do not borrow the other user's session token or use an admin client to fetch unrestricted evidence and hope the UI hides it.

`has_evidence_access` is reusable for restricted grants but returns true for unclassified resources: it is not a complete resource authorization function. Common retrieval must also honor Project/KB attachment, strict membership, approved/current versions and applicable platform/public scope. Search within the permitted set before ranking/limiting; filtering one user's top results afterward can incorrectly report that shared knowledge is missing.

Persist dependencies for everything placed in the shared context, including Project metadata, retrieved-but-uncited evidence, previous turns and summary inputs. On access reduction, the conservative initial policy is to suspend content display and new inference for the affected shared conversation until it can be safely revalidated; offer a fresh conversation using current permissions. Do not attempt to redact generated prose by deleting its citation links. Ensure titles and history previews follow the same policy. This proposed fail-closed behavior needs database proof and a clear user-facing explanation.

Human text is an intentional disclosure to the other participant at Send; Ember cannot infer the origin of every pasted sentence. Show the shared audience clearly. Prior private-chat content is never copied automatically.

## Decision 4: durable message ordering, independent of workspace control

Accept each send in a transaction under its real author; deduplicate by conversation, author and request ID. Allocate a stable sequence. Only one turn can be claimed per conversation. Its model context contains completed prior turns and its own accepted message, not later queued messages. UI messages and replies need turn linkage so queued messages are not mistaken for the input to an earlier reply.

Claim work with an expiring worker lease and generation; only the current generation may commit a reply. Explicitly resolve failed/uncertain earlier turns before processing later ones. Worker death, lost provider responses and cancellation must not be represented as successful completion. A provider retry can repeat inference/cost even when exactly one result is committed; do not claim exactly-once external execution.

Before starting a queued turn and before publishing its result, recheck participation and evidence access. If one participant leaves, pause new processing. Read-only control handover may proceed during inference because the turn has a pinned context. Do not inherit action confirmations across senders/controllers. Phase 0 will test queue state with a fake provider first; a production execution host and retry strategy must be validated before Phase 3.

## Confirmed initial field inventory

| Screen | Editable field | Existing authority | Shared adaptation |
|---|---|---|---|
| Project | Goal | Project owner or platform admin | Shared textarea draft, explicit save, version check |
| Project | Objective | Project owner/curator or platform admin | Same; preserve explicit server role check |
| Project | Starter prompt | Project owner/curator or platform admin | Same; next AI turn uses accepted context, not a changing in-flight prompt |
| Workstream | Summary | Project owner/curator or platform admin | Shared draft and explicit save |
| Workstream | Deliverable completion | Project owner/curator or platform admin | Immediate explicit set-value save, operation deduplication, version check |
| Ember | Human messages | Both admitted authorized participants | Separate private composers; attributed accepted messages and ordered turns |

Session admission itself requires actual active Project membership for both, even when an admin could otherwise view the Project. Controls may differ by acting role while the shared content/section remains aligned. Other page sections, artifacts and links must be filtered to the shared scope; simply following the same URL does not ensure both see the same content. Start with explicitly supported sections rather than mirroring an entire role-dependent page.

## Environment evidence and constraints

Observed at the initial read-only checkpoint (superseded where the live checkpoint above records later setup):

- No `node_modules` directory; installed Next.js guides required by AGENTS.md are consequently unavailable.
- No `.env.local` file in the repository root; no Supabase/Ember/Vercel environment-variable names found in the inspected shell environment. Secret values were not printed or searched outside the workspace.
- A package lock, Vitest configuration and manual live integration script exist. The manual script creates real records and makes provider calls; it is unsuitable for a read-only production check.
- `vercel.json` specifies `hkg1`; the deployment guide describes Vercel plus self-hosted Supabase and currently treats Realtime as unused. This is documented topology, not a verified live endpoint.
- Working tree already contained the untracked parent plan and `.codex/`. They were not discarded or committed.

At that initial checkpoint, no packages had been installed, live endpoints contacted, migrations applied or tests run. Documentation was the only edited material. The user selected the existing Vercel preview. Initial browser inventory had no open tabs, no Vercel-specific connector was available, and the checkout had no linked `.vercel` directory or Vercel CLI. Later authentication and live checks are recorded above. An application prototype still requires installed dependencies and the matching Next.js guides before application code is written. No application source code has been edited. The documentation handoff now lives on `codex/shared-workspace-phase0`; keep any subsequent prototype on that separate branch and preserve unrelated workspace changes.

### Vercel lab inspection sequence

Live access observation (5 October 2026): opening the user-supplied preview at `https://ember-ikh3xuf3f-mike-aguilars-projects-8afee8e9.vercel.app/` redirected to Vercel's login page through its SSO flow. The browser is not authenticated to Vercel. The login tab was left open for the user; no credentials were entered, protection settings changed or plugin installed. This establishes an authentication prerequisite, not whether the application or its backend is healthy. App UI, deployment commit, Supabase target and Realtime configuration remain unverified.

1. Open the supplied preview URL and establish whether deployment protection or Ember sign-in requires user interaction. Do not change login or protection settings to gain access.
2. Verify preview identity and commit where exposed. A Vercel preview can still point to a production database; its URL alone does not establish data isolation.
3. Verify the Supabase target through available authorized deployment configuration, without printing keys. The `.env.example` cloud project is documented as holding live data and must not be assumed to be the lab.
4. Inspect current Project/Workstream/chat behavior read-only. Record browser/server versions and schema/service version evidence only where actually exposed; an ordinary app page cannot prove backend configuration.
5. Inventory lab-only synthetic accounts and a fixture Project before any two-account test. If only one authenticated browser context is available, record that limitation rather than treating two tabs as two identities.
6. Before any prototype deployment, read installed framework guides and create the dedicated code branch. Scope new fixtures/migrations to the verified lab. No production environment variables, migrations or deployments are part of this checkpoint.

## Remaining Phase 0 proof, in execution order

| Proof | Setup and experiment | Pass evidence | Current status |
|---|---|---|---|
| Environment | Identify backend; inspect deployed migration/service versions and private-channel capability | Version/config inventory and successful authorized private-channel test | Shared live backend confirmed; WebSocket opened; private join returned MissingPartition; versions unverified |
| Admission and history | Synthetic users A/B in Project P; C not invited; separate personal chats | A/B see the same shared shell; C cannot read it; private chats remain private | Not run |
| Synchronization | Two independent browser sessions on one synthetic form; reconnect and reorder notifications | Matching acknowledged snapshots; missed notifications recover by snapshot fetch | Not run |
| Control/concurrency | Simultaneous handover/save; duplicate request; second tab; outside-session resource edit | One active controller; stale writes rejected; duplicate returns same result; conflicts visible | Not run |
| Revocation | Keep a modified subscriber connected; revoke membership/grants | Content reads/writes fail after revocation; no content broadcast; topic lifecycle behavior recorded | Not run |
| Evidence intersection | Sources readable by A only, B only, both and neither; then revoke a shared grant | Only common eligible content enters prompt; derived history/summary is blocked on revoked dependency | Not run |
| Queue | Fake slow provider; simultaneous sends; worker crash and retry | Stable sequence/author; one committed reply per turn; later messages excluded from earlier context | Not run |
| Remote networks | Two actual remote locations after local proof | Measured navigation/draft latency, reconnect success and explicit degraded state | Not run |

A dedicated database remains preferable for schema/concurrency experiments, but none is available today. On the user-authorized shared live backend, limit tests to additive synthetic records and read-only probes; retain fixtures because the user explicitly prohibited deletion. Unit or SQL-text assertions alone are insufficient. Stub AI calls for future concurrency tests. Do not enable production collaboration or modify production access policies as part of these initial checks.

## Estimate and next checkpoint

Keep the parent plan's 1–2 engineering weeks for Phase 0 and 9–14 weeks for the full initial release as provisional ranges, not a revised commitment. This review does not justify shortening them. Adding the shared history shell to Phase 1 and keeping actual AI execution in Phase 3 preserves an earlier navigation/editing pilot.

The next deliverable is a small isolated prototype plus a proof log for the outstanding rows above. Re-estimate after measuring the authorization, synchronization and queue approach. No approval to release the full feature is implied by starting Phase 0.

## Supporting references

- [Current architecture](../CURRENT-ARCHITECTURE.md)
- [Self-hosted Supabase guide](../guides/ember-on-self-hosted-supabase.md)
- [Project evidence controls](../dev-request-project-evidence-access-controls.md)
- [AI policy/context manifest design](ai-policy-enforcement-service-and-context-manifest.md)
- [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), reviewed 5 October 2026; deployed version still to verify.
- [Supabase Broadcast](https://supabase.com/docs/guides/realtime/broadcast), reviewed 5 October 2026; receipt acknowledgment does not establish domain-state durability.
- [Self-hosted Realtime configuration](https://supabase.com/docs/guides/self-hosting/realtime/config), reference for the later lab inventory.
