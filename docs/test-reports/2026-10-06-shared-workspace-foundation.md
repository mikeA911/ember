# Shared workspace foundation: development checkpoint

Date: 6 October 2026. Branch: `codex/shared-workspace-phase0`.

## Implemented scope

First Phase 1 increment: fixed-pair invitations, explicit acceptance, retained shared-conversation list, successive live sessions, one active session per conversation, browser connection leases, request/grant/decline/reclaim control, Project/Workstream location selection, ending/leaving/rejoining and minimal actor-attributed events. Ember History links to the shared list when the feature flag is enabled. Personal chat is hidden on the dedicated collaborative route to avoid confusing personal sends with shared messages.

This is development code. It does not complete Phase 0 or Phase 1's live exit gates, and it does not implement Phases 2–5. The dedicated view currently synchronizes location labels only; it does not mirror the ordinary Project/Workstream page or its forms. The shared conversation is a retained shell, not an AI transcript. Temporary three-second polling is not the planned production Realtime transport.

## Verification performed

| Check | Result |
|---|---|
| `src/lib/collaboration/database.test.ts` | 11 tests passed using real PostgreSQL execution in in-memory PGlite |
| `src/app/actions/collaboration.test.ts` | 4 tests passed for feature gating, input rejection, caller-scoped RPC and error sanitization |
| `src/lib/mcp/tools.test.ts` | 25 existing tests passed, including the navigation-guide tool suite |
| Focused ESLint | Passed for new collaboration modules, route, actions, tests and modified ChatPanel |
| `tsc --noEmit` | Passed |
| `next build` | Passed with Next 16.3.0; `/collaboration` compiled |

SQL tests cover invitation replay and invited-user acceptance; non-member and unrelated-user denial; direct-table read/write denial; retained history for both users; explicit connection admission; observer navigation denial; stale/duplicate control transitions; session-ID and connection-ID binding; cross-Project rejection; membership/profile revocation; invitation/lease expiry; and generation changes on reconnect. They execute the checked-in migration against a minimal referenced base schema, not mocks of the SQL procedure.

The tests never read `.env.local`, contact Supabase, or alter live records. Their resets operate only on the in-memory test database. Application build/type checks ran on desktop Node 24.19.0, while the repository targets Node 22; repeat release validation on Node 22.

## Not verified

- Full migration compatibility against the deployed schema, triggers, grants and RLS policies.
- True concurrent database connections; PGlite's serialized execution does not prove multi-connection lock behavior.
- Two independent authenticated browsers, browser reconnect UX, remote-site latency, or accessibility/visual review of the enabled UI.
- Realtime readiness: the earlier `MissingPartition` result remains unresolved.
- Live migration, feature enablement, deployment, form editing or shared AI execution.

## How to continue

1. Review `20261026100001_collaboration_foundation.sql` against the deployed migration inventory. It only creates collaboration objects; it has not been applied to the live database. No existing policies or tables are replaced.
2. Verify in an isolated application environment where possible. If testing against the authorized shared backend, use additive fixtures and preserve every existing record. Do not run reset/cleanup scripts. Existing test account credentials remain local and must not be committed; that account still needs appropriate Project membership for browser tests.
3. After schema readiness, enable `NEXT_PUBLIC_EMBER_COLLABORATION=true` for the selected development deployment and rebuild. Both users open Ember History → Shared conversations · Collaborate. Test invitation acceptance, distinct browser joins, location changes, handover, second-tab rejection, disconnect/rejoin, end/resume and retained lists. Never treat two tabs sharing one login as two users.
4. Record allow/deny evidence for live revocation, true concurrency and target-network behavior. Resolve the transport choice before calling Phase 1 production-ready.
5. Implement Phase 2 drafts and saves with atomic actor/control/version validation and operation deduplication, then Phase 3's shared AI queue and common-evidence scope. Preserve the explicit later-phase gates in the parent plan.

Keep `CURRENT-ARCHITECTURE.md`, `ROADMAP.md`, the parent plan and Ember's navigation catalogue aligned with each increment. The catalogue is the live source of the `get_navigation_guide` tool; it is not separately seeded to `wiki_articles`.
