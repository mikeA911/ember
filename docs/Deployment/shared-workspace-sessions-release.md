# Live collaboration: release note and rollout

**Live collaboration** (shared workspace sessions) lets two Project members at different locations work through a Project together from their own browsers:

- one person is in control of the shared view, and the other follows;
- either can ask for control;
- they edit the Project's goal, description and starter prompt, and a Workstream's summary and deliverables, together;
- they ask Ember questions in one shared chat;
- other members can be added as viewers, who watch the session, read the chat and comment.

Plan and design: [shared workspace sessions](../dev-request-shared-workspace-sessions.md). Admin guide: [runbook](../guides/shared-workspace-sessions-runbook.md). Trying it out: [pilot checklist](../guides/shared-workspace-pilot.md).

## What users get

- **Collaborate** on the Project page, or ask Ember: "invite Gil to work on this with me". Ember checks first.
- **A session bar** on every page while live: who's there and connected, who's in control, what's being shown, **Ember chat**, **Connection check**, **Leave** and **End session**.
- **Shared editing** of the Project and Workstream fields above, with explicit Save. A change made outside the session is shown, never overwritten.
- **Shared Ember chat** answered in order, using only sources everyone in the conversation can open. Ember can propose a note or field text for a person to use. Long chats get a summary that can be published as a Project note.
- **Viewers**, added by the pair: they watch, read the chat, and comment. One of the pair can pass a comment on to Ember.
- **History → Shared** in Ember: the conversation, its sessions and its chat stay available afterwards.

What it doesn't do: voice or video, screen sharing, more than two people in control of one session, pages other than the Project and Workstream pages, or anything across Projects.

## Turning it on

There are two switches.

1. **The build flag** (master switch). `NEXT_PUBLIC_EMBER_COLLABORATION=true` in Vercel, per environment, then **redeploy** (it's fixed at build time). Without it, nothing of live collaboration shows, and all data stays as it is.
2. **Where it's on** (Admin → Live collaboration → *Where it's on*):
   - **Every Project** is the default.
   - **Only the Projects below**: an admin turns individual Projects on and off.

   Where it's off, nobody can start a live session there: not from Collaborate, not from Ember, not by resuming. Sessions already live carry on until they end, or an admin ends them. Shared conversations stay readable. Every change is recorded with the admin's name.

### Recommended order for production

1. Apply the migrations, in order, if any aren't yet: `20261023100001`, `20261024100001`, `20261025100001`, `20261027100001`, `20261028100001`, `20261029100001`. Each is additive and safe to re-run.
2. Check the Vercel region is `sin1` (`vercel.json`). From Hong Kong (`hkg1`), Ember's AI calls fail.
3. In Admin → Live collaboration, choose **Only the Projects below** and turn on the pilot Projects. Do this **before** step 4, so turning on the flag doesn't open it everywhere.
4. Set the flag for **Production** and redeploy.
5. Watch Admin → Live collaboration for the first sessions: *Needs attention* and the counts. If something goes wrong, see the runbook.
6. Widen: turn on more Projects, or switch to **Every Project** when ready.

To pull back: turn the Project (or everything) off in *Where it's on*. That stops new sessions straight away, with no redeploy. To remove it completely, unset the flag and redeploy.

## Known limits

- **Polling.** Each person's browser asks for updates every 2 seconds in a session. Changes usually show within 2–3 seconds; on poor connections, longer. Realtime push isn't used yet.
- **Tested so far.** Chromium was tested on simulated slow, lossy and offline networks and a phone screen. Firefox, Safari and real remote locations are the pilot's job.
- **Shared-chat models.** Ember uses the platform's default chat model (or a Sandz-hosted one where a Project requires it), never a builder's own model.
