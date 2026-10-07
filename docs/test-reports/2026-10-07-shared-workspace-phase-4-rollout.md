# Shared workspace sessions, Phase 4 rollout controls: test report

Date: 7 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md#phase-4-rollout-controls-7-october-2026). Release note: [live collaboration](../Deployment/shared-workspace-sessions-release.md).

Run in a cloud development container against **local, disposable** databases. The migration (`20261029100001_collaboration_rollout.sql`) is **not applied** to the live backend.

| Check | How | Result |
|---|---|---|
| Migration applies in order, and re-runs | All 153 migrations from scratch; the new file applied twice on top | Pass |
| Generated files | `npm run db:build-sql`; `migration_status_check_recent.sql` | `20261029100001` applied, 7/7 objects |
| Grants | Short verification query (below) | 16 tables, 100 functions, 51 callable by signed-in users, 50 policies, 2 direct table grants (unchanged); none callable by signed-out visitors |
| Database rules | `src/lib/collaboration/database.test.ts`, 3 new tests (78 in all) | On everywhere by default. In selected mode, an invitation to a Project that isn't on is refused, and allowed once an admin turns the Project on. Turning a Project off refuses accepting a pending invitation (declining still works) while a live session carries on. Only platform admins change it, never with an MCP token, and every change is logged. Found and fixed: setting the mode now never depends on its settings row existing. |
| Ember tool | `src/lib/chat/collaboration-tool.test.ts` | The invitation preview says when it's off, and asks nothing else |
| Browser, admin and Project page | `scripts/local-e2e/collaboration-network.mjs`, new step (8 in all) | An admin chooses *Only the Projects below*: **Collaborate** disappears from the Project page. The admin finds the Project and turns it on: **Collaborate** is back. Changes are logged, and the mode is set back |
| Regression | The other three browser suites | 26/26, 9/9, 13/13 |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag off | See the PR |

Found while testing: the Project page treats a failed rollout check as "off". So code deployed before this migration, or before Supabase's API has reloaded its schema, hides Collaborate everywhere. This is fail-closed and deliberate. Apply the migration first; the release note says so.

## Applying to the live backend (needs the owner's go-ahead)

One file: `supabase/migrations/20261029100001_collaboration_rollout.sql`, about 15,000 characters (one paste).
- It adds three `collaboration_*` tables (RLS on, no grants) and seven functions.
- It replaces `collaboration_invite` and `collaboration_respond_invitation` with versions that also check the rollout.
- It starts in **Every Project** mode, so nothing changes until an admin chooses otherwise.
- It deletes nothing, and re-running it is harmless.

Afterwards this should return `16 | 100 | 51 | 50 | 2`:

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

Deploy order: apply the migration **before** deploying this code.
