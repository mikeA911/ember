# Shared workspace sessions, Phase 4 operations: test report

Date: 7 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md#phase-4-operations-as-built-7-october-2026). Runbook: [operations](../guides/shared-workspace-sessions-runbook.md).

Everything below ran in a cloud development container against **local, disposable** databases, with a stand-in AI model. The migration (`20261028100001_collaboration_operations.sql`) is **not applied** to the live backend.

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order, and re-runs | Local Postgres 16 + pgvector, all 152 migrations; the new file applied twice on top | Pass |
| Generated files | `npm run db:build-sql`; `migration_status_check_recent.sql` on the local build | `20261028100001` applied, 7/7 objects |
| Grants | Short verification query (below) | 13 tables, 96 functions, 47 callable by signed-in users, 41 policies, 2 direct table grants (unchanged); none callable by signed-out visitors |
| Admin functions | `src/lib/collaboration/database.test.ts`, 6 new tests (75 in all) | Only platform admins see the overview, never through MCP tokens, and it carries no message text. Stalled and failed turns, stuck notes and overdue sessions are listed. Ending a session (idempotent) shows "ended_by_admin" to both and is recorded with the admin as actor. Cancelling a running turn stops its late answer, and the pair can ask again. A stuck note is reset to failed and can be sent again. Overdue sessions are settled at once. All pass, first time. |
| Admin view and connection drops, real UI | `scripts/local-e2e/collaboration-network.mjs` | 6/6 on the local, slow, lossy and drops networks |
| Existing suites on poor networks and a phone | `E2E_NETWORK` / `E2E_DEVICE` (below) | See the matrix |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag off | See the end |

### Connection drops and the admin view (`collaboration-network.mjs`)

1. A live session starts (Hana in control).
2. Gil goes offline for 30 seconds while Hana opens a workstream.
   - His bar shows "Connection lost — reconnecting…".
   - Hana still sees him as connected (inside the 90-second window).
   - Back online, his browser follows within **0.1 s**.
   - Control didn't move.
3. Gil goes offline for over 90 seconds.
   - Hana sees him "not connected" and keeps control.
   - Back online, he follows within **about 2 s**.
4. Hana, in control, goes offline.
   - Control stays with her until Gil chooses **Take control**.
   - Back online, Hana follows Gil, then takes control back as host.
   - The take-over is recorded once.
5. Olu, a platform admin, opens Admin → Live collaboration.
   - He sees the session with both connected, and ends it.
   - Both bars say "An administrator ended the live session."
   - The end is recorded with Olu as actor.
6. Hana, not an admin, is sent away from /admin.

### The matrix (Chromium)

`slow`: 400 ms added latency, about 1.5 Mbit/s down. `lossy`: slow, plus a quarter of polls fail. `drops`: only the failed polls. `phone`: a 390 × 844 touch screen.

| Suite | slow | lossy | drops | phone |
|---|---|---|---|---|
| Phase 1, navigation and control (26 steps) | pass | pass | pass | pass |
| Phase 2, shared editing (9 steps) | pass | pass | pass | pass |
| Phase 3, shared chat (13 steps) | pass | @@CHAT_LOSSY@@ | @@CHAT_DROPS@@ | pass |
| Phase 4, connection drops and admin (6 steps) | pass | pass | pass | — |

The poor-network and phone runs found these, all fixed and re-run:

- **Accepting on a dropping connection (bug).** If the poll right after **Accept** was dropped, the invitee's browser fell back to the idle backoff. It stayed put, with the invitation still showing, for 20+ seconds. Now answering an invitation polls at once, removes the invitation from the bar, and keeps the in-session rate until the session arrives.
- **Backoff too eager (bug).** One dropped poll doubled the wait, and a few in a row pushed an idle tab to 20–40 seconds; once, an invitation took 40 s to show. Now a single failure is retried at the normal rate, and backoff starts from the second failure in a row. It reaches at most 10 s in a session or while the person is using Ember, and 30 s otherwise.
- **Back online (gap).** After a dropped connection the next poll could wait out the backoff. Now the browser polls the moment it's back online, and the bar says "Connection lost — reconnecting…" after two failed polls.
- **Shared chat on a dropping connection (bugs).** The chat reloads when the polled version changes. If that one load was dropped, the chat stayed stale, and **Refresh** failed silently. Now a failed load is retried, and **Refresh** tries three times and then says it couldn't.
- **Phones (bugs).**
  - **Collaborate**'s member list opened partly off the left edge.
  - Taps on the chat panel went to the page underneath. It sat inside the sticky bar; it now renders at the top of the page.
  - The Project page's second header row didn't wrap, which made the whole page wider than the screen.
- **The test kit itself.**
  - The local gateway crashed on a request dropped mid-body.
  - A failed run left Gil removed from the Project, breaking the next run. Scripts now restore the seeded memberships first.
  - Waits now scale on simulated networks, and one button lookup was ambiguous.

## Not verified

- **Firefox and Safari.** They can't be installed in the development container. They're left to the pilot, on real devices.
- **Real remote networks.** Only simulated ones were tested. Latency between real locations is a pilot measurement.
- **The live backend.** The migration isn't applied.

## Applying to the live backend (needs the owner's go-ahead)

One migration: `supabase/migrations/20261028100001_collaboration_operations.sql`, about 14,000 characters (one paste).
- It adds admin-only `collaboration_admin_*` functions.
- It replaces the `collaboration_sessions` end-reason rule with one that also allows `ended_by_admin`. Every existing value stays valid.
- It calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies.
- It changes no table's data and deletes nothing. Re-running it is harmless.
- It needs `20261027100001` (applied).

Afterwards this should return `13 | 96 | 47 | 41 | 2`:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'collaboration\_%') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'collaboration\_%') as functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'collaboration\_%'
       and has_function_privilege('authenticated', p.oid, 'execute')) as callable_by_users,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'collaboration\_%') as policies,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name like 'collaboration\_%' and grantee in ('anon', 'authenticated')) as direct_table_grants;
```

Deploy order: apply the migration before deploying this code. The current code keeps working with it applied.
