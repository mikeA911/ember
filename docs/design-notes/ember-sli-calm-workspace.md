# Ember SLI: the calm workspace

**Status:** steps 1 to 3 built (9 to 11 November 2026); the rest proposed. Design direction for SLI's user interface, from Mike (30 October 2026), with a clickable prototype (an HTML artifact, synthetic data, simulated speech). Waiting for the Sandz team's reactions before it changes the delivery plan.
**Applies to:** Discovery and Marketing screens in Ember SLI ([ADR-0002](../architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md), "UI per audience"; [Discovery design](../dev-request-sandz-sli-discovery-and-triggers.md) §3).
**Does not change:** the tenant, Trigger, permission and history layer built in S2 (`supabase/migrations/20261101100001_*`, `20261101100002_*`). Every action in the conversation goes through the same database functions.

## 1. Idea

A minimalist, chat-first workspace. People talk or type to Ember the way they would talk to a thoughtful colleague. The work (Triggers, the Discovery board, fit checks, papers, candidate lists) appears as **artifacts** beside the conversation only when there is something to look at, then steps away.

The aim is a peaceful experience that makes people more creative instead of stressed.

## 2. Layout

| Area | Behaviour |
|---|---|
| Conversation | One narrow, readable column in the centre. No navigation bar, badges, counters or red alerts. Fixed controls: the input bar, a **View** button and the account menu |
| Artifacts | Slide in from the right when Ember produces or opens something; tabs switch between the conversation's artifacts; **Close** returns to the quiet conversation, and an "Artifacts (n)" chip brings them back. On a phone an artifact opens full screen |
| Home | A greeting, a short "Since you were last here" note (for example "TRG-003 is waiting for a sponsor"), and two or three gentle suggestions drawn from the person's work |
| The view | A background scene behind frosted glass (§6) |

## 3. Principles

1. **Separate creating from judging.** A visible mode shows where the conversation is:
   - *Brainstorming*: Ember collects ideas as notes in an artifact (grouped, for example, into the offer, who it's for, open questions, and a feeling worth keeping). It does not critique.
   - *Testing*: only when the person asks ("let's test this") does Ember produce the fit check, risks and numbers.
2. **One question at a time.** Ember asks one thing, not a form. Raising a Trigger becomes a short exchange and Ember fills in the record.
3. **Ember suggests, the person confirms.** Any change to a record is a small card (for example "Raise this as TRG-005, Market event?") with **Confirm** and **Edit**. Nothing is saved or shared silently. Confirmed cards turn into a quiet "Raised as TRG-005 · in the history" line.
4. **No interruptions.** No pop-ups or alert counts. Changes are summarised once, on Home.
5. **Nothing is lost.** Drafts save themselves, conversations are kept, and reversible actions offer undo.
6. **Quiet visuals.** Soft palette, generous spacing, a reading typeface for papers and notes, slow fades. Motion is removed for people who set "reduce motion". Ember's presence is a single softly breathing ember, not a spinner.
7. **The structured views stay.** "Show me the board" opens the Discovery board as an artifact. People who prefer lists are never forced to chat.

## 4. Speech input

- **Dictation (built 6 November 2026, Ember-wide):** tap the microphone, speak, and the words appear in the input box to read and correct. **It never sends on its own**, so a misheard word cannot become a record. Sent messages show "Spoken · edited by you before sending".
- **Thinking aloud:** a longer mode with a timer and a **Done** button. The person speaks freely; Ember turns the speech into organised notes in an artifact, not a wall of chat.
- **Languages:** English, Filipino and Taglish (Cebuano later). Browser speech recognition handles Taglish poorly, so transcription runs **on the server** through Ember's configured AI providers.
- **Privacy:** audio is treated as confidential. It goes only to providers approved for confidential data (the sensitivity gate), is deleted after transcription, and is never used for training. The transcript is what is kept.

## 5. How it maps to what exists

| Calm workspace | Built on |
|---|---|
| Conversation | Ember's chat loop and tool calls (`src/lib/chat/loop.ts`), with SLI tools that call the SLI functions as the signed-in person |
| Confirmation cards | Structured assistant responses (`src/components/chat/StructuredResponse.tsx`, [dev request](../dev-request-structured-assistant-responses-and-artifacts-panel.md)) |
| Artifacts panel | The conversation artifacts collection from the same dev request |
| Trigger, board, history artifacts | Today's `/sli` pages (`src/app/(sli)/`), turned into artifact views |
| Research on a Trigger (S2 stage 3) | The conversation itself, with the Trigger pinned beside it and the Trigger's Workstream underneath |
| Fit check, concept paper, feasibility | Workstream artifacts from the two Methods (S2 stage 4) |

## 6. The view

Each person can choose what is behind their workspace:

- built-in scenes (a garden house interior, a garden at dusk, morning mist) or **Plain**;
- **their own photo**, uploaded or dropped onto the page;
- **Dim the view** and **Soften** (blur) sliders for busy pictures.

The app samples the picture's brightness and picks light or dark glass and text so the conversation stays readable. The choice is saved with the person's profile; uploaded photos are resized in the browser and stored in a private storage bucket, visible to that person only. Built-in photos must be licensed for use; painted (gradient) scenes need no image files.

## 7. Trade-offs

| Risk | Response |
|---|---|
| People don't know what to ask | Home suggestions and suggested next steps after each reply |
| Running AI cost on every exchange | Accepted for now (Mike, 30 October 2026); measured with Ember's metering. Structured views work without AI |
| Records must stay trustworthy | Confirmation cards, sources on every claim, history on every Trigger, and the same permission checks as the pages |
| Speech mistakes | Dictation is always reviewed before sending; thinking-aloud output lands as notes, not records |
| Glass over photos hurts readability | Brightness sampling, dimming and blur; a Plain option |

## 8. Next steps

1. Share the prototype with the Sandz team and collect reactions, especially to the brainstorm/test split and the voice flow.
2. Then update the Discovery design (§3) and ADR-0002, and rework S2 stage 3 so a Trigger's research is the conversation.
3. Build order: the conversation shell with artifacts panel and confirmation cards on the existing SLI functions; dictation; thinking aloud; the view.

## 9. Built so far

**Step 1 (9 November 2026): the calm workspace for a Trigger** (`/sli/discovery/[code]/workspace`, opened with **Open the calm workspace** on the Trigger page; the classic page stays until the team has reacted).

- The conversation fills the centre: Ember's chat bound to the Trigger's research Project, with always-available mode chips: **Brainstorm** (one question at a time, ideas collected as grouped notes, no judging, saved as "Brainstorm notes" on request), **Test it** (the fit check) and the stage's task (draft the concept paper or the feasibility assessment).
- Artifacts open beside it on request and close again: **Trigger** (summary and stage actions), **Saved** (research by stage, with what is still to write), **Candidates**, **Decision**, **Handoff** and **Colleagues**. A dot marks an artifact waiting for the person. They are the classic page's own components, loaded by the same loader (`src/lib/sli/trigger-view.ts`), so both views always agree. On a phone an artifact covers the conversation until closed.
- **View**: garden at dusk, morning mist, plain, or the person's own photo, with dim and soften; kept on the device for now. Built-in photos are left out until their licensing is clear.

**Step 2 (10 November 2026): Ember proposes, the person confirms; the calm Home.**

- Ember SLI tools in the conversation (`src/lib/chat/sli-tools.ts`), offered to members of an SLI department: **find companies** (read-only), and **propose** a new Trigger, a new company (optionally also as a candidate), a candidate customer, or the person's recommendation. The last two only in a Trigger's research conversation; the Trigger always comes from the conversation's Project, never from the model.
- A proposal is stored (`sli_assistant_proposals`, `20261110100001_sli_assistant_proposals.sql`) with a summary written by the database, not by Ember, and shown as an **Ember suggests** card with **Confirm** and **Not now**. Confirming runs the same SLI function as the pages, as the person; a refusal is kept on the card with the reason and nothing is saved. A confirmed card becomes a quiet line ("Raised as TRG-005 · in the history"), and Ember's own record of the call is updated so the next reply knows what happened. Cards come back as they stand when a conversation is reopened. "Edit" is "tell Ember what to change": it proposes again.
- In a Trigger's workspace, **Find candidates** and **Recommend** chips appear when the person may do those.
- **Home** (`/sli`) is the calm greeting: the person's view, "Good evening, Maria", a few quiet lines of what is waiting (decisions, handoff answers, Triggers waiting for a sponsor), up to two "Continue TRG-…" suggestions, and a general conversation with **Raise a Trigger**, **Find a company** and **Think it through** chips. The classic lists moved to **My work** (`/sli/my-work`).
- The view: the sign-in page's own picture (**Ember**) is now the default scene, and **Hide conversation** in the header (Home and the Trigger workspace) puts the conversation away to show the view; **Show conversation** brings it back as it was.
- Not yet: proposing a handoff, and saving brainstorm notes through a card (Ember still saves them when the person asks, as before).

**Step 3 (11 November 2026): thinking aloud.**

- **Think aloud** beside Dictate in Ember's composer (everywhere dictation works): up to ten minutes, with a timer, **Pause**, **Done** and **Discard**. The recording is cut into two-minute parts, each transcribed on the server while the person keeps talking, always as confidential (only a speech provider approved for confidential material); no audio is kept. A failed part is reported and the rest still goes through.
- The transcript goes to Ember as one message marked `[Thinking aloud · m:ss]` (`src/lib/chat/thinking-aloud.ts`), shown folded ("You thought aloud for 4:12 · Show what you said"). Ember answers with notes under The idea, Who it is for, Open questions, Things to check and Worth keeping, in the person's words, with unsure words marked "(?)", and no critique.
- In a Trigger's conversation, "save the notes" becomes a confirmation card (`save_notes`, `20261111100001_sli_thinking_aloud_notes.sql`); confirming saves them as findings in the Trigger's Research workstream, marked as created by the assistant, so they appear under **Saved**. Brainstorm notes now go the same way. On Home, Ember can offer to raise a Trigger from the notes instead.
- To learn from testers: Taglish accuracy, whether ten minutes is right, and whether the transcript should be saved with the notes (today only the notes are).

Also: a **Feedback** button in the calm headers opens Ember's feedback conversation (report a problem, suggest an improvement, request a feature), and SLI has its own **Profile** page (`/sli/profile`: name, departments, password), since Ember Core's profile isn't reachable for SLI-only members.

**Step 4 (next):** keep the view with the person's profile (a private storage bucket for their photo) rather than on the device.
