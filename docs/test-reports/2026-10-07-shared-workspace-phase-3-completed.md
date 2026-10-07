# Shared workspace sessions, Phase 3 completed: test report

Date: 7 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md#phase-3-completed-7-october-2026). Earlier: [Phase 3](2026-10-06-shared-workspace-phase-3.md).

Everything below ran in a cloud development container against **local, disposable** databases, with a stand-in AI model. The migration (`20261027100001_collaboration_shared_chat_tools.sql`) was then applied to the live backend by the owner on 7 October 2026 and verified (see the end).

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order, and re-runs | Local Postgres 16 + pgvector, all 151 migrations from scratch; the new file applied again on top | Pass |
| Paste-in parts | The two files in `supabase/paste-in/` (about 11,400 and 12,100 characters) applied in order to a database at the previous migration | Functions, grants, policies and columns identical to the full file (hash compared) |
| Generated files | `npm run db:build-sql`; `migration_status_check_recent.sql` on the local build | `20261027100001` applied, 14/14 objects |
| Grants | Short verification query (below) | 13 tables, 89 functions, 42 callable by signed-in users, 41 policies, 2 direct table grants (SELECT on `collaboration_messages` and `collaboration_summaries`, each filtered by its policy); none callable by signed-out visitors |
| Audience check against the **real** policies | `scripts/collaboration-shared-chat-check.mjs` (new check): a Project member outside the conversation who can't open a restricted source | Note/field audience true only when every member can open the evidence; a non-private Project takes no evidence; the caller's identity restored. All 14 checks pass, races 10 rounds |
| Database rules | `src/lib/collaboration/database.test.ts`, 6 new tests (69 in all): proposals stored once on the answer and hidden with it; a note sent once, never taken over, not by viewers or MCP tokens; field text applied/dismissed; the member-wide audience and non-private rule; summaries service-role only, newer only, hidden from a reader who can't open their evidence (`summaryHidden`), handed to the next turn; the messages outside the 30-message window handed over for summarizing; publishing records only your own note | 69 pass. Found and fixed two bugs: the visibility helper wasn't callable from the check that uses it, and a hidden summary couldn't be detected (the reader's own access filtered it out first) |
| Unit tests | `shared-chat-tools.test.ts`, `shared-turn-context.test.ts` | Proposals only to listed members or the team, only for the Project or its own workstreams; summary input leaves out non-common answers and summaries and records the evidence it used |
| Three browsers, real UI | `scripts/local-e2e/collaboration-shared-chat.mjs` with `fake-model.mjs`: 3 new steps (13 in all) | 13/13, three consecutive runs |
| Phase 1 and 2 regression | `collaboration-two-browsers.mjs`, `collaboration-shared-editing.mjs` | 26/26 and 9/9 |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag off | 1902 tests pass; all pass |

New browser steps:

1. Ember proposes a note to the project team; Gil selects **Review and send**, edits the body and sends: the note's author is Gil, it reached the team with his edit, Hana's chat shows "Sent by Gil Guest", and it can't be sent again.
2. Ember proposes a goal; Gil (not in control) is told what he'd need to use it; Hana (in control, on the Project page) selects **Put in shared draft**: the goal field opens with the text, Gil sees "Hana Host is editing", Hana saves, and the goal is saved.
3. After 40 more answered messages, the next answer is followed by a new summary; the summary request didn't contain the restricted answer from earlier (the stand-in's request log); Hana publishes it as a Project note; Vera, the viewer, can read it.

## Not verified

- **A real model**: whether it proposes at the right moments, and summary quality.
- **The live backend, beyond the migration**: applied and verified (below), but not yet used there.
- **Typing over a proposal**: if the person in control has typed into the same field in the same control turn, their typed text stays on their screen instead of the proposed text until they reload the field; the shared draft itself holds the proposal.

## Applied to the live backend (7 October 2026)

The owner ran the two paste-in parts in the Supabase SQL Editor; the verification query below returned `13 | 89 | 42 | 41 | 2`, matching a local full build.

### What the file does

One migration: `supabase/migrations/20261027100001_collaboration_shared_chat_tools.sql`. It adds a `proposals` column to `collaboration_messages` (Phase 3's own table), two `collaboration_*` tables (RLS on; signed-in users may SELECT summaries only through their read policy), `collaboration_*` functions (three callable only by the service role), replaces `collaboration_chat` and `collaboration_chat_state_json` with versions that also carry proposals and summaries, and calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies. It changes no other table and deletes nothing; re-running it is harmless. It needs `20261025100001` (applied).

Paste the two parts in `supabase/paste-in/` in order. Afterwards this should return `13 | 89 | 42 | 41 | 2`:

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
