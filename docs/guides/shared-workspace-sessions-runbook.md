# Shared workspace sessions: operations runbook

For platform administrators running live collaboration (shared workspace sessions, [plan](../dev-request-shared-workspace-sessions.md)). It covers what to watch, what to do when something is stuck, and what the people in a session see. Every action here is a recorded status change. Nothing is ever deleted.

## Where to look

**Admin → Live collaboration** (shown only where `NEXT_PUBLIC_EMBER_COLLABORATION=true`). It loads when you open it; select **Refresh** for the latest. It shows names and statuses, never what people typed or what Ember answered.

- **Live sessions.** Each live session shows:
  - the Project (linked to the shared conversation) and both people, each marked connected, away or not connected;
  - who is in control, when it started and when it ends on its own, and why (`inactive`, `participant inactive` or `expired`);
  - how many viewers are watching, whether Ember is answering or has questions waiting, and how many unsaved drafts there are.

  A session past its deadline is highlighted. It ends at its next poll anyway.
- **Needs attention.**
  - Stalled Ember answers: running past their lease, or waiting over 2 minutes with nothing running.
  - Proposed notes stuck "sending" for over 5 minutes.
  - Failed Ember answers in the chosen period, with the reason.
- **In this period** (24 hours, 7 or 30 days): invitations by outcome, sessions started and ended (by reason), control changes, field saves, abandoned drafts, Ember answers by outcome and retries, answer time (median and 90th percentile), viewer comments, summaries written and proposed notes sent.

The same data is available to an admin from the SQL Editor: `select collaboration_admin_overview(24);`. It has to run as a signed-in admin through the API, though. In the SQL Editor, which runs as the database owner, query the `collaboration_*` tables directly instead, read-only.

## When something is wrong

| What you see | What to do | What happens |
|---|---|---|
| A session nobody is using, or that must stop now (someone added by mistake, access concerns) | **End session…** then **End session** | Ends for both at their next poll: "An administrator ended the live session." Unsaved drafts are kept as abandoned and never saved. The conversation and its chat stay. Recorded as `ended:ended_by_admin` with you as actor. |
| Several sessions past their deadline | **Settle *n* overdue sessions now** | Ends them with their own reason (inactive, expired…), as their next poll would. |
| A stalled Ember answer | **Cancel it** | The answer becomes "Not answered -- cancelled by an administrator". A run still going can't record its answer afterwards. Either of the pair can **Ask again**. Recorded as `admin_cancelled_turn`. |
| A note stuck "sending" | First check the Project's **Notes**: it may have been sent and only the record didn't finish. Then **Reset to failed**. | The pair sees "Not sent: reset by an administrator…" and can send it again. Recorded as `admin_released_note`. |
| Many failed Ember answers | Read the reasons. "capacity limit" or "couldn't get a response" point to the AI provider: check **AI Config** and **Usage & cost**. A sensitivity message means a provider isn't approved for the Project's classification. | Nothing to undo. People ask again once the cause is fixed. |
| Someone says the chat shows "Hidden — this answer drew on sources you can't open" | Working as designed. That person can't open a source the answer used, often a restricted source, or a viewer was added after the answer. | To change it, change their access to the source (Project → access settings). The answer then shows for them. |
| "Connection lost — reconnecting…" in someone's bar | Their browser can't reach Supabase. Nothing to do on the server. | When they're back online their view catches up within a poll (about 2 seconds). Control never moves because of a dropped connection. After 90 seconds offline they show as "not connected", and the other person may then **Take control** (the host can always take it back). |

## What people see

- **Bar texts after an end:** "The host ended the live session", "An administrator ended the live session", "…ended after 30 minutes with nobody active", "…because one of you was inactive for an hour", "…reached its 12-hour limit", "…no longer has access to this Project".
- **Presence:** connected (polled in the last 90 seconds), away (no input for 10 minutes), not connected (no poll for 90 seconds, or the tab closed).
- **Polling** (browser straight to Supabase): every 2 seconds in a session (10 seconds in a hidden tab); 5 seconds while using Ember outside a session, otherwise 30 seconds. A single failed poll is retried at the normal rate; from the second failure in a row it backs off, up to 10 seconds in a visible session and up to 30 seconds otherwise. It polls at once when the browser comes back online and right after someone answers an invitation.

## Turning it on or off

- The feature flag is `NEXT_PUBLIC_EMBER_COLLABORATION` in Vercel, per environment. It's fixed at build time, so redeploy after changing it.
- Turning it off hides the bar, Collaborate, the shared chat and this admin tab. All data stays and reappears when it's turned back on.
- Database migrations, in order: `20261023100001`, `20261024100001`, `20261025100001`, `20261027100001`, `20261028100001`. Each is additive and safe to re-run. Apply them before deploying the code that needs them.
