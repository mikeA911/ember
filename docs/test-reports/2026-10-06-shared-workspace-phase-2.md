# Shared workspace sessions, Phase 2: test report

Date: 6 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md#phase-2-as-built-6-october-2026). Phase 1: [test report](2026-10-06-shared-workspace-phase-1.md).

Everything below ran in a cloud development container against **local, disposable** databases. The Phase 2 migration (`20261024100001_collaboration_shared_editing.sql`) was then applied to the live backend by the owner on 6 October 2026 and verified (see the end).

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order, and re-runs | Local Postgres 16 + pgvector, all 148 migrations from scratch; the new file applied again on top | Pass, no errors |
| Generated files | `migration_status_check_recent.sql` on the local build | `20261024100001` applied, 13/13 objects |
| Grants | Short verification query (below) on the local build | 9 tables, 57 functions, 25 callable by signed-in users, 27 read-only (MCP) policies, 0 direct table grants |
| Database rules | `src/lib/collaboration/database.test.ts`, 11 new tests (54 in all), both migrations in in-memory Postgres: draft seen by the other person; save trims and writes once; a retried save never saves twice; only the controller, only on the shared page; each field's own permission (viewer: nothing; curator: description, not goal); a handover keeps the draft and refuses the old controller's save; outside change is a conflict, kept text saved only after an explicit rebase; Cancel; deliverables set-to-value, label guard, retries; ending abandons drafts; watchers see drafts without rights; length limit and MCP tokens | 54 pass. Mutation check: removing the conflict comparison fails the conflict test |
| Real concurrency | `scripts/collaboration-concurrency-check.mjs`, 2 new races (8 in all), 20 rounds each: a save racing a handover (both orderings seen: saved first, or refused with the draft kept -- never a stale save); the same save request twice at once (one save, both answered) | 8/8 pass |
| Two browsers, real forms | `scripts/local-e2e/collaboration-shared-editing.mjs` (below) | 9/9 steps, three consecutive runs |
| Phase 1 regression | `scripts/local-e2e/collaboration-two-browsers.mjs` on the Phase 2 build | 26/26 steps |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag off | 1870 tests pass; all pass |

### Two-browser steps

Hana (Project owner) and Gil (Project viewer, later curator), each in their own browser context:

1. Hana invites Gil; a live session starts with Hana in control on the Project page.
2. Hana clicks **+ Add goal** and types; Gil sees "✎ Hana Host is editing — not saved yet" with her text (the finished text 2.5–3 s after she started typing), no editable box, and "Unsaved: Goal" in his bar.
3. Hana **Save goal** → saved once (one save record); both pages show it.
4. Hana edits the goal again; the goal is changed directly in the database meanwhile → Hana's form shows "This was changed outside the session…" with the new saved text, Save disabled, nothing overwritten → **Keep my text** → Save → her text saved.
5. Gil takes control: as a Project viewer he gets no Edit buttons; made a curator, he gets Edit on the description but not on the goal.
6. Gil types a new description and, without saving, gives control back as soon as Hana asks → Hana's form opens with exactly Gil's text → she saves it.
7. On a workstream, Hana ticks "Call flow" → saved at once; Gil sees it ticked about 2 s later, and can't tick.
8. Hana starts a summary and goes back to the Project page → both bars say "Unsaved: Summary (Call intake)"; **End session** warns "Unsaved Summary (Call intake) will not be saved." → ended; the summary stays empty and the draft is kept as abandoned.
9. After the session the ordinary edit forms are back.

The first runs found only test-timing issues (the other browser shows a draft's text before it's saved, so checks now wait for the database). No product bugs surfaced in Phase 2's browser runs; the database tests and races passed first time.

## Not verified

- **The live backend, beyond the migration.** The migration is applied and verified (below), but no session has run there.
- **Remote locations.** Latencies are local; a typed draft reaches the other browser after the 400 ms pause plus up to one 2-second poll.
- **Two people typing.** By design only the person in control types; there's no simultaneous editing of one field, so no merge.
- **Ordinary edits during a session.** Detected at save time as a conflict, as tested; an ordinary edit made *after* a shared save still overwrites without warning, as it always has (no version column was added).
- **The host reclaiming control mid-sentence.** The controller's last ~0.4 s of typing can be lost then (it is sent before a normal handover or leave).

## Applied to the live backend (6 October 2026)

The owner pasted the file into the Supabase SQL Editor. Only its first 20,054 characters ran -- the editor stops at about 20,000 and still reports success when the cut falls between statements -- which left out `collaboration_save_field`, `collaboration_set_deliverable`, the grant/revoke lines and the read-only policy step (check: `9 | 55 | 23 | 21 | 0`). Reproduced exactly on a local copy. The owner then ran the rest of the file (from `collaboration_save_field` to the end, about 6,300 characters; re-runnable), after which the check returned `9 | 57 | 25 | 27 | 0`, matching a local full build. Locally, the same sequence also leaves no collaboration function callable by signed-out visitors. **Paste-in SQL files must stay under 20,000 characters; split longer ones into parts.**

### What the file does

One file: `supabase/migrations/20261024100001_collaboration_shared_editing.sql`. It adds two `collaboration_*` tables (RLS on, no client grants) and `collaboration_*` functions, replaces three Phase 1 collaboration functions (the two snapshots and session ending) with versions that also carry the shared fields, and calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies. It changes no other table, policy or function and deletes nothing; re-running it is harmless. It needs Phase 1's migration, which is already applied.

Afterwards this short query should return `9 | 57 | 25 | 27 | 0`:

```sql
select
  (select count(*) from pg_tables where schemaname = 'public' and tablename like 'collaboration\_%') as tables,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'collaboration\_%') as functions,
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'collaboration\_%'
       and has_function_privilege('authenticated', p.oid, 'execute')) as callable_by_users,
  (select count(*) from pg_policies where schemaname = 'public' and tablename like 'collaboration\_%') as read_only_policies,
  (select count(*) from information_schema.role_table_grants
     where table_schema = 'public' and table_name like 'collaboration\_%' and grantee in ('anon', 'authenticated')) as direct_table_grants;
```

Deploy order: apply the migration before deploying the Phase 2 app code. The Phase 1 code keeps working with it applied.
