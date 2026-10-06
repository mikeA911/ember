# Shared workspace sessions, Phase 1: test report

Date: 6 October 2026. Plan: [shared workspace sessions](../dev-request-shared-workspace-sessions.md). Evidence log: [Phase 0 findings](../design-notes/shared-workspace-phase-0-findings.md).

Everything below ran in a cloud development container against **local, disposable** databases. Nothing touched the shared Supabase backend: no migration was applied there, no rows were written or read. The live database still needs the migration, and that needs the owner's go-ahead (see the end of this report).

## What was tested

| Check | How | Result |
|---|---|---|
| Migration applies in order | Local Postgres 16 + pgvector with a Supabase stand-in (`scripts/local-e2e/supabase-stub.sql`); all 147 files in order | Pass |
| Migration is safe to re-run | Applied `20261023100001` twice more on the fully migrated database; also twice inside the in-memory tests | Pass, no errors |
| Generated files | `combined_migration.sql` applied in one transaction to a fresh database; `migration_status_check_recent.sql` reports `20261023100001` applied, 64/64 objects | Pass |
| Grants | `authenticated` can execute exactly the 21 public `collaboration_*` functions; `anon` none; tables have no client grants (only the read-only MCP restrictive policies) | Pass |
| Database rules | `src/lib/collaboration/database.test.ts`: 43 tests running the migration in in-memory Postgres (PGlite) -- admission, forwarded/expired invitations, direct-table denial, MCP tokens can't write, connection ids never returned, tab take-over, navigation limits, request/grant/decline/withdraw/reclaim, no transfer on disconnect, leave/end/resume, revocation, nothing deleted; and inactivity: away after 10 minutes and back on input, commands count as activity, take control only while the controller is away or disconnected, closed-tab signal, end warnings and both end rules, history never calling an overdue session live, requests lapsing when the requester goes away; viewers (added only by the pair, read-only history and page, never in the live session, removal and lost access); watching (offered without polling, follows with no control functions, never affects the pair's rules or deadline, one tab, stop, only viewers, not while in a session of one's own) | 43 pass. Mutation check: removing the generation bump on take-over makes a test fail |
| Real concurrency | `scripts/collaboration-concurrency-check.mjs` on a local copy, 20 rounds each over parallel connections: duplicate accept; crossing invitations accepted together; handover racing navigation; grant racing reclaim; five tabs taking over at once; taking control from an away host racing the host's reclaim (both orders seen) | 6/6 pass. Mutation check: removing the advisory locks fails the crossing-invitations race |
| Client logic | `src/lib/collaboration/client.test.ts` (shared locations, follow decisions, error hiding, poll schedule, labels) and `src/lib/chat/collaboration-tool.test.ts` (Ember tools: later-turn confirmation, same person, database reason passed on, internals hidden) | 10 + 7 pass |
| Ember tool availability | `src/lib/chat/loop.test.ts`: tools and prompt text only in Project-bound chat with the flag on | Pass |
| Two people and a viewer, three browsers | `scripts/local-e2e/collaboration-two-browsers.mjs`: separate sign-ins in separate browser contexts, real UI, real PostgREST, production build | 26/26 steps pass, three consecutive runs on a freshly built database |
| Whole repository | `vitest run`, `tsc --noEmit`, `eslint`, `next build` with the flag on | All pass |

### Two-browser steps

Hana (Project owner) and Gil (Project role viewer), each signed in in their own browser context, and Vera (another Project member) in a third. Ten minutes of inactivity can't be waited out in a test, so for the inactivity steps the person's recorded last activity is moved back in the local database; everything else is the real UI.

1. Hana: **Collaborate** → Gil → review screen → **Send invitation**; her bar shows "Waiting for Gil Guest".
2. Gil, using Ember, sees the invitation in his bar about 5 s after it was sent; with his tab in the background the title reads "(1) Invitation · …" and is restored when he returns.
3. Gil **Accept** → his browser goes to the Project page.
4. Both bars: live, Hana in control, both connected; Hana sees the acceptance in about 1.3 s.
5. Hana opens a workstream (client-side navigation) → Gil follows in 0.5–0.7 s, page render included.
6. Hana reloads: still in control; no "another tab" conflict.
7. Gil clicks **Projects** in the header → "You've stepped away"; the shared location doesn't move; a reload keeps him where he is; **Follow Hana again** brings him back.
8. Gil **Ask for control** → Hana **Give control** → Gil moves; Hana follows in about 1.9 s.
9. Hana asks for control back → Gil **Decline**.
10. Hana **Take control back**.
11. Gil inactive 11 minutes → Hana's bar: "Gil Guest (away 11 min)"; Gil moves his mouse → back for Hana within about 4 s.
12. Hana (in control) inactive 11 minutes → Gil's bar offers **Take control** (not offered while she was active) → Gil in control, recorded → Hana **Take control back**.
13. Both inactive 26 minutes → both bars: "Nobody has been active for a while — the session ends in 4 minutes" → Hana **I'm still here** → warning gone.
14. Hana opens the conversation page from **Add viewers** in the bar → **Add a viewer** → Vera; both bars show "Viewers: Vera Viewer".
15. Vera, on her dashboard, sees "Hana Host and Gil Guest are live on Harbour Dispatch Upgrade — Watch" without her tab polling the session → **Watch** → her tab goes to the shared page; Hana's bar shows "Vera Viewer (watching)"; Hana moves → Vera follows in 0.7–1.2 s; Vera's bar has no Ask for control, Take control, Leave or End.
16. Vera opens the conversation page: "You're a viewer of this conversation", the pair's names, no resume; her bar says she stepped away → **Follow again** brings her back.
17. Vera **Stop watching** → Hana's bar no longer shows her watching; in the next 6 s her tab makes no session polls (one ordinary status check).
18. Hana opens the Members page → "This page isn't shared"; Gil stays put; Hana returns → Gil follows.
19. Gil opens a second tab → "open in another of your tabs" → **Use this tab instead** → the first tab stands down.
20. Gil **Leave** → Hana's bar says he left → Gil **Rejoin**.
21. Gil closes his tab → Hana's bar says he isn't connected about 2 s later (not 90); a new tab of Gil's joins without a take-over prompt.
22. Hana **End session** → confirmation → both bars say the host ended it → Gil opens the shared conversation from the bar.
23. Gil **Invite Hana Host to resume** → Hana accepts → new session, Gil hosting; the page's list refreshes.
24. Hana inactive 61 minutes → both bars: ended "because one of you was inactive for an hour"; the conversation page says so; Gil resumes again.
25. Gil's membership set inactive in the database → Hana's bar: ended, "no longer has access".
26. Row counts: 3 sessions, 6 participants, 3 invitations -- nothing deleted.

The runs found and fixed six real bugs: an observer who navigated away was pulled straight back (the follow effect fired on their own navigation); the poll that first found a session waited the idle interval, so a fresh page load left that tab 15 s behind; an inviter waited up to 15 s to see an acceptance; an away person's mouse movement wasn't reported straight away (sampling dropped it); the conversation page's session list didn't update when a session started; and pointer movement was sampled only every 15 seconds, so a returning person's movement could be dropped until their tab had learned they were away (now any movement since the last poll counts).

## Not verified

- **The live backend.** The migration isn't applied there, so nothing ran against the deployed schema or the Vercel preview.
- **Remote locations and real networks.** All browsers ran in one container. Latencies above are local; the plan's target (one second at p95 on the pilot network) is unmeasured.
- **Realtime.** Not used; `MissingPartition` wasn't re-investigated (needs read access to the hosted project's Realtime settings and the owner's go-ahead).
- **Supabase Auth itself.** The local gateway stands in for `/auth/v1` and accepts any password; token refresh over a long session wasn't exercised.
- **Ember inviting through chat.** The tools are unit-tested; no model was run.
- **Real background tabs and phones.** Headless test pages are always visible, so the hidden-tab title and the 90-second window were checked by simulating visibility, not with a real backgrounded tab. Mobile browsers may suspend a background tab entirely: it then reads as not connected after 90 s, and as away after 10 minutes.
- **The closing-tab signal across browsers.** Checked in Chromium only; where it doesn't arrive, presence lapses after 90 s instead.

## Applying to the live backend (needs the owner's go-ahead)

One file: `supabase/migrations/20261023100001_collaboration_sessions.sql`. It only adds: seven `collaboration_*` tables (RLS on, no client grants), their indexes, and `collaboration_*` functions, then calls `apply_oauth_read_only_policies()`, which only adds missing read-only policies. It changes no existing table, policy or function and deletes nothing; re-running it is harmless. Afterwards, `supabase/migration_status_check_recent.sql` should report it applied with 64/64 objects. The feature stays invisible until a deployment sets `NEXT_PUBLIC_EMBER_COLLABORATION=true` and is rebuilt.

Then, on the preview, two real accounts that are both active members of one Project should repeat the steps above from two locations.
