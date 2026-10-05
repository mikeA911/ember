# Ember (KB Sandbox) — Current Architecture

Living documentation of what is actually implemented. **Last updated: 5 October 2026.** The product is presented to users as **Ember**; the codebase, database and many docs still use the original name **KB Sandbox**, and both names refer to the same application.

This file describes reality, not intent. `docs/ROADMAP.md` owns the public M1–M10 milestone names, order and status; this file explains how the delivered parts work. Where the two disagree, treat later code and migrations as authoritative and update whichever document is stale.

## Milestones

The public roadmap has ten milestones. Internal labels (M3.5, M5A, M5F and so on) are implementation increments placed under the public milestone whose outcome they advance; they do not renumber it.

| # | Public name | Status | Delivered here (internal increments) |
|---|---|---|---|
| M1 | Curate | Live | Curator pipeline: upload, parse, chunk, enrich, review, embed; knowledge bases; RLS; AI provider abstraction. Later: versioned knowledge sources, source submissions, Project-scoped evidence access |
| M2 | Organize | Live | Versioned Wiki with provenance (M2); Workbench and Product Handbook categories; Project-scoped Wiki articles; working knowledge |
| M3 | Evaluate | Live | Evaluation engine (M3); multi-provider model registry (M3.5); Projects, membership and isolation (M3.6); public/anonymous experience (M3.7) |
| M4 | Orchestrate | Live | Graph runtime (M4); Workbench service layer and in-process tool contract (M5F); bounded Ember tool loop |
| M5 | Apply | Live | Agent Templates and RAG Answer Agent (M5A/B); Workstreams and artifacts (M5D); Ember assistant; assessments; Methods; presentations; workstream promotion; external agent registry and gateway; builders and agencies |
| M6 | Deploy | Planned | Foundations only: model-neutral registry, bearer-token identity, and the read-only external MCP server |
| M7 | Govern | Planned | Foundations only: information-sensitivity classification and pre-inference policy gate, approval policies and authorities, Project creation approval |
| M8 | Communicate | Planned | Foundations only: artifacts, findings, presentations, public Project profiles |
| M9 | Teach | Planned | Foundations only: Workbench Handbook and Method catalog |
| M10 | Research | Planned | Foundations only: separate vector stores, graph orchestration, controlled tool calling |

Guardrail Templates (originally M5C) remain planned and now sit under M7.

The sections below follow the order in which capabilities were built. Each heading names the increment that introduced it.

## Stack

Next.js 16 (App Router), TypeScript, Supabase (Postgres + pgvector, Auth including its OAuth 2.1 server, Storage), `@langchain/langgraph` for graph orchestration, `@modelcontextprotocol/sdk` for the external MCP server, Vitest. Deployed on Vercel (`vercel.json`, including a cron route for scheduled presentation reviews). No Next.js `middleware.ts` — Next 16 renamed the convention to `proxy.ts`; ours only refreshes the session cookie, it does not gate routes (route protection lives in each layout/page and in RLS — see [Auth](#auth)). All AI provider calls and privileged writes happen server-side, in Server Actions under `src/app/actions/`.

Milestone 1 was a full rebuild of an earlier Vite SPA, not an in-place migration.

There is one product configuration: every deployment runs the builder and agency model described in [Builders and agencies](#builders-and-agencies). An enterprise customer gets its own deployment and acts as the agency. One deployment currently serves one client organization; there is no native Organization record (see `docs/workbench-handbook-how-kb-sandbox-is-organized.md`).

## Data model

Three layers, deliberately kept distinct rather than collapsed into one:

```text
SOURCE DOCUMENTS  (documents)
        │  parsed + chunked
        ▼
DOCUMENT CHUNKS   (document_chunks)  ──approve──▶  KB_VECTORS  (retrieval units)
        │
        │  curator selects approved chunks as evidence
        ▼
WIKI ARTICLES     (wiki_articles / wiki_versions)  ──approve──▶  WIKI_VECTORS
        │
        ▼
  RAG Answer Agent, graph runtime, Ember retrieval (see later sections)
```

`kb_vectors` and `wiki_vectors` are separate tables on purpose: a source chunk and a curated Wiki synthesis of that chunk are different things with different provenance, and collapsing them would make it impossible to tell "this is raw evidence" from "this is reviewed synthesis" at retrieval time. Milestone 2 only built the write side plus simple title/category text search; Milestone 3 adds the actual read/retrieval path (`match_documents`, `match_wiki_vectors` — see [Evaluation engine](#evaluation-engine-milestone-3)), but only for evaluation runs. There is still no general-purpose `/search` UI.

### Curator pipeline (Milestone 1)

`documents` → parse (`src/lib/parsing.ts`, real pdf/docx/txt extraction, not an LLM-guessing-at-a-URL) → chunk (`src/lib/chunking.ts`, deterministic paragraph accumulation with page/section/parser provenance) → enrich (`src/lib/curator/enrichment.ts`, AI-generated topic/relevance/concepts via the generic `AIProvider`) → curator review/approve/reject (`src/lib/curator/chunks.ts`) → embed on approval → `kb_vectors`.

Every stage that can fail records a structured error (`documents.processing_error`, `document_chunks.enrichment_error`: `{stage, code, message, occurred_at, retryable}`) instead of silently degrading — this was a deliberate fix versus the original app, which returned placeholder metadata on AI failures and hid them from curators.

### Wiki pipeline (Milestone 2)

```text
Sources → AI-assisted synthesis → Draft → Human review → Approved → Versioned canonical knowledge
```

- **`wiki_articles`** — stable identity: slug, title, category (FK to `wiki_categories`, a seeded lookup table for the six top-level taxonomy categories — not a hardcoded enum, so the UI can list/order them), status (`draft` / `review` / `approved` / `archived`), and `current_version_id`.
- **`wiki_versions`** — insert-only, never updated by a regular staff session (no client-facing `UPDATE` RLS policy at all). Content is one markdown field covering the standard section structure (What it is / Why it matters / How it works / Architecture / When to use / When not to use / Failure modes / Evaluation / Governance considerations / Practical experiment), plus dedicated columns for `quick_help`, `implementation_notes`, and `limitations` since those are used differently from the narrative body. AI-assisted versions carry provenance (`ai_provider`, `ai_model`, `ai_generated_at`, `source_chunk_ids`).
- **`current_version_id` only ever moves on admin approval.** Editing a draft, or editing *approved* content, always inserts a new `wiki_versions` row (`version_number` + 1); it never touches `current_version_id` or mutates an existing row. This is the mechanism behind "approved content stays live until the new version is itself approved" and "superseded versions don't accidentally become current" — see `src/lib/wiki/articles.ts` (`createNextDraftVersion`) and `src/lib/wiki/review.ts` (`approveWikiVersion`, the only function that writes `current_version_id`).
- **`wiki_sources`** — links a version to `documents`/`document_chunks` (or an external citation with neither, via a `source_type='external'` escape hatch). At least one of `document_id`/`chunk_id` is enforced by a CHECK constraint for non-external sources.
- **`wiki_relations`** — a plain self-join table for "related articles," directional in storage but rendered symmetrically. Explicitly not a graph store, per the brief.
- **`wiki_vectors`** — optional, written best-effort at approval time (`embedApprovedVersion` in `review.ts`); a failure here is logged and does not block approval, since an AI/embedding outage shouldn't turn an editorial decision into a hard failure.

AI-assisted draft generation (`src/lib/wiki/synthesis.ts`) takes curator-selected **approved** chunks only, calls `AIProvider.generateStructured` with a Zod schema matching the article shape, and always produces a `draft` — there is no code path where an AI call sets `status='approved'` or moves `current_version_id`.

## Evaluation engine (Milestone 3)

```text
eval_datasets (versioned benchmark)
      │  1:N
      ▼
eval_cases (question, expected evidence, expected concepts, scoring criteria)
      │
      │  a run selects a configuration and executes every case
      ▼
eval_runs (config jsonb snapshot: generation/embedding/retrieval/evaluator)
      │  1:N
      ▼
eval_results (retrieval metrics + generated answer + optional judge output + human review)
```

- **`eval_datasets`** — `draft` / `active` / `archived`, plain integer `version`. Activating requires ≥1 case (`activateDatasetAction`). Once a dataset leaves `draft`, its cases are frozen — not by convention, but by RLS: `eval_cases`' insert/update/delete policies each require `exists (select 1 from eval_datasets d where d.id = eval_cases.dataset_id and d.status = 'draft')` (`supabase/migrations/20260809110004_eval_rls.sql`). This is what makes "an active benchmark can't be silently invalidated" a guarantee instead of a hope.
- **`eval_cases`** — question, `expected_answer`, `expected_concepts[]`, `expected_article_ids[]` (Wiki), `expected_chunk_ids[]` (source chunks), `scoring_criteria`, `tags[]`, `difficulty`. Expected evidence is intentionally split by type rather than a single generic id list, matching the chunk/Wiki evidence-type separation below.
- **`eval_runs`** — snapshots its entire configuration into `config` (jsonb: generation provider/model, embedding provider/model/dimensions, retrieval evidence source/top-K/threshold, evaluator type/provider/model) at creation time, plus `dataset_version`. A run is executed with `getProviderByName()` (`src/lib/ai/index.ts`), never `getActiveProvider()` — so a historical run stays interpretable even after the app's global `settings.ai_provider` changes later. One run per dataset can be flagged `is_baseline` for comparison.
- **`eval_results`** — one row per case per run. Automated columns (`retrieval_hit`/`retrieval_recall`/`retrieval_mrr`/`generation_score`/`grounding_score`/`outcome_score`/`failure_classification`) and a parallel set of `human_*` columns are both present and never overwrite each other — `submitHumanReviewAction` (`src/app/actions/eval.ts`) only ever writes the `human_*` set. A per-case pipeline failure (embedding outage, provider error, etc.) still produces a row, with `status='failed'` and a structured `error` object — it never just vanishes from the run.

### Who runs evaluations (Ember Readiness, Stage 1)

Since 5 October 2026 AI evaluation is platform-admin work: it is evidence that Ember understands a Project's context before it suggests anything, a platform decision alongside choosing the default model (`docs/dev-request-ember-readiness-and-knowledge-gaps.md`). `20261012100001_eval_operations_admin_only.sql` replaces every curator and consultant insert/update policy on `eval_runs` and `eval_results` with `is_admin` ones; `createAndRunEvalAction`, `markBaselineAction` and `submitHumanReviewAction` call `requireRole('admin')`. Dataset and draft-case authoring is unchanged (platform curators, and Project curators via `eval_datasets_manage_project_curator`), as are all select policies. In the app, `/evals/runs/*` redirects non-admins, `/evals` shows curators their datasets only, the Explore menu's **Evals** item, the dashboard's Evaluations card, the "failed evaluation runs" attention line and an Agent's **Run evaluation suite** button are admin-only, and **Admin → Ember readiness** (`src/lib/eval/readiness-overview.ts`) lists every non-archived dataset with its Project, question count and latest completed run.

### Ember readiness per Project (Stage 2)

Every Project page has an **Ember readiness** section, and every dashboard an **Ember readiness** table with one row per Project the viewer belongs to (`src/lib/projects/ember-readiness.ts`, `EmberReadinessSection`, `EmberReadinessWidget`). Two signals stay separate and are never blended:

- **Curator confidence** — `project_ember_readiness` (`20261013100001_project_ember_readiness.sql`): percentage, verdict (`ready`/`needs_more_sources`), rationale and review date, append-only (member select, `can_curate_project` insert as oneself, no update/delete). The newest row is current. A `BEFORE INSERT` trigger stamps `set_at` and records `measured_score_at_set` from the latest run, so the client cannot supply either.
- **Measured score** — the latest completed run on a non-archived dataset attached to the Project, as questions passed of questions asked (human acceptance wins; otherwise the expected evidence was not missed and the judge's outcome score is ≥ 0.7, or with no judge the expected evidence was retrieved). Members cannot read `eval_results`, so the score and the knowledge coverage counts (active sources, searchable sources with an approved chunk, approved Wiki articles, last source added) come from `project_ember_readiness_signals(uuid[])`, a `SECURITY DEFINER` function that returns counts only, for Projects where `is_project_member` holds. Its helper `project_measured_score(uuid)` is not executable by clients.

`computeReadinessStatus()` derives the displayed verdict (*Not assessed* when no row exists), *review due* (review date passed, or the measured score 15+ points below the score at set time) and a disagreement notice (confidence and score more than 25 points apart). Admin → Ember readiness also shows each Project's current curator verdict.

### Failure reports and knowledge gaps (Stage 3)

`project_knowledge_gaps` (`20261014100001_project_knowledge_gaps.sql`, `src/lib/projects/knowledge-gaps.ts`) holds Project-scoped failure reports, and in Stage 4 automatically detected gaps. RLS: reporter or `can_curate_project` select, member insert as oneself, curator update, no delete. A `BEFORE INSERT` trigger forces `status = 'new'` with all curator fields empty and checks that a linked conversation is the reporter's own and bound to the Project (and a linked message is an assistant row in it); a `BEFORE UPDATE` trigger rejects any change to the reported content. **Report a problem** under a Project-bound Ember answer posts only the message id (`runAssistantTurn` now returns `messageId`, and `toDisplayMessages` carries each row's id); the server reads the question, answer, verified citations and model from the caller's own conversation. Curators triage, resolve (linking a source or Wiki article and recording a re-check), promote to a draft eval case (the Project's newest draft dataset, created if none) or convert to a `feedback_reports` row. Notifications are Project notes with `context_type = 'knowledge_gap'`. `project_ember_readiness_signals()` gains `open_gap_count`; five or more open gaps mark readiness *review due*.

### Automatic knowledge-gap detection (Stage 4)

In a Project `chat` conversation, `runAssistantTurn`'s `finishTurn` calls `detectKnowledgeGapSignal()` (`src/lib/chat/knowledge-gap-detection.ts`). A gap is filed when the envelope's `knowledgeCoverage.status` is `partial` or `not_in_project_knowledge`. With no declaration, a gap is filed when `search_project_knowledge` ran with no Project-layer hit at similarity ≥ 0.4 and no Project citation. An explicit `answered` declaration never files one. `recordKnowledgeGap()` calls `record_automatic_knowledge_gap()` (`20261015100001_knowledge_gap_detection.sql`, `SECURITY DEFINER`, caller's own Project chat conversation only, idempotent per message). It groups with the most similar open gap in the Project (`knowledge_gap_similarity()`, word-overlap Jaccard ≥ 0.65) or files an `origin = 'automatic'` gap, and writes a `project_knowledge_gap_occurrences` row. Curators get a Project note for a new gap and at 3/10/25 occurrences; recording failures are logged and never break the turn. The turn returns `knowledgeGap`, and `toDisplayMessages` reattaches the caller's own detections, so ChatPanel shows the notice with **Add details** (RLS update of the asker's own `note`/`suggested_source`; a caller-role trigger blocks other columns) and **Don't send** (`withdraw_knowledge_gap_occurrence()`, within a day; re-creates or removes an untriaged gap the asker started, refuses once a curator has triaged it).

### Evidence-type separation carries through to retrieval and scoring

Per an explicit architectural constraint (not just an implementation detail): Wiki evidence and source-chunk evidence are never merged into one ambiguous list.

- `src/lib/eval/retrieval.ts`'s `retrieveEvidence()` calls `match_documents` (chunks, via `kb_vectors`) and/or `match_wiki_vectors` (Wiki, via `wiki_vectors`, restricted to each article's `current_version_id` so drafts never leak into an eval) depending on the run's `retrieval.evidence_source` (`chunks` / `wiki` / `both`), then merges by similarity for a combined top-K.
- Every retrieved item keeps an explicit `type: 'chunk' | 'wiki'` (`RetrievedEvidenceItem`, `src/types/database.ts`) all the way through scoring and storage.
- `src/lib/eval/scoring.ts`'s `computeRetrievalMetrics()` (Hit@K, Recall@K, MRR — all deterministic, no LLM involved) only ever compares a `chunk` item against `expected_chunk_ids` and a `wiki` item against `expected_article_ids`; a matching id of the wrong type is never counted as a hit.

This is what makes "Chunks Only vs. Wiki Only vs. Wiki + Chunks" a real, run-configurable comparison rather than something the schema would have to be redesigned to support later.

### Pipeline: retrieve → generate → score

`src/lib/eval/run.ts`'s `executeEvalRun()` runs synchronously inside the Server Action that launched it (`createAndRunEvalAction`), the same pattern as Milestone 1's chunk enrichment — datasets are small (10-15 cases) by design at this milestone, so no background job queue yet. Per case: `retrieveEvidence()` → `computeRetrievalMetrics()` (always, deterministic) → `generateAnswer()` (`src/lib/eval/generation.ts`, evidence-grounded prompt via the existing `AIProvider`) → optionally `judgeAnswer()` (`src/lib/eval/judge.ts`, `generateStructured()` against a Zod schema, additive only — never the sole evaluator, per the brief's "deterministic evaluation first").

## Auth & authorization

Supabase Auth, session cookie refreshed by `src/proxy.ts` on every request. Accounts are created only by an admin (`createUserAction`), which writes the profile; self-registration is off, and a user who signs up straight against Supabase Auth gets no profile and cannot sign in (`20261009`). Actual enforcement happens twice, deliberately:

1. **Server Actions/layouts** call `requireUser()`/`requireRole()` (`src/lib/auth.ts`) against the caller's own session before doing anything.
2. **RLS** is the backstop that holds even if an action forgot to check — e.g. `wiki_versions` has no `UPDATE` policy for `authenticated` at all, so even a bug in a Server Action's role check couldn't let a non-admin set `approved_by`/`approved_at`; only the service-role client (used exclusively inside the admin-gated `approveArticleAction`) can write those columns.

As of Milestone 3.6/3.7, authorization is really three tiers layered on top of each other: **platform role** (`profiles.role`, this section), **project role** (`project_members.role`, scoped to one project — see [Projects, Membership & Isolation](#projects-membership--isolation-milestone-36)), and **public/anon** (no role at all, read-only, scoped to explicitly published content only — see [Public / Anonymous Experience](#public--anonymous-experience-milestone-37)).

Approval-type actions (`approveDocument`, `approveArticleAction`) use a service-role Supabase client, mirroring what the old app's `admin-api` Edge Function did — except that logic now lives in this app's own server runtime instead of a separate Supabase Edge Function, since Next.js Server Actions cover the same "run with elevated privilege, server-side" need.

## AI provider abstraction (registry: Milestone 3.5)

`src/lib/ai/provider.ts` defines `generateText` / `generateStructured` / `embed`, each accepting an optional `model` to override whatever default the provider instance was built with. `OpenAIProvider`, `GeminiProvider`, and `OpenAICompatibleProvider` implement it — the last one is a single reusable class (constructor: name, API key, base URL, optional default model) that covers Groq and any future OpenAI-API-shaped gateway (local vLLM, an enterprise gateway, etc.) via the already-installed `openai` npm package with a custom `baseURL`, rather than one class per vendor.

Providers and models are no longer a hard-coded TS union — they're admin-managed rows in `ai_providers`/`ai_models` (`src/lib/ai/registry.ts`), seeded with OpenAI, Gemini, and Groq. `ai_providers.api_key_env_var` stores only the env var *name* (`'GROQ_API_KEY'`), never a secret value — the admin UI reports `Configured`/`Missing` by checking `process.env[...]` server-side. `ai_models` carries per-model capability flags (`supports_structured_output`/`tools`/`reasoning`/`vision`/`embeddings`), a `status` lifecycle (`active`/`deprecated`/`disabled`/`unavailable`) with optional `deprecation_date`, and `is_default` — a partial unique index (`ai_models_one_default_per_type`) enforces at most one default per `model_type`, which is what makes "the default generation model" and "the default embedding model" genuinely independent (e.g. Groq for generation, Gemini for embedding) rather than one universal "active provider" setting.

`getActiveProvider()` (`src/lib/ai/registry.ts`, re-exported from `src/lib/ai/index.ts`) resolves to whichever provider/model the registry currently marks as the default generation model — this replaced the old `settings.ai_provider` key entirely; Wiki synthesis and chunk enrichment call it unchanged. `getProviderByName(supabase, name, logContext)` is the one place that picks a specific provider independent of the platform default — evaluation runs use this, now `async` since it's a DB lookup rather than a switch over a hard-coded union. `assertModelCapability(model, need)` is called once at the top of `executeEvalRun` (not scattered provider-name checks) to reject a disabled model, an embedding model in a generation slot, or a non-structured-output model selected as an LLM judge, before any API call is made. `classifyProviderError()` (`src/lib/ai/provider.ts`) turns a caught SDK error into one of `rate_limit`/`quota_exceeded`/`model_unavailable`/`authentication`/`invalid_request`/`unknown`, attached to `AIProviderError.errorCode`.

Every field of an eval run's `generation`/`embedding`/`evaluator` config (`EvalRunConfig`) is a plain string (provider name + model id), not a foreign key into `ai_models` — a run's stored config is a value snapshot, so a model being disabled or deleted from the registry later never changes what a historical run says it tested. `getProviderByName`/`resolveModel` are only ever called at run-creation time; reading back a completed run never re-resolves or re-validates against the current registry state.

`ai_operation_logs` carries `eval_run_id`/`eval_case_id` columns (`LogContext`, `src/lib/ai/logging.ts`) so an AI call made during an eval run — embedding, generation, or judge — can be traced back to the specific run and case that triggered it, without building the full Runs/Tracing subsystem that's planned for a later milestone.

Every call also records its `task` (what it was for: chat, conversation summary, chunk enrichment, Wiki draft and so on; the list is `src/lib/ai/tasks.ts`, and `LogContext.task` is required so no call site can skip it) and `cached_input_tokens`, the part of the input the provider served from its prompt cache (`20261010`). The kind of call stays in `operation`.

**Cost and prompt caching** (`20261011`). Each model can have input, cached-input and output prices per million tokens, set in Admin → AI Config → provider ("Edit prices"); cached input is charged at the cached price, or the full input price if none is set, and a model without prices is reported as unpriced. Admin → Usage & cost reports spend by task and by model for this month or the last 30 days, from the `ai_cost_daily` view (`security_invoker`, so the admin-only log policy applies), with the cached share of input and unpriced calls flagged. To keep prompts cacheable: chat calls to OpenAI carry a `prompt_cache_key` per project (or general chat); once a chat's history is over budget, `composeWorkingContext` cuts it in steps of four turns so its start holds for several turns; and the conversation summary is refreshed only when the cut drops turns it doesn't cover yet, from the previous summary plus the messages since it.

The initial embedding profile is `vector(1536)`, recorded per-row via `embedding_model`/`embedding_dim` rather than assumed — see the column comment on `kb_vectors.embedding` in `supabase/migrations/20260808190006_kb_vectors.sql`. Changing the default embedding model later is an additive migration (new column + re-embed job), not a silent dimension mismatch; adding a new *generation* provider (as Groq's addition demonstrated) requires no schema change to the vector tables at all.

### What's explicitly not built yet (provider/model registry)

No quota/rate-limit header telemetry beyond the basic error-code classification above; no model discovery for Gemini (the `@google/genai` SDK isn't wired up for it — Gemini models stay manually configured, `supports_model_discovery=false`); no Project-level model allowlists or preferred-model settings. These remain deferred, not oversights.

Since M3.5 the registry has gained DeepSeek and xAI Grok providers (both through `OpenAICompatibleProvider`), Gemini tool support, a separate default **structured-output** model, per-model pricing used by Builder metering, and a per-provider **maximum information sensitivity** (see [Information sensitivity](#information-sensitivity-and-the-ai-policy-gate-m7-foundation)). The default embedding model is OpenAI `text-embedding-3-small` (1536 dimensions, migration `20261002`). The legacy `updateAIProviderSetting` action still exists, but provider selection is driven by the registry.

## Projects, Membership & Isolation (Milestone 3.6)

A **project** (`projects`) scopes a piece of AI engineering work — one of five `project_type`s (`learning`/`experiment`/`consulting`/`transformation`/`knowledge`) — and can own a project-specific knowledge base and/or eval dataset (nullable `project_id` FK on `knowledge_bases`/`eval_datasets`; `null` means "platform-global," e.g. the AI Engineering Wiki Benchmark).

Authorization is deliberately **two-tier**, tracked as two entirely separate concepts:

- **Platform role** (`profiles.role`: `anonymous`/`member`/`consultant`/`curator`/`admin`) — what someone can administer across KB Sandbox as a whole. `member` (added 2026-08-31) is the least-privileged authenticated role, below `consultant`; it cannot start Projects.
- **Project role** (`project_members.role`: `owner`/`curator`/`consultant`/`viewer`) — what they can do inside *one specific project*. Granting `consultant` on one project never implies access to another. A project's `owner_id` always has a matching `owner` membership row, enforced by an `after insert on projects` trigger (`create_owner_membership`), not by every call site remembering to insert one.

Four `SECURITY DEFINER` SQL helpers (`supabase/migrations/20260810120001_project_members.sql`, same pattern as `is_admin`/`is_curator_or_admin`) back every project-scoped RLS policy, each with a **platform-admin bypass** built in so "admin sees/manages everything" never has to be repeated in a policy body: `is_project_member`, `can_manage_project` (owner-only — this is also the M3.7 publish gate), `can_curate_project` (owner/curator), `can_run_project_evals` (owner/curator/consultant, excludes `viewer`).

Existing platform-wide curator/admin policies from Milestone 3 are **intentionally untouched** — a platform curator/admin still manages any dataset regardless of project, which is what keeps the platform-level AI Engineering Wiki Benchmark working for every consultant. What's new is scoping: a project's own `knowledge_bases`/`eval_datasets`/`eval_runs` are only visible to that project's members (RLS on `knowledge_bases`/`eval_datasets`/`eval_cases`/`eval_runs`/`eval_results`, each policy re-checking `project_id is null or is_project_member(...)`), and a `before insert or update on eval_datasets` trigger (`validate_eval_dataset_project_kb_consistency`) rejects attaching a knowledge base that belongs to a *different* project.

UI: a Team step in the project-creation wizard (stage members by email, resolved via a narrow service-role lookup that only ever returns `id`+`email`) and a full Members page (`/projects/[id]/members`) for role changes, activation/deactivation, and ownership transfer — all mutations go through the caller's own RLS-scoped client, matching every other Server Action in this codebase; `requireUser()`'s anonymous-role rejection is defense-in-depth on top of RLS, not the real gate.

## Public / Anonymous Experience (Milestone 3.7)

A **public visitor** here means literally `auth.uid() is null` — no session, no profile row, Supabase's plain `anon` API key. This is a different concept from `profiles.role = 'anonymous'` (a real Supabase Auth anonymous sign-in session, built in an earlier migration but never wired up to any UI) — that machinery is left dormant on purpose; nothing in this milestone creates or depends on an `'anonymous'`-role profile.

Governing principle: **publish a curated view of a project, never the internal project itself.** Nothing became public by weakening an existing RLS policy — every public read path is a new, additive policy (`supabase/migrations/20260810130001_public_visibility.sql`) plus a dedicated narrow-`select()` query function, since RLS is row-level only and several tables (`projects`, `wiki_versions`) carry columns (`owner_id`, `notes`, `details`, `published_by`, `source_chunk_ids`, `created_by`, `approved_by`) that must never reach a public reader even on an otherwise-visible row.

- **`projects`** gains `visibility` (`private`/`internal`/`public`, default `private` — never auto-changed), `public_slug` (unique), `public_profile` (jsonb — hand-authored title/summary/problem/approach/findings/conclusion/`benchmarkSummary`/`relatedWikiSlugs`, deliberately **not** a live rollup of `eval_results`), `published_at`, `published_by`. `projects_select_public` (additive) requires both `visibility = 'public'` and a non-null `published_at`. Publishing is gated to `can_manage_project` (owner or platform admin) — reuses the existing `projects_update_managers` policy, no new UPDATE policy needed, since the new columns live on the same row.
- **`wiki_articles`** gains `is_public` (default `false`), deliberately separate from `status='approved'` — approved means "trusted canonical knowledge," public means "safe for anonymous disclosure." `wiki_versions_select_public` scopes to exactly an article's *current* version via an `is_public_wiki_article()` helper — never a draft, a pending review revision, or a superseded-but-once-approved version.
- **Column safety is enforced by the query layer, not RLS**, in `src/lib/projects/public.ts`/`src/lib/wiki/public.ts` — both select an explicit narrow column allowlist and cast to a hand-typed row interface. (Supabase-js's select-string literal type inference doesn't resolve real per-column types against this codebase's hand-authored `Database` type — it silently degrades every field to `any` — so the actual TypeScript safety net here is the explicit row interface + cast, not the select string's type. The runtime column list sent to Postgrest is still exactly what's written regardless.)
- **Routes**: a new `(public)` route group (`src/app/(public)/`) — `/` (landing), `/about`, `/examples` + `/examples/[slug]` (published project showcases), `/knowledge` + `/knowledge/[slug]` (public Wiki articles). Its layout does not redirect on auth state — unlike `(app)/layout.tsx`, it works for a sessionless visitor and stays reachable for a logged-in user (who gets extra affordances, e.g. an owner's "Manage Public Page" link). Every other authenticated route is unchanged and still redirects to `/login`.
- **Publishing UX** (`/projects/[id]/publish`, owner/admin only): explicitly separate "Save draft" vs. "Publish"/"Unpublish" actions — changing a form field never auto-publishes. Unpublishing frees the slug and resets `visibility`/`published_at`/`published_by` but preserves the `public_profile` draft so the owner doesn't lose their work.
- Deliberately **not** exposed to anon: `wiki_sources`, `wiki_relations`, `project_members`, any `eval_*` table, `ai_operation_logs` — none of these gained a new policy this milestone, confirmed via a live anon-key regression check (`scripts/live-e2e.test.ts`).

## Graph Runtime (Milestone 4)

The first graph-based execution primitive: STATE + NODES + EDGES + CONDITIONAL TRANSITIONS + TERMINATION + TRACE. Extends the M3 single-pass pipeline (`retrieve → generate → score`) into a bounded retry loop (`retrieve → generate → evaluate → (accept → END | retry: diagnose → rewrite_query → retrieve)`, capped at `maxIterations`) without replacing the single-pass path, which remains available and unchanged. **The graph controls execution; the LLM only controls content generation and query rewriting inside nodes** — no `while(modelSaysContinue){modelDoAnything()}`. This is explicitly not the Agent milestone (M5): no tool-calling, no Agent Builder, no autonomous behavior; `ai_models.supports_tools` stays unread.

Uses `@langchain/langgraph` (`StateGraph`/`Annotation.Root`) for orchestration only — every node reuses an existing M3 service unchanged (`retrieveEvidence`, `generateAnswer`, `judgeAnswer`, `computeRetrievalMetrics`); LangChain never replaces `AIProvider` or the eval pipeline. `RagGraphState` (`src/lib/graph/state.ts`) is an explicit typed interface, never `Record<string, any>`.

- **Schema**: `graphs` (stable identity, nullable `project_id` = platform-global) → `graph_versions` (immutable config snapshot — no UPDATE RLS policy at all, same enforcement mechanism as `wiki_versions`; a graph's *active* version is tracked via `graphs.active_version_id`, updated in place, so `graph_versions` itself never needs an UPDATE) → `graph_runs` (one execution) → `graph_steps` (one row per executed node — the actual trace, the design brief's own framing: "more important than visual graph editing").
- **Nodes** (`src/lib/graph/nodes.ts`) — five plain, independently-testable functions, no LangGraph dependency of their own: `retrieveNode`/`generateNode` thinly wrap the M3 services; `evaluateNode` always runs deterministic retrieval metrics and adds an LLM judge only when one is configured (never fabricates a score with no golden answer); `diagnoseNode` uses deterministic rules only (missing expected evidence → `retrieval_failure`, low score → `generation_failure`); `rewriteQueryNode` produces only a revised retrieval query, never an answer.
- **Transition** (`src/lib/graph/transitions.ts`) — `shouldContinue()` is a pure, deterministic function (never asks the model "want another attempt?"): accepted → end; `iteration >= maxIterations` → end; retryable → diagnose. Three acceptance regimes depending on what's configured: judge-and-thresholds, deterministic-retrieval-hit-only (no judge but golden evidence exists), or a single pass ending in `terminationReason = 'unscored'` (deliberately distinct from `'success'` — nothing was checked, and a comparison UI must never conflate the two).
- **Reasoning retry vs. infrastructure retry** — structurally separate code paths. A thrown `AIProviderError` from an AI-calling node terminates the `graph_run` immediately (`status='failed'`, `termination_reason='provider_error'`) and never reaches `diagnose`; that's a catch block, not a graph edge. No infrastructure-level retry/backoff exists in the provider layer today — a transient `rate_limit` fails the run outright, a known limitation, not silently absorbed.
- **Eval integration**: `EvalRunConfig.execution` is optional (`{ mode: 'single_pass' | 'graph', graphId?, graphVersionId?, maxIterations?, acceptanceThresholds? }`) — absent means exactly today's single-pass behavior, fully backward compatible with every historical run. `runCaseViaGraph()` (`src/lib/eval/run.ts`) creates a `graph_runs` row and maps the graph's *final* state into the same `eval_results` shape the single-pass path writes (plus new nullable `graph_run_id`/`iteration_count` columns) — the results table, scoring, and run-comparison UI need no changes to understand a graph-mode result. `MAX_GRAPH_ITERATIONS = 5` (`src/lib/graph/errors.ts`) is a hard server-side ceiling regardless of what a run requests.
- **UI**: `/graphs` (list + `[slug]` detail — version history, "Activate Version," an ordinary list/ASCII flow diagram, deliberately no visual node-drag editor), an Execution Mode selector on `RunConfigForm`, and a trace panel added to the existing eval-result drill-down page (`/evals/runs/[id]/[resultId]`) showing each executed node/iteration when `eval_results.graph_run_id` is present.
- **RLS**: `graphs`/`graph_versions` use the same two-tier split `knowledge_bases` already uses for nullable `project_id` (global vs. project-scoped), except "manage" is owner-only for project-scoped graphs (`can_manage_project`, not `can_curate_project`) per the design brief's explicit "admin/project owner" wording. `graph_runs`/`graph_steps` mirror `eval_runs`' exact staff-unscoped-plus-consultant-project-scoped shape. All helper functions (`is_project_member`, `can_manage_project`, `can_run_project_evals`, `is_curator_or_admin`) are reused by name from M3.6, never redefined.
- **Known scope trim**: `graph_steps.ai_operation_log_id` linkage to the *specific* AI call a node made is not wired for M4 (the column exists for a later milestone) — providers are resolved once per case, not once per node invocation, so `ai_operation_logs.graph_run_id` is populated correctly but the step-level cross-reference isn't. The trace's core value (which nodes ran, their input/output/latency/status/iteration) doesn't depend on it.

## Agent Framework (Milestones 5A foundation slice + 5B)

Adds the semantic layer M4 deliberately left out. An **Agent** is a governed configuration — Purpose, Instructions, Models (generation/embedding/evaluator), Sources, Guardrails, Termination Policy — that **executes through a Graph** rather than duplicating one. `agents`/`graphs` stay distinct entities on purpose (`Agent → Agent Version → Graph Version → Graph Runtime`); one graph may back multiple Agents later.

The original M5 design doc plus its amendment (Agent Templates/Custom Agents, a tool-calling/authorization framework, an Interface Modernization Agent, Guardrail Templates, a canonical capability registry) was far larger than any prior milestone. After review, the roadmap was split: this pass builds only the Agent Templates foundation (M5A) and the RAG Answer Agent (M5B, explicitly **no arbitrary tools** — the tool-calling/authorization/trace framework is deferred until a concrete milestone actually needs to execute one). Guardrail Templates (M5C) and repository/external-workbench integration (M5D) — plus the Interface Modernization Agent that scope was originally built around — are explicitly out of scope here; see "What's explicitly not built yet" below.

- **Schema**: `agent_templates` (reusable defaults — **ordinary mutable table**, unlike every other versioned entity in this codebase, because a template has no runs of its own; it only supplies defaults at Agent *creation* time) → `agents` (stable identity, nullable `template_id`/`project_id`) → `agent_versions` (immutable — no UPDATE RLS policy, same mechanism as `graph_versions`/`wiki_versions`). A template's defaults are **copied, not dynamically referenced**, into the `agent_versions` row at creation time (`src/lib/agent/create.ts`'s `createAgentFromTemplate`) — this is what lets `agent_templates` stay safely mutable: editing a template later can never disturb an Agent already created from it, satisfying "template changes do not silently mutate existing Agent versions" without a second immutable-versioned table.
- **Execution spine reuse**: `graph_runs` gains nullable `agent_id`/`agent_version_id` columns (added exactly how `eval_run_id`/`eval_case_id` were added in M4) — an Agent execution is a `graph_runs` row with those set, not a parallel `agent_runs` table. `src/lib/agent/rag-answer-agent.ts`'s `answerQuestion()` resolves an Agent version's models/graph version, builds a synthetic single-case state, and invokes the same `buildRagRetryGraph()` M4 already built — it deliberately **never inserts an `eval_results` row** (that table grades a case against a stored benchmark dataset; a live ad hoc question isn't one, and reusing it would corrupt benchmark comparison views).
- **Eval integration**: `EvalRunConfig.execution` gains optional `agentId`/`agentVersionId` (both absent = today's exact graph-mode behavior). "Run evaluation suite" on an Agent's detail page reuses the existing `RunConfigForm`/`createAndRunEvalAction` path unchanged — no second eval-running code path — so an Agent's benchmark performance is directly comparable to any other graph-mode or single-pass run.
- **Agents still do not call tools.** At the time of M5A/B, `AIProvider` had no tool support. Tool calling was later added for the Ember assistant only (`generateChat`, see [Ember assistant](#ember-assistant-m5)); Agents remain retrieval-and-answer only.
- **UI**: `/agents` (list + `[slug]` detail — Purpose/Instructions/Models/Sources/Guardrails/Termination, which template it came from, "Ask a question," "Run evaluation suite," version history + `ActivateAgentVersionButton`), `/agents/templates` (read-only), `/agents/new` (deliberately minimal — template select, name, purpose/instructions/models all prefilled and editable, **not** the amendment's full repo-scope/knowledge/OpenAPI+MCP-target wizard, which has nothing to attach to until an Engineering-family template exists), `/agents/[slug]/run` (a plain question-in/answer-out form, not a generic graph runner).
- **RLS**: `agents`/`agent_versions` mirror `graphs`/`graph_versions`' exact two-tier global-vs-project shape (owner-gated manage for project-scoped Agents, per the design brief's "admin/project owner" wording). `agent_templates` uses the `ai_providers`/`ai_models` bar (any authenticated non-anonymous session may read; staff manage). All helper functions reused by name from M3.6, never redefined.
- **Permissions**: no anonymous/public execution of the RAG Answer Agent — M3.7's public-visitor pattern is a curated *static* view (hand-approved Wiki articles, hand-authored project profiles), never a live LLM invocation; extending that needs its own rate-limiting design, not a side effect of this milestone.

## Project Workstreams & External Artifacts (Milestone 5D, simplified)

The original M5D ("External Engineering Workbench Integration") assumed KB Sandbox would eventually execute engineering work itself. After review, that changed: the actual modernization work (OpenAPI/MCP generation) happens **entirely outside this codebase** — a consultant clones a standalone repo template (`openapi-modernizer`/`mcp-modernizer`, not part of KB Sandbox) and drives it with Claude Code against the target legacy repository. What ships here is much smaller: a **Workstream** is a scope document (repository scope, goal, a named guardrail, a deliverables checklist) that tells the consultant what to do; a **workstream artifact** is the evidence they attach when they're done. No execution, no repository access, and deliberately no automated scoring of artifacts in this pass — "automate the workflow after you understand the workflow."

- **Schema**: `project_workstreams` — an ordinary mutable table (a living scope document, not something executed against, so no immutable-versioning); `repository_scope text[]`, `deliverables jsonb` (`[{label, completed}]`), `guardrail text` (free-text reference until M5C's `guardrail_templates` exists). `workstream_artifacts` — **insert-only, no update/delete policy**, same immutability reasoning as `wiki_sources` (attach a new finding, don't edit history); `content`/`external_url` (at least one required by a check constraint) rather than a file upload — the real generated artifacts live in the consultant's external repo/PR, KB Sandbox holds a link plus a text summary.
- **RLS**: workstream management uses `can_curate_project` (owner+curator, matching `eval_datasets_manage_project_curator`'s exact precedent) — a deliberate difference from `agents`, which is owner-gated for project-scoped resources. Artifact attachment uses the broader `can_run_project_evals` (owner/curator/consultant, excludes viewer) — the consultant who did the external work is who attaches the evidence.
- **UI**: reached through a project's own page (`/projects/[id]`, a new "Workstreams" section) — `/projects/[id]/workstreams/new`, `/projects/[id]/workstreams/[workstreamId]` (scope display + a deliverables checklist + an artifacts list/attach form). No Header nav change.
- **Explicitly out of scope**: automated scoring of artifacts against expected capabilities (no eval-dataset integration), file upload, the `openapi-modernizer`/`mcp-modernizer` repo templates themselves (external), a real Guardrail Templates system (M5C), and converting a proven workstream into an executing Agent — a later, explicit decision once a workflow is proven reliable.

## Ember assistant (M5)

Ember is the conversational interface to the Workbench (`src/lib/chat/`, UI in `src/components/chat/`, persisted in `conversations`/`chat_messages`).

- **Loop.** `src/lib/chat/loop.ts` runs a bounded tool-calling loop over `AIProvider.generateChat` (`MAX_TOOL_ITERATIONS = 8`). The model proposes; tool handlers call the same Workbench services as the Server Actions, so authorization is enforced once (`src/lib/mcp/tools.ts`: "one authorization model, enforced once").
- **Tools.** Wiki and web search (`search_wiki`, `search_web`, each capped per turn), Project knowledge search, working-knowledge save/search, Project notes, Project creation/approval, Workstream creation and listing, artifact attachment, member listing, Project description and ontology (suggest, create, import a Turtle file deterministically), the navigation guide, feedback reports, and `present_assistant_response` for structured replies.
- **Project binding.** A conversation can be bound to one Project. Project-scoped retrieval applies both access layers (membership and resource-level evidence access) before anything reaches the model, and retrieved resources are recorded per message (`chat_message_retrieved_resources`).
- **Provenance.** Each assistant message stores a provider/model snapshot; the model can be switched for the next message without rewriting history. Records Ember creates (Projects, Workstreams, artifacts) carry creation-path provenance. Long conversations are summarised in the background, and that call passes the same policy gate.
- **Activity.** A polling-based activity indicator reports the current tool.
- **Role-directed shell.** Curators and admins get the full Workbench navigation plus Agency; members, consultants and viewers get the builder shell: Ember, Projects, Wiki and Blog (`src/components/Header.tsx`).

## Projects: lifecycle, approval and structure (M3.6 onward)

Beyond the M3.6 membership model:

- **Creation approval** (`20261004`). A Project created by someone below curator starts `approval_status = 'pending'` (a database trigger enforces this) and its invited members are held until approval. An admin decides, or a curator: only the creator's own agency curator if the creator is on an agency roster (`agency_builders`), otherwise any curator. Nobody can approve their own Project. Rejections can be resubmitted by the creator.
- **Status pipeline** (`20260828`, `20261004`). `draft → active → review → completed → live`, plus `archived`, with every change in `project_status_history`. Only a platform admin can delete a Project.
- **Framing fields.** Goal, objective, starter prompt (seeds Ember), portfolio category and discoverability, editable by the Project owner or curator.
- **Directory, join and access requests.** Discoverable Projects are listed in a directory; users can request to join (`project_join_requests`, decided by owner/curator). Non-member curators see safe portfolio metadata and can request membership through a Project note.
- **Ontology.** `project_objects` stores a per-Project tree of domain object *types*, editable by owner/curator or built by Ember.
- **Cloning.** Projects and Workstreams can be cloned as starting points.
- **Organization Home.** New accounts are enrolled in an Organization Home Project; self-service registration was removed (admins create accounts).

## Knowledge sources, evidence access and governance (M1/M7 foundations)

- **Knowledge sources** (`20260824`) give documents a versioned identity; knowledge bases carry a classification and curator-review lifecycle and can be attached to many Projects (`project_knowledge_bases`) and to individual Workstreams (`workstream_knowledge_bases`). Attaching never copies sources or overrides their restrictions.
- **Source submissions** (`project_source_submissions`). Any active member can submit a file, a Workstream artifact or a working-knowledge item to a Project knowledge base; the Project owner/curator approves or rejects.
- **Evidence access** (`20260825`). Project access groups, per-resource classifications and grants restrict sources, Wiki articles and artifacts *inside* a Project. `has_evidence_access()` is checked by RLS and by Ember retrieval. Members can request access to a restricted resource (`resource_access_requests`); the Project owner decides. Every change is written to `resource_access_audit_log`.
- **Project governance** (`20260824`). `project_approval_policies` (one per approval type) and `project_authority_assignments` name who decides what. Both are owner-managed, visible to members, and a required policy with no active assignment is reported as a gap.

## Information sensitivity and the AI policy gate (M7 foundation)

Who may *see* something and which AI provider may *process* it are separate decisions.

- Sources, Wiki articles, artifacts and a Project's own metadata carry an information sensitivity (`public`/`internal`/`confidential`/`restricted`); each provider has a maximum sensitivity set by an admin.
- `src/lib/ai/sensitivity.ts` builds a `ContextManifest` of everything about to be sent, computes the effective sensitivity, and `evaluatePolicy`/`assertProviderEligible` block ineligible calls **before inference**. Ember explains a block in plain language.
- Covered today: the Ember loop (including Project metadata in the system prompt), conversation summaries and ontology suggestions. Evaluation, journal generation, curator enrichment and embedding calls are not yet gated (see `docs/ROADMAP.md`, M7 Next).

## Working knowledge and Project notes

- **Working knowledge** (`20260905`) is a member's private, Project-scoped notebook. Only the owner edits an item; it can be shared with specific active members and revoked. Ember can save to it and search it. It is not retrievable as approved knowledge unless submitted and approved as a source.
- **Project notes** (`20260814`) are messages from curators/admins to a member, the Project team, curators or admins, with replies and resolution. Ember can send them and save a conversation as a note.

## Workstreams after M5D

- **Artifact lifecycle.** Artifact types now include design notes, research dossiers and implementation handoffs, and artifacts have a review status set by the Project owner/curator (`20260831`). Artifacts remain insert-only.
- **Structure.** Workstreams have summaries, deliverables, relationships to other Workstreams and their own attached knowledge bases.
- **Promotion** (`workstream_promotions`, `20260906`). A member submits a completed Workstream; the Project owner/curator (or admin) decides, never the submitter. Approval creates a **new** Project so the original is never exposed to the new team. Promoting from a builder's own workspace also copies the artifacts, adds the agency as curator, records a client fee and adds client contacts as viewers.
- **Presentations** (`20260930`). Owner/curator generates a slide presentation from a Workstream and runs a review: `draft → review_open → review_closed → builder_revision → curator_review → approved`. Reviews can be scheduled (a Vercel cron route opens them) and have deadlines. Any signed-in member can comment on slides; comments are classified into tracked actions. Nobody can approve a presentation they created. Owners and curators are notified through Project notes.

## Assessments and Methods

- **System assessments** (`20260816`). Owner/curator authors assessments with versioned question sets (`draft → active → retired`). Members other than viewers submit responses; the author or a Project curator can edit them. Completed responses can appear on a public full-detail Project.
- **Methods** (`20260927`). Owner/curator promotes a Workstream that worked into a draft Method; a platform curator or admin publishes it; owner/curator instantiates a published Method as a new Workstream. The 18-method Handbook catalog is separate Wiki content that Ember uses for method-fit reasoning.

## Publishing, blog, Trending and feedback

- **Public Project profiles** (M3.7) are unchanged, with an admin-only "full detail" option (`20260817`) that exposes Workstreams, artifacts and completed assessments. The public `/examples` routes are currently disabled by `PUBLIC_EXAMPLES_ENABLED = false` (`src/lib/showcases/public-examples.ts`).
- **Blog** (`20260821`–`20260823`). Curators draft (including Word import), illustrate, relate and submit posts; admins publish, unpublish or delete. Published posts are public at `/blog`.
- **Trending** (`20260814`). Signed-in users share links and comment; curators review, archive, mark public or promote to a Wiki draft; admins remove inappropriate links.
- **Feedback board and roadmap register** (`20260825`). Anyone signed in can file feedback, including through Ember; only the designated platform owner (`is_platform_owner`) triages reports or edits the roadmap register.

## External agents and the MCP gateway (M5)

- **External agent registry** (`/agent-registry`, `20260827`/`20260831`). Consultants and above register external agent integrations and versions; curators/admins set certification status and decide capability evaluations; integrations are made available per Project.
- **Gateway invocations** (`src/lib/mcp-gateway/`). Ember can call a registered remote MCP server. Read-only calls run in the same turn and are audited. Gated calls are proposed first and reach the external server only after the user confirms (`confirmGatewayInvocationAction`). This is the codebase's first code-level propose-confirm-execute boundary.

## External MCP server (M6 foundation)

`/api/mcp` exposes Ember to outside AI apps over stateless Streamable HTTP (`src/lib/mcp/server.ts`, `20261005`), behind `env.mcpEnabled()`.

- **Auth.** Supabase Auth acts as the OAuth 2.1 server; users approve or deny at `/oauth/consent` and can disconnect apps from their profile. The bearer token is an ordinary user JWT, so every query is RLS-scoped to that user. Restrictive policies keyed on the token's `client_id` make the connection read-only at the database level.
- **Allowlists.** An admin controls which users may connect (`mcp_access_users`) and which client redirect URIs are approved, each with a maximum sensitivity.
- **Tools (read-only).** `whoami`, `list_my_projects`, `get_project_summary`, `list_workstreams`, `search_project_knowledge`, `search_wiki`, `list_project_notes`, `get_navigation_guide`. Every result links back to Ember.
- **Limits and audit.** 30 calls per minute and 500 per day per user; every call, including denials, is logged.

## Builders and agencies

Every deployment runs the builder programme. Admin is the platform owner, a curator is an **agency**, a consultant is a **builder**. An enterprise running its own deployment is effectively the agency, and the agency dashboard serves it the same way. (Until October 2026 this was a separate `KB_SANDBOX_PRODUCT_MODE=builder` deployment mode; the modes were merged.)

- **Workspace.** Creating a consultant account provisions a `builder_lab` workspace Project. Builders may also create further Projects (pending approval) or be added to an agency's Projects. Each client proposal is a Workstream, and an accepted proposal becomes a client Project through promotion (see above).
- **Agency supervision** (`agency_builders`, `/agency`). Admins assign builders to agencies. An agency sees and decides only for its own builders; a creator on no roster can be decided by any curator. Agency and Builder Operations views are metadata-only and consent-based: names, statuses, counts, completion percentages and progress updates the builder chose to share, never notebooks, conversations, artifacts or slides.
- **Live client Projects use self-hosted AI** (`src/lib/ai/hosting-policy.ts`). A Live Project with a client fee record may use only providers flagged `is_self_hosted` for content calls.
- **Metering** (`src/lib/ai/metering.ts`, `20260907`). Ember calls on a builder's own workspace Project are priced from the registry and counted against a monthly allowance plus credit grants, with a warning threshold and optional hard stop enforced before the call. Unpriced calls are reported as unpriced. The builder's agency or the admin sees and sets the budget on `/agency`; RLS (`can_manage_builder_budget`, `20261007`) keeps other agencies out.
- **Bring your own LLM** (`builder-llm-credentials.ts`). A builder can store one encrypted credential for their own API key or local OpenAI-compatible server. Those calls are logged but never metered.
- **Live hand-over** (`20261008`). When a builder's Project goes Live, ownership passes to their agency; the builder stays on as curator and remains the builder of record (`projects.builder_id`, set only by the service layer or an admin). Metering, progress updates, the agency dashboard and the builder's fee share follow the builder of record.
- **Billing** (`client_project_fees`). Agencies record client maintenance fees; the admin sets the platform rate and the default builder's share (an employee's bonus), both recorded on each fee when it's created. The agency can adjust the builder's share per Project, and builders see theirs on their profile. Ember records figures for invoicing and never charges anyone.
- Not yet built from `docs/dev-request-kb-sandbox-builder-product.md`: the dedicated Builder Notebook, opportunity states, the five programme milestones and milestone-triggered credits.

## Other platform features

- **Branding.** Admins upload the instance icon/logo (`branding` storage, public read).
- **Work journal.** `/profile/journal` generates a reflective summary of a user's recent work, downloadable as `.docx`.

## What's explicitly not built yet

Taken from `docs/ROADMAP.md` (Next and Future items) and checked against the code. These are deliberate deferrals, not defects.

- **Knowledge.** Reviewed "promote conversation to Project Knowledge"; knowledge-quality and freshness signals; a general-purpose `/search` UI.
- **Methods.** Persisted per-Project Requirement Status; thin Wizards for 2–4 selected Methods; demand and outcome instrumentation.
- **Evaluation.** A pre-beta Ember evaluation rubric; experiment definitions and leaderboards beyond baseline-vs-run comparison; a full Runs/Tracing subsystem.
- **Ember Readiness and knowledge gaps** (`docs/dev-request-ember-readiness-and-knowledge-gaps.md`). All four stages are built (see [Who runs evaluations](#who-runs-evaluations-ember-readiness-stage-1), [Ember readiness per Project](#ember-readiness-per-project-stage-2), [Failure reports and knowledge gaps](#failure-reports-and-knowledge-gaps-stage-3) and [Automatic knowledge-gap detection](#automatic-knowledge-gap-detection-stage-4)). Not built: cross-Project gap trends on the admin dashboard; members attaching candidate sources directly to a gap; embedding-based grouping (word overlap is used).
- **Solution evaluation** (`docs/dev-request-solution-conformance-and-acceptance-evaluation.md`). `/evals` measures Ember and Agents only. There is no model for evaluating a Project's delivered solution: no requirements traced to standards or contract clauses, verification records, evaluation baselines, conformance decisions, waivers or re-verification triggers. System assessments and capability evaluations remain separate and unchanged.
- **Agents.** Tool calling for Agents; Guardrail Templates with runtime enforcement (guardrails remain free text); multi-agent collaboration; autonomous research or code-writing.
- **Governance (M7).** AI system and model inventory, risk tiers, control definitions, evaluation gates and approval records; policy-gate coverage of evaluation, journal, enrichment and embedding calls; model- and deployment-level eligibility; versioned organization-level AI policy; redact/route/approve outcomes; retention and privacy rules.
- **Deployment (M6).** Defined cloud/customer-cloud/private/local/hybrid profiles, health checks and provider failover.
- **Communicate and Teach (M8, M9).** Reviewed report types, executive reports and exports; role-based learning paths.
- **Platform.** A native Organization record or multi-tenant boundary; Project hierarchy or membership inheritance; real anonymous sign-in sessions (`profiles.role = 'anonymous'` remains dormant); public Project examples (built, but switched off).
