# Shared workspace sessions, Phase 1: test report

Date: 6 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md). Evidence log: [Phase 0 findings](../design-notes/shared-workspace-phase-0-findings.md).

Everything below ran in a cloud development container against **local, disposable** databases. Nothing touched the shared Supabase backend: no migration was applied there, no rows were written or read. The live database still needs the migration, and that needs the owner's go-ahead (see the end of this report).

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order | Local Postgres 16 + pgvector with a Supabase stand-in (`scripts/local-e2e/supabase-stub.sql`); all 147 files in order | Pass |
| Migration is safe to re-run | Applied `20261023100001` twice more on the fully migrated database; also twice inside the in-memory tests | Pass, no errors |
| Generated files | `combined_migration.sql` applied in one transaction to a fresh database; `migration_status_check_recent.sql` reports `20261023100001` applied, 45/45 objects | Pass |
| Grants | `authenticated` can execute exactly the 14 public `collaboration_*` functions; `anon` none; tables have no client grants (only the read-only MCP restrictive policies) | Pass |
| Database rules | `src/lib/collaboration/database.test.ts`: 25 tests running the migration in in-memory Postgres (PGlite) -- admission, forwarded/expired invitations, direct-table denial, MCP tokens can't write, connection ids never returned, tab take-over, navigation limits, request/grant/decline/withdraw/reclaim, no transfer on disconnect, leave/end/resume, revocation, idle expiry, nothing deleted | 25 pass. Mutation check: removing the generation bump on take-over makes a test fail |
| Real concurrency | `scripts/collaboration-concurrency-check.mjs` on a local copy, 20 rounds each over parallel connections: duplicate accept; crossing invitations accepted together; handover racing navigation; grant racing reclaim; five tabs taking over at once | 5/5 pass. Mutation check: removing the advisory locks fails the crossing-invitations race |
| Client logic | `src/lib/collaboration/client.test.ts` (shared locations, follow decisions, error hiding, poll schedule) and `src/lib/chat/collaboration-tool.test.ts` (Ember tools: later-turn confirmation, same person, database reason passed on, internals hidden) | 9 + 7 pass |
| Ember tool availability | `src/lib/chat/loop.test.ts`: tools and prompt text only in Project-bound chat with the flag on | Pass |
| Two people, two browsers | `scripts/local-e2e/collaboration-two-browsers.mjs`: separate sign-ins in separate browser contexts, real UI, real PostgREST, production build | 16/16 steps pass, three consecutive runs (one on a database freshly built by `build-db.sh`) |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag on | All pass |

### Two-browser steps

Hana (Project owner) and Gil (viewer), each signed in in their own browser context:

1. Hana: **Collaborate** → Gil → review screen → **Send invitation**; her bar shows "Waiting for Gil Guest".
2. Gil sees the invitation in his bar (up to 15 s: idle polling) → **Accept** → his browser goes to the Project page.
3. Both bars: live, Hana in control, both connected. Hana sees the acceptance in about 1.3 s.
4. Hana opens a workstream (client-side navigation) → Gil follows in 0.5–0.7 s, page render included.
5. Hana reloads: still in control; no "another tab" conflict.
6. Gil clicks **Projects** in the header → "You've stepped away"; the shared location doesn't move; a reload keeps him where he is; **Follow Hana again** brings him back.
7. Gil **Ask for control** → Hana **Give control** → Gil moves; Hana follows in 1.3–1.9 s.
8. Hana asks for control back → Gil **Decline**.
9. Hana **Take control back**.
10. Hana opens the Members page → "This page isn't shared"; Gil stays put for 4 s; Hana returns → Gil follows.
11. Gil opens a second tab → "open in another of your tabs" → **Use this tab instead** → the first tab stands down.
12. Gil **Leave** → Hana's bar says he left → Gil **Rejoin**.
13. Hana **End session** → confirmation → both bars say the host ended it → Gil opens the shared conversation from the bar.
14. Gil **Invite Hana Host to resume** on the conversation page → Hana accepts → new session on the same conversation, Gil hosting; the page's session list refreshes to show it live.
15. Gil's membership set inactive in the database → Hana's bar: ended, "no longer has access".
16. Row counts: 2 sessions, 4 participants, 2 invitations -- nothing deleted.

The first runs found and fixed three real bugs: an observer who navigated away was pulled straight back (the follow effect fired on their own navigation); the poll that first found a session waited the 15-second idle interval, so every fresh page load left that tab 15 s behind; and an inviter waited up to 15 s to see an acceptance.

## Not verified

- **The live backend.** The migration isn't applied there, so nothing ran against the deployed schema or the Vercel preview.
- **Remote locations and real networks.** All browsers ran in one container. Latencies above are local; the plan's target (one second at p95 on the pilot network) is unmeasured.
- **Realtime.** Not used; `MissingPartition` wasn't re-investigated (needs read access to the hosted project's Realtime settings and the owner's go-ahead).
- **Supabase Auth itself.** The local gateway stands in for `/auth/v1` and accepts any password; token refresh over a long session wasn't exercised.
- **Ember inviting through chat.** The tools are unit-tested; no model was run.
- **Background tabs.** Browsers slow timers in hidden tabs (often to once a minute after a few minutes), so a person whose tab is in the background can show as not connected. Control doesn't move because of it.

## Applying to the live backend (needs the owner's go-ahead)

One file: `supabase/migrations/20261023100001_collaboration_sessions.sql`. It only adds: five `collaboration_*` tables (RLS on, no client grants), their indexes, and `collaboration_*` functions, then calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies. It changes no existing table, policy or function and deletes nothing; re-running it is harmless. Afterwards, `supabase/migration_status_check_recent.sql` should report it applied with 45/45 objects. The feature stays invisible until a deployment sets `NEXT_PUBLIC_EMBER_COLLABORATION=true` and is rebuilt.

Then, on the preview, two real accounts that are both active members of one Project should repeat the steps above from two locations.
