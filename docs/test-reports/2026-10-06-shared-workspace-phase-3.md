# Shared workspace sessions, Phase 3: test report

Date: 6 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md#phase-3-as-built-6-october-2026). Earlier phases: [Phase 1](2026-10-06-shared-workspace-phase-1.md), [Phase 2](2026-10-06-shared-workspace-phase-2.md).

Everything below ran in a cloud development container against **local, disposable** databases, with a stand-in AI model. The Phase 3 migration (`20261025100001_collaboration_shared_chat.sql`) is **not applied** to the live backend.

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order, and re-runs | Local Postgres 16 + pgvector, all 149 migrations from scratch; the new file applied again on top | Pass, no errors |
| Paste-in parts | The three files in `supabase/paste-in/` (each under 17,000 characters) applied in order to a database at Phase 2 | Every `collaboration_*` function definition and grant, and every policy, identical to the full file (hash compared) |
| Generated files | `npm run db:build-sql`; `migration_status_check_recent.sql` on the local build | `20261025100001` applied, 26/26 objects |
| Grants | Short verification query (below) on the local build | 11 tables, 79 functions, 35 callable by signed-in users, 34 policies, 1 direct table grant (SELECT on `collaboration_messages`, filtered by its policy); none callable by signed-out visitors; claim/complete/fail callable by the service role only |
| Evidence rules against the **real** access policies | `scripts/collaboration-shared-chat-check.mjs` on the full local schema: restricted evidence granted to two named members, a project-private knowledge base of another Project, project-scoped and platform wiki articles | Each reader sees exactly what the real policies allow; common evidence for pair + viewer is the intersection; removing the viewer widens it; the caller's identity is restored afterwards; only the pair can run the check; a reply built on a restricted source is readable by the pair, hidden from the viewer (through the RPC and reading the table directly), hidden from a member outside the conversation, and hidden from one of the pair once their grant is revoked; a browser can't insert a reply or claim a turn |
| Real concurrency | Same script, 20 rounds: the same question sent twice at once; two runners claiming at once; the same completion twice at once; five questions at once against a queue of three; sequence numbers | One message and one turn; one claim and one "busy"; one reply, both answered; exactly three queued; sequence gap-free |
| Database rules | `src/lib/collaboration/database.test.ts`, 9 new tests (63 in all): asking, idempotent sends, attribution and chat state in the polled snapshot; only from the joined tab, never by a viewer, not after one of the pair leaves; length and queue limits; viewer comments, not answered until passed on, attributed to the passer; one turn at a time, one reply, stale lease refused, failure and asking again; a stopped run retried once then failed; waiting questions cancelled when the session ends; the evidence intersection and hidden replies (with a stand-in read rule); non-readers see nothing, browsers can't run turns, MCP tokens can't post | 63 pass. Found and fixed two bugs: `PERFORM` resetting `FOUND` (a passed-on comment got no turn), and a second queued question's context missing the first answer (answers arrive after later questions; context now places each answer after its question) |
| Context rules (unit) | `src/lib/collaboration/shared-turn-context.test.ts`, `client.test.ts` | Earlier answers on non-common evidence replaced by a placeholder and their text never sent; kept answers' evidence carried to the new answer; passed-on comments attributed to both; reading order puts each answer under its question |
| Three browsers, real UI | `scripts/local-e2e/collaboration-shared-chat.mjs` with `fake-model.mjs` (below) | 10/10 steps, two consecutive runs on the final build (an earlier run failed only step 5, a test artefact: the stand-in remembered the question from the previous run; the question is now unique per run) |
| Phase 1 and 2 regression | `collaboration-two-browsers.mjs`, `collaboration-shared-editing.mjs` on the Phase 3 build | 26/26 and 9/9 steps |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag off | 1884 tests pass; all pass |

### Browser steps

Hana (Project owner) and Gil (Project viewer) in a live session; Vera, a Project viewer, added as the conversation's viewer; each in their own browser context.

1. A live session starts; Vera is added as a viewer.
2. Hana opens **Ember chat** from the bar and asks; Gil sees the question and the answer about 0.85 s after she asked (local stack, stand-in model answering at once); one reply recorded.
3. Gil asks a slow question and Hana another straight after: they run in order, each answer under its question, and the second answer was given both earlier answers as context.
4. Ember searches the Project knowledge; the only tool ever offered to the model in a shared chat was `search_project_knowledge` (checked in the stand-in's request log).
5. A model failure shows to both; Gil selects **Ask again**; answered once.
6. Hana reloads mid-answer: the answer arrives once.
7. Vera opens the conversation page and reads the chat; no chat requests while she reads (6 s); she posts a comment, which appears in Hana's chat; Ember doesn't answer it; she has no **Ask Ember**.
8. Gil selects **Ask Ember to respond**: the answer is labelled "answering Vera Viewer's comment, passed on by Gil Guest"; Vera sees it after **Refresh**.
9. An answer recorded with a source only Hana and Gil may open: Gil sees it with its source link; Vera sees "Hidden — this answer drew on sources you can't open"; Ember's next turn was not given that answer's text (stand-in request log).
10. Gil leaves: Hana's composer is replaced by "Ember answers in this chat while you're both in a live session"; the chat stays on the conversation page.

## Not verified

- **A real model.** Only the stand-in answered. Prompt quality, citation by title and refusal to act need a run on the preview.
- **Retrieval with real vectors.** The local database has no embedded documents, so searches returned nothing; filtering of real hits is covered by the database checks on the same function, not by a browser run.
- **The live backend.** The migration isn't applied.
- **Long answers near the limit.** The Route Handler allows 120 s; a lease is 150 s; a turn still running past that is retried once by the next poll, which can cost a second model call (never a second answer).
- **No conversation summary.** Ember sees the latest 30 messages only.

## Applying to the live backend (needs the owner's go-ahead)

One migration: `supabase/migrations/20261025100001_collaboration_shared_chat.sql`. It adds two `collaboration_*` tables (RLS on), grants signed-in users SELECT on `collaboration_messages` only through its read policy, adds `collaboration_*` functions (three callable only by the service role), replaces the two Phase 2 snapshot functions with versions that also carry the chat's state, and calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies. It changes no other table, policy or function and deletes nothing; re-running it is harmless. It needs the Phase 1 and 2 migrations (applied).

The file is about 39,000 characters, over the SQL Editor's limit, so paste the three parts in `supabase/paste-in/` in order. Afterwards this should return `11 | 79 | 35 | 34 | 1`:

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

Deploy order: apply the migration before deploying the Phase 3 app code. The Phase 2 code keeps working with it applied.
