# Shared workspace sessions: pilot checklist

A step-by-step run of live collaboration on the **Vercel preview**, with the **real AI model**, by people at **different locations**. It checks what the local tests couldn't: real browsers (Firefox, Safari, phones), real distances and a real model. Record the results in a copy of the [results template](../test-reports/templates/shared-workspace-pilot-results.md).

**Takes:** about 60–90 minutes. **Needs:** two people (A, the host, and B, the guest), ideally a third (V, a viewer), and a platform admin for the last part (can be A).

**Safety:** the preview uses the **live** database. Use a test Project, not a client one. Everything here is additive; nothing is deleted. Notes and field edits made during the run are real, so word them as tests ("Pilot test – ignore").

## Before you start (admin, 10 minutes)

1. **Flag and region.**
   - In Vercel, `NEXT_PUBLIC_EMBER_COLLABORATION=true` must be set for **Preview**.
   - The preview must be deployed from a commit at or after the Singapore change (`vercel.json` `"regions": ["sin1"]`).
   - Check it: approving a source for chunking should no longer fail with "Country, region, or territory not supported".
2. **A test Project.** Create one (or pick a sandbox) with A as owner and B and V as members. Give B the role *viewer* first; you'll change it in step 4.
3. **Something for Ember to find.**
   - Attach a small knowledge base with one or two approved sources everyone may open.
   - Optionally add one source restricted to A and B only. Use Project → Access & Evidence, with a restricted classification granted to A and B.
4. **Live migrations.** Admin → **Live collaboration** opens. If it doesn't load, a migration is missing; see the runbook.
5. **Browsers.** Agree who uses what, so the run covers:
   - Chrome or Edge (desktop);
   - Firefox (desktop);
   - Safari (Mac);
   - one phone (Safari on iPhone or Chrome on Android).

   Switch browsers between sessions if needed.

## The run

In each step, the person named does it and the others watch their own screens. Write **pass / fail / notes** in the template. Times are rough: note anything that felt slow.

### 1. Invitation and joining (A, B)

1. A opens the test Project and selects **Collaborate**, chooses B, then **Send invitation**.
2. B, using Ember on any page, sees the invitation in the bar within about 5 seconds. With Ember in a background tab, it shows as "(1) Invitation" in the tab title.
3. B selects **Accept**. B's browser moves to the Project page, and both bars say **Live**, with A *in control* and both connected.

### 2. Following (A, B)

1. A opens a Workstream page, then goes back to the Project page. B's browser follows each time, within a couple of seconds.
2. B wanders to another page (e.g. Wiki). B's bar says they've stepped away; **Follow again** brings them back.
3. A opens a page that isn't shared (e.g. Members). A's bar says it isn't shared, and B stays on the last shared page.

### 3. Control (A, B)

1. B selects **Ask for control**; A selects **Give control**. B now moves A's view between the Project and Workstream pages.
2. A selects **Take control back**.
3. B closes their tab. Within a few seconds A's bar shows B as *not connected*. B reopens Ember and rejoins.

### 4. Editing together (A, B)

1. A, in control on the Project page, selects **+ Add goal** (or **Edit**) and types. B sees "✎ A is editing — not saved yet" with the text as A types. A selects **Save**.
2. A gives control to B. As a Project *viewer*, B gets no Edit buttons.
3. An owner makes B a *curator* (Project → Members). B can now edit the description but not the goal.
4. B starts editing the description and gives control back without saving. A's form opens with B's text, and A saves it.
5. On a Workstream page, A ticks a deliverable. B sees it ticked within a couple of seconds.

### 5. Ember in the shared chat (A, B, real model)

1. A selects **Ember chat** in the bar and asks a question about the Project. Both see the question (with A's name) and one answer.
   - Note how long the answer took. Did it name the source it used?
2. B asks something, then A asks something straight after. They're answered one at a time, in order.
3. Ask: "Please list the workstreams" and "Who is on this project?". The answers use the real lists.
4. Ask Ember to **propose a note to the project team** summarising the call. A proposal appears under the answer. B selects **Review and send**, edits it, and sends it. The note appears under Project → Notes, with B as its author.
5. A, in control on the Project page, asks Ember to **propose a new goal**. A selects **Put in shared draft**, reviews it, and saves (or Cancels).
6. If you added a restricted source: ask something only it answers. The answer should **not** use it while V is a viewer (step 6). Without V, it may.

### 6. Viewer (V)

1. A adds V as a viewer: open the shared conversation's page (bar → **Shared conversation**), then **Add viewers**.
2. V's bar says A and B are live, with **Watch**. V selects **Watch**, and V's tab follows A's moves, with no controls.
3. V opens the shared conversation page and reads the chat. V posts a comment; Ember does not answer it.
4. B selects **Ask Ember to respond** under V's comment. The answer says it's answering V's comment, passed on by B.
5. V selects **Stop watching**.

### 7. Bad connections (A or B, on a laptop)

1. With A in control, B turns Wi-Fi off for about 30 seconds while A moves to a Workstream. B's bar says "Connection lost — reconnecting…". With Wi-Fi back on, B's view catches up within seconds. Control didn't move.
2. B turns Wi-Fi off for 2 minutes. A sees B as *not connected*, and A keeps control. B comes back and catches up.
3. Optional: B joins from a phone on mobile data while moving between rooms.

### 8. Connection check (everyone, before ending)

1. Each person selects **Connection check** in the bar and then **Copy results**, and pastes the text into the template.
   - Run it on each browser you used, in its own session if you switched browsers.
2. The figures are on that browser's own clock:
   - **Checks with the server:** each round trip to the server.
   - **Others' changes reached you within:** an upper bound on how long the other person's moves and edits took to arrive.
   - **Ember answers:** from asking to the answer appearing.

### 9. Admin (admin)

1. Admin → **Live collaboration** lists the session: both connected, who's in control, Ember state. **In this period** shows the run's counts (control changes, saves, answers, notes sent).
2. Under **Needs attention**, failed or stalled Ember answers would show here. Note any.
3. **End session…** then **End session**. Both bars say "An administrator ended the live session."

### 10. Wrap-up (A, B)

1. Both find the conversation in Ember's **History → Shared**, with the chat and its answers.
2. Optional, for a long chat (40+ messages): **Show summary of earlier messages**, then **Publish as Project note**.

## After the run

- Fill in the template's summary and save it as `docs/test-reports/<date>-shared-workspace-pilot.md` (or send it over and it'll be filed).
- Anything that failed: note the browser, the step, what you saw, and roughly when. Admin → Live collaboration and the session's events give the exact times.
- Nothing needs cleaning up. Test notes and fields can be edited back as usual.
