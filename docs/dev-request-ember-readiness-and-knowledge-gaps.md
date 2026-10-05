# Ember Readiness and Knowledge Gaps

## Status

Stages 1 (admin dashboard changes), 2 (readiness section) and 3 (failure reports and the curator gap queue) built 5 October 2026; Stage 4 (automatic gap detection) proposed. Companion to `docs/dev-request-solution-conformance-and-acceptance-evaluation.md`. Worked example: the `cebu-ng911` Project.

## Problem

AI evaluation (`/evals`, Milestone 3) answers one question: does Ember understand a Project's context well enough to be trusted before it suggests anything? Today that question is answered in the wrong place and seen by the wrong people:

- `/evals` is a top-level navigation item (`src/components/Header.tsx`) and a dashboard tile (`src/app/(app)/dashboard/page.tsx`) for every staff role, which makes Ember read like an AI lab rather than a Project governance workbench.
- Consultants can run active datasets and curators can run, baseline and review. Running evaluations and choosing models are platform decisions.
- A Project team has no simple signal of whether Ember knows enough about their Project, and no place to say "Ember got this wrong" or "Ember could not answer this".
- When Ember cannot answer from the Project's knowledge, that gap disappears into one conversation. Nobody responsible for the knowledge base hears about it.

## Decision

1. **Evaluation operations move to the admin dashboard.** Running evals, comparing models and configurations, marking baselines and reviewing results become platform-admin work under `/admin`, labelled **Ember readiness (AI evaluation)**.
2. **Every Project gets an Ember Readiness section** on its Project page and on the non-admin dashboard. It shows how ready Ember is for this Project, whether more sources are needed, and the open knowledge gaps.
3. **Project teams can report Ember failures** from that section and from any Ember answer.
4. **Ember detects its own knowledge gaps** in Project-bound chat and files them for the Project's curators automatically.
5. **Failures and gaps feed back into evaluation:** a resolved gap or failure can become a test question in the Project's dataset, so the same failure is checked on every future run.

## Readiness section

### Where it appears

- On each Project page, for all members including viewers.
- On the non-admin dashboard, one row per Project the user belongs to.
- On the admin dashboard, across all Projects, with drill-down to runs.

### What it shows

Readiness has two inputs that must stay visibly separate. A single blended number would hide whether it came from judgement or measurement.

| Signal | Source | Example |
|---|---|---|
| **Curator confidence** | A Project curator or platform admin sets a percentage and a short rationale | "70% — NENA i3 and K-Suite sources loaded; Mitel PBX documentation still missing. Set by M. Aguilar, 3 Oct." |
| **Measured score** | Latest admin eval run on the Project's dataset | "12 of 15 test questions passed (80%), run 2 Oct against the default model" |
| **Open knowledge gaps** | Gap and failure reports (below) | "4 open gaps, 2 reported this week" |
| **Knowledge coverage** | Counts already in the Project | Sources approved, Wiki articles, last source added |

A **readiness verdict** sits on top, set by the curator and informed by the signals above:

- **Ready** — Ember can be relied on for this Project's day-to-day questions.
- **Needs more sources** — known gaps; use Ember with care and help close them.
- **Not assessed** — no confidence set and no eval run yet.

Rules:

- The curator confidence and verdict always show who set them and when. They go stale (shown as *review due*) after a configurable period, after a measured-score drop beyond a threshold, or when open gaps exceed a threshold.
- If the measured score and curator confidence disagree by more than a set margin, the section says so rather than picking one.
- Viewers and consultants see the verdict, both signals and gap counts. Only curators and admins can change confidence or the verdict.
- Gap and failure details respect evidence access; a member sees only gaps from conversations and sources they could already see.

**As built (Stage 2, 5 October 2026):**

- **Storage.** `project_ember_readiness` (`20261013100001_project_ember_readiness.sql`) is append-only: any Project member reads it, a Project owner/curator or platform admin inserts as themselves (`can_curate_project`), and there is no update or delete. The newest row is current; the Project page shows up to five earlier ones. The stored verdict is `ready` or `needs_more_sources`; *Not assessed* means no row exists.
- **Measured score.** The latest completed run on any non-archived dataset attached to the Project, as "questions passed of questions asked". A question passes when a human reviewer accepted it; with no review, when the expected evidence was not missed and either the judge's outcome score is at least 0.7 or, with no judge, the expected evidence was retrieved. Members read it, and the knowledge coverage counts, through `project_ember_readiness_signals()`, a `SECURITY DEFINER` function that returns counts only and only for Projects the caller belongs to; the per-result rows stay admin and staff only.
- **Coverage.** Active sources in the Project's own and attached knowledge bases, how many of them have at least one approved (searchable) chunk, approved Wiki articles linked to the Project or held in its knowledge bases, and when the last source was added.
- **Review due.** The curator picks a review period (30, 60, 90 or 180 days; default 90). The judgement is marked *review due* when that date passes or when the measured score falls 15 points or more below the score recorded (server-side, by the insert trigger) when the judgement was set. The open-gaps rule arrives with Stage 3.
- **Disagreement.** Shown when curator confidence and the measured score are more than 25 points apart.
- **Where it shows.** The Project page's **Ember readiness** section (replacing the old *Evals* list; the Project's test-question datasets are linked there for curators), an **Ember readiness** table on every dashboard with one row per Project the viewer belongs to, and a *Curator verdict* column on Admin → Ember readiness.

## Failure reports ("Ember got this wrong")

A Project member can report a failure:

- from a **Report a problem with this answer** action on any Ember answer in a Project-bound conversation; the question, Ember's answer, cited sources and model are attached automatically; or
- from the Readiness section, by typing the question and what went wrong.

Fields: question, what Ember said (auto-filled where possible), what was wrong (`wrong`, `incomplete`, `outdated`, `cited the wrong source`, `could not answer`), the correct answer if known, and a suggested source if known.

Failure reports are **Project-scoped**, routed to the Project's curators. They are not Ember product bugs, so they do not go to the platform-owner feedback board (`feedback_reports`), which stays for problems with Ember itself. A curator can convert a failure report into a feedback report if it turns out to be a product bug rather than a knowledge problem.

## Automatic knowledge-gap detection

### Signal, not string matching

Detection must not rely on matching phrases like "sorry, I can't answer". Wording varies by model and language, and phrase matching is easy to break. Use two structured signals instead:

1. **Ember's own declaration.** Add an optional `knowledgeCoverage` field to the response envelope (`src/lib/chat/response-envelope.ts`):

   ```text
   knowledgeCoverage: {
     status: 'answered' | 'partial' | 'not_in_project_knowledge'
     missingTopic?: string   // short description of what is missing
   }
   ```

   The system prompt instructs Ember to set `partial` or `not_in_project_knowledge` whenever it cannot ground an answer in the Project's approved knowledge.

2. **Retrieval evidence.** In a Project-bound turn, `search_project_knowledge` returned nothing, or nothing above the similarity threshold, for the user's question.

A gap is raised when (1) says `partial` or `not_in_project_knowledge`, or when (2) holds and Ember produced no verified citation. An answer grounded only in web search still counts as a gap in Project knowledge.

### What happens

- A **knowledge gap** record is created for the Project with the question, Ember's `missingTopic`, the turn's retrieval result summary, the model and a link to the message.
- The user sees a short note under the answer: *"This looks like a gap in the Project's knowledge. It has been sent to the Project curators."* with **Edit** (refine the question or add a suggested source) and **Don't send** (withdraws it within the session).
- Similar gaps are **grouped**, using embedding similarity on the question plus `missingTopic`, so ten people asking about Mitel SIP trunking produce one gap with ten occurrences, not ten notifications.
- Curators get a notification for a new gap and a digest for repeat occurrences, not one alert per question.

### Scope limits

- Only in conversations bound to a Project. Unbound chat, feedback conversations and journal conversations never raise Project gaps.
- Never raised for questions outside the Project's purpose (Ember marks these `answered` with an explanation that the question is out of scope).
- The policy gate and evidence access apply. A gap record stores no more of the conversation than the question and Ember's summary, and is visible only to the reporter, the Project's curators and platform admins.

## Curator workflow

A **Knowledge gaps** queue on the Project, combining automatic gaps and failure reports:

1. **Triage:** `new` → `needs_source` / `wiki_needed` / `out_of_scope` / `product_issue` / `duplicate`.
2. **Resolve:** add or approve the missing source (existing source-submission and approval flow), or draft a Wiki article. Link the resolving source or article to the gap.
3. **Verify:** re-ask the original question; record whether Ember now answers it.
4. **Promote to test question (optional):** one click creates a draft eval case in the Project's dataset from the question, the correct answer and the resolving source as expected evidence. A curator reviews it before the next dataset version is activated.
5. **Close:** the reporter is told the gap was resolved and which source now covers it.

Any member may attach a candidate source to a gap; only curators approve it into the knowledge base, as today.

**As built (Stage 3, 5 October 2026):**

- **Storage.** `project_knowledge_gaps` (`20261014100001_project_knowledge_gaps.sql`), one table for failure reports now and automatic gaps in Stage 4 (`origin`). RLS: the reporter and the Project's owner/curators and platform admins can read a gap; any Project member can report, as themselves; only curators update; nothing is deleted. A `BEFORE INSERT` trigger forces a new report to `new` with every curator field empty, and requires a linked conversation to be the reporter's own, bound to the Project, and a linked message to be an Ember answer in it. A `BEFORE UPDATE` trigger stops anyone changing what was reported.
- **Reporting.** **Report a problem** under any Ember answer in a Project conversation. The server takes the question (the last user message before the answer), the answer, its verified citations and the model from the stored conversation; the reporter only picks what was wrong (*Wrong*, *Incomplete*, *Outdated*, *Cited the wrong source*, *Could not answer*) and optionally adds details, the correct answer and a source. The Project page's **Knowledge gaps** section has the same form for reports typed without the answer to hand. The chat turn now returns the saved message id so the report points at the exact answer.
- **Statuses.** Open: `new`, `needs_source`, `wiki_needed`. Closed: `resolved`, `out_of_scope`, `duplicate` (of another gap in the same Project), `product_issue`.
- **Curator queue.** On the Project page, open gaps first, closed ones collapsed. **Triage**, **Resolve** (link one of the Project's sources and/or Wiki articles, add a note, record whether Ember now answers it when re-asked), **Make it a test question** and **It's an Ember problem** (files a feedback report as the curator and closes the gap as `product_issue`).
- **Test questions.** Promotion adds the question to the Project's newest draft dataset, creating `<Project> — Ember test questions` if there is none (active datasets are frozen). The expected answer is the reported correct answer, else the resolution note; the resolving Wiki article becomes expected evidence and the resolving source is named in the scoring criteria. Tagged `knowledge-gap`.
- **Notifications.** Through Project notes (the app's only notification channel): every Project owner/curator on a new report, and the reporter when their report is resolved or closed as out of scope or duplicate. One note per report; the digest for repeated questions comes with Stage 4's grouping.
- **Readiness.** `project_ember_readiness_signals()` now also returns the open-gap count, shown in the readiness section and as an *Open gaps* column on the dashboard table. Five or more open gaps mark the readiness judgement *review due*.
- **Not yet:** members attaching candidate sources directly to a gap (they use the existing **Submit a source** form); cross-Project gap trends on the admin dashboard.

## Admin dashboard changes

- Add **Ember readiness** to `/admin`: the per-Project readiness table, the eval pages currently under `/evals` (datasets, runs, results, baselines, human review), and cross-Project gap trends.
- Remove **Evals** from the main navigation and the dashboard tile for non-admins. Replace the tile with the Readiness section.
- Restrict creating eval runs, marking baselines and human review to platform admins (Server Actions and RLS). Hide the Agent page's **Run evaluation suite** button from non-admins.
- Project curators keep authoring draft cases for their own Projects' datasets, since they know the correct answers. The Project page links to that dataset's case editor, not to runs.

**As built (Stage 1, 5 October 2026):** the eval pages stay at their existing `/evals` routes rather than moving under `/admin`, so existing links keep working; `/evals/runs/*` redirects non-admins and `/evals` shows curators their datasets only. Admin → **Ember readiness** lists every non-archived dataset with its Project, question count and latest completed run, and links into those pages. Activating and archiving a dataset stays with curators. The per-Project readiness columns and cross-Project gap trends arrive with Stages 2 and 3.

## Delivery stages

1. **Admin move** — eval runs, baselines and human review become platform-admin work (Server Actions and RLS); Evals leaves non-admin navigation and dashboards; Admin → Ember readiness. *Built.*
2. **Readiness section** — curator confidence and verdict with history, measured score and knowledge coverage on Project pages and the non-admin dashboard. *Built.*
3. **Failure reports and the curator gap queue** — including promotion of a resolved gap to a draft eval case. *Built.*
4. **Automatic gap detection** — `knowledgeCoverage`, the retrieval signal, grouping and curator notification.

## Data model (indicative)

- `project_ember_readiness` — `project_id`, `confidence_percent` (0–100), `verdict` (`ready` / `needs_more_sources` / `not_assessed`), `rationale`, `set_by`, `set_at`, `review_due_at`. Append-only history; the latest row is current.
- `project_knowledge_gaps` — `project_id`, `origin` (`automatic` / `failure_report`), `question`, `missing_topic`, `failure_kind`, `correct_answer`, `status`, `group_id`, `occurrence_count`, `conversation_id`, `message_id`, `reported_by`, `resolved_by`, `resolved_at`, `resolving_source_id` / `resolving_article_id`, `eval_case_id`.
- `project_knowledge_gap_occurrences` — one row per detected occurrence, for grouping and counts.
- Response envelope: optional `knowledgeCoverage` (backward compatible; absent means not declared).

RLS reuses `is_project_member`, `can_curate_project`, `is_admin` and `has_evidence_access`.

## Scope

### In scope

- Readiness section on Project pages, the non-admin dashboard and the admin dashboard.
- Curator confidence and verdict with history and staleness rules.
- Failure reports from answers and from the Readiness section.
- Automatic gap detection from `knowledgeCoverage` and retrieval signals, with grouping and user opt-out.
- Curator gap queue, resolution linking, verification and promotion to eval case.
- Moving eval operations to `/admin` and restricting run/baseline/review to platform admins.

### Out of scope

- Fetching missing sources automatically from the web or vendor portals.
- Letting a gap or failure report change approved knowledge without curator approval.
- Computing the readiness verdict automatically; it remains a human decision informed by signals.
- Changes to solution conformance evaluation (separate request).

## Acceptance criteria

1. Non-admins no longer see Evals in the main navigation or dashboard; admins reach all eval pages from `/admin`.
2. Only platform admins can create eval runs, mark baselines and record human reviews; Project curators can still add cases to their own Projects' draft datasets.
3. Every Project page and the non-admin dashboard show an Ember Readiness section with verdict, curator confidence (with author and date), measured score (with run date), open gap count and coverage counts.
4. Only Project curators and platform admins can set confidence and verdict; every change is kept in history.
5. Readiness shows *review due* after the configured period, after a measured-score drop beyond the threshold, or when open gaps exceed the threshold.
6. A member can report a failure from any Project-bound Ember answer, with question, answer, citations and model attached automatically.
7. In a Project-bound conversation, an answer with `knowledgeCoverage` of `partial` or `not_in_project_knowledge`, or with empty or low-similarity project retrieval and no verified citation, creates or adds to a knowledge gap.
8. The user sees that a gap was sent, and can edit or withdraw it.
9. Repeated similar questions group into one gap with an occurrence count; curators receive one notification per new gap plus a digest.
10. No gap is created from unbound, feedback or journal conversations.
11. Gap details are visible only to the reporter, Project curators and platform admins, and respect evidence access.
12. A curator can resolve a gap by linking an approved source or Wiki article, re-check the question, and promote it to a draft eval case.
13. Failure reports never appear on the platform-owner feedback board unless a curator converts one.

## Required live validation

### Readiness display (`cebu-ng911`)

Set curator confidence to 70% with a rationale, run an admin eval on the Project dataset, and confirm both signals, the verdict and the gap count show on the Project page and on a consultant's dashboard.

### Automatic gap

As a consultant in a `cebu-ng911`-bound conversation, ask about Mitel PBX SIP trunk configuration before any Mitel source is loaded. Confirm Ember says it cannot answer from Project knowledge, a gap is created and the curator is notified. Ask a similar question as a second user and confirm the occurrence count increases with no second notification.

### Resolution loop

Load and approve the Mitel documentation, link it to the gap, re-ask the question, promote the gap to a draft eval case, and confirm the next admin run includes it.

### Failure report

Report an Ember answer that cites the wrong NENA section, and confirm it reaches the curator queue with the original answer and citations attached and does not reach the feedback board.

### Access boundary

Restrict a source and confirm a member without access cannot see gaps whose occurrences cite it, while the curator can.
