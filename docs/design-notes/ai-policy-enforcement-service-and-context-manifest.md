# AI Policy-Enforcement Service and Context Manifest

**Status:** proposed — architecture note only, no code/schema changes made to produce it.
**Requested by:** [Enterprise Shadow AI Governance — Later Phases](../dev-request-enterprise-shadow-ai-governance-later-phases.md), recommended-sequencing step 2 ("produce a short architecture note for the shared policy-enforcement service and context manifest" before Phase 2 implementation begins).
**Depends on:** the Information Sensitivity Classification release (`src/lib/ai/sensitivity.ts`, `resource_access_policies.information_sensitivity`, `ai_provider_sensitivity_eligibility`, and the `projects.information_sensitivity` follow-up that closed the "project metadata in system prompts" gap — all shipped and live as of 2026-08-29).

## 1. Purpose and how to use this note

This note does two things the dev request's sequencing asks for before Phase 2 starts:

1. Names the **current, concrete architecture** the Phase-1 classifier actually has today — not the conceptual model the dev request sketches, but what's really in the repo, with file:line citations, including which outbound AI call sites are gated and which aren't yet.
2. Proposes the **shape** of the "shared policy-enforcement service" and "context manifest" Phase 2 asks for, designed to grow the existing `sensitivity.ts` in place rather than replace it with a parallel system.

It does not implement anything. It does not commit to the dev request's full conceptual data model (`AI processing policy`, `Policy rule`, `Environment evaluation profile`, etc.) — per that document's own instruction to "consider, but not commit prematurely to" that model. It answers the "Decisions required before Phase 2" list only provisionally, scoped to what Phase 2 actually needs to start.

## 2. Current baseline (grounding)

### 2.1 One gate exists today, and it lives inline in the caller, not in a shared service

The only enforcement point in the codebase is `src/lib/chat/loop.ts:395-400`, inside `runAssistantTurn`'s tool-iteration loop:

```ts
const sensitivity = await getEffectiveSensitivity(ctx.supabase, {
  wikiArticleSlugs: [...retrievedWikiArticleSlugs.keys()],
  knowledgeSourceIds: [...retrievedKnowledgeSourceIds.keys()],
  projectSensitivity: projectContext ? projectContext.informationSensitivity : undefined,
})
await assertProviderEligible(ctx.supabase, chatProviderId, sensitivity)
```

`getEffectiveSensitivity` and `assertProviderEligible` (`src/lib/ai/sensitivity.ts`) are plain exported functions — not wired into `AIProvider` resolution, not callable by any other file today. Every other outbound AI call site in the repo has zero sensitivity check.

### 2.2 `withLogging` already proves the "shared service" shape Phase 2 asks for — for one different concern

`src/lib/ai/logging.ts`'s `withLogging(provider, context)` wraps an `AIProvider` so all four methods (`generateText`, `generateStructured`, `generateChat`, `embed`) are recorded to `ai_operation_logs` without each call site remembering to log. It is applied at exactly one layer — provider *resolution* — in `src/lib/ai/registry.ts`, at every one of its five resolver functions:

- `getProviderByName` (`registry.ts:171`)
- `getActiveProvider` (`registry.ts:185`)
- `getActiveEmbeddingProvider` (`registry.ts:200`)
- `getActiveStructuredOutputProvider` (`registry.ts:237`)
- `resolveChatProvider` (`registry.ts:268`)

Every real call site in the app gets a provider through one of these five functions, so `withLogging` reaches all of them for free. This is precisely the "shared service used by Ember, evaluations, generators and future agents rather than duplicating checks in individual UI actions" pattern Phase 2 asks for — it already exists, just for logging, not policy. §3 below reuses this exact insertion point.

**Important limitation this note has to design around:** `withLogging` wraps the provider *once*, at resolution time, before the caller has decided what evidence it's about to send. That's sufficient for logging (which only needs the call to have happened) but not sufficient for policy (which needs to know *what's in the request* before it's sent). `loop.ts`'s gate works around this by re-evaluating sensitivity **inside the loop**, once per iteration, using evidence accumulated so far (`retrievedWikiArticleSlugs`/`retrievedKnowledgeSourceIds`, both `Map`s that grow across tool calls) — not at the point `chatProvider` was resolved. Any shared design has to keep this distinction; see §3.3.

### 2.3 Outbound AI call-site inventory — what Phase 2 actually has to cover

Every real call into an `AIProvider` method, found via `.generate(Text|Structured|Chat)(` / `.embed(`:

| Call site | Method | Evidence it sends | Gated today? |
| --- | --- | --- | --- |
| `chat/loop.ts:402` (Ember's turn loop) | `generateChat` | Retrieved Wiki/knowledge-source evidence + project metadata | **Yes** (Phase 1) |
| `chat/summary.ts:90` (`maybeRefreshSummary`) | `generateStructured` | The **entire conversation transcript**, via a **separately resolved** provider (`getActiveStructuredOutputProvider`, not the turn's `chatProvider`) | **No** |
| `eval/judge.ts:36` | `generateStructured` | A candidate answer plus the question/expected-answer evidence from an eval dataset | No |
| `eval/generation.ts:25` | `generateText` | The eval case's prompt, built from dataset/project evidence | No |
| `eval/retrieval.ts:40` | `embed` | The eval question text | No |
| `journal/generate.ts:358,400` | `generateStructured` | User's own journal entries (personal, but still leaves the environment) | No |
| `curator/enrichment.ts:21` | `generateStructured` | A chunk's raw text, pre-approval | No |
| `curator/chunks.ts:81` | `embed` | A chunk's raw text, pre-approval | No |
| `wiki/synthesis.ts:48` | `generateStructured` | Source material being synthesized into a Wiki draft | No |
| `wiki/review.ts:58` | `embed` | An approved Wiki version's content | No |
| `mcp/tools.ts:203`, `chat/project-knowledge-tool.ts:82` | `embed` | The user's search query text (not the retrieved content itself) | No |
| `graph/nodes.ts:120` | `generateStructured` | Whatever a graph node's step passes in — future agent-graph surface | No |

`chat/summary.ts:90` is the most urgent of these, and worth calling out specifically: it doesn't just skip the gate, it **reuses a differently-resolved provider** than the one the live turn's gate just checked. A conversation could pass the Phase-1 gate on its `chatProvider` selection and, moments later, have `maybeRefreshSummary` send the same transcript (potentially containing Restricted evidence retrieved earlier in the conversation) to whatever provider currently holds `is_default_structured_output`, with no eligibility check at all. This is the same shape of gap the project-metadata fix just closed (content reaching a model outside the one checked path) and should be first in Phase 2's coverage work, not folded in generically with the rest of the table.

### 2.4 What the manifest looks like today (implicitly) vs. what Phase 2 needs

`getEffectiveSensitivity`'s input today is an ad hoc object:

```ts
{ wikiArticleSlugs: string[]; knowledgeSourceIds: string[]; projectSensitivity?: InformationSensitivity | null }
```

This is a proto-manifest with three properties, two resource types, and no record of *why* each resource is in it or what (if anything) was done to it. The dev request's Phase 2 asks for a manifest covering knowledge sources, Wiki articles, workstream artifacts, chat attachments, generated documents/journals, structured records, prompt attachments, and tool results — and for it to carry "the resource identifiers, classifications and transformations applied to the proposed request," not just an aggregate tier. §3.2 proposes the typed replacement.

## 3. Proposed target shape

### 3.1 Keep `sensitivity.ts` as the reference implementation; grow it, don't replace it

`getEffectiveSensitivity` + `assertProviderEligible` already implement the exact policy Phase 2 needs for the "Allow" and "Block" outcomes (of the five the dev request eventually wants — Allow/Redact/Route/Approve/Block). Phase 2 should evolve these two functions in place into the shared service, not start a parallel `src/lib/ai/policy/` system that then has to be reconciled with them. Concretely:

- `getEffectiveSensitivity(supabase, manifest)` becomes the manifest-typed sibling of today's function (same logic, typed input — see §3.2).
- `assertProviderEligible(supabase, providerId, sensitivity)` becomes `evaluatePolicy(supabase, manifest, subject)` — same eligibility check, but returning a decision record instead of only throwing (§3.3), so later phases can add Redact/Route/Approve outcomes without changing the function's contract again.
- The existing `AISensitivityError` stays exactly as it is — it's still the right shape for the two outcomes that exist today (allow silently, block loudly), and `loop.ts`'s catch-and-return-`isSensitivityBlock` handling doesn't need to change for Phase 2.

### 3.2 The context manifest

```ts
// A manifest doesn't need every field populated -- most callers today would
// only ever fill wikiArticles/knowledgeSources. It exists so the shape is
// defined once, in one place, before Phase 2 code starts touching seven
// different call sites in seven different ways.
export interface ContextManifestEntry {
  resourceType: EvidenceResourceType | 'project' | 'chat_attachment' | 'generated_document' | 'tool_result'
  resourceId: string
  // How this entry got into the manifest -- not enforced today, but this is
  // the field Phase 3's transformation manifest (redaction, sanitized
  // release) attaches to, so it needs to exist on the type before Phase 3
  // needs it, even if every entry's value is 'retrieved' for now.
  origin: 'retrieved' | 'project_metadata' | 'user_attached' | 'generated' | 'tool_output'
}

export interface ContextManifest {
  entries: ContextManifestEntry[]
  // Present only for a project-bound call -- kept as a distinct field
  // (not just another entry) because project sensitivity is looked up
  // differently (a column on `projects`, not a resource_access_policies
  // row) -- see the project-metadata fix's own comment for why.
  projectSensitivity?: InformationSensitivity | null
}
```

`getEffectiveSensitivity`'s current two-array-plus-one-optional-field signature is this manifest with the wrapper stripped off; the migration is a rename plus a loop that turns `wikiArticleSlugs`/`knowledgeSourceIds` into `entries`, not a redesign. `loop.ts` already builds the two arrays incrementally across iterations (`retrievedWikiArticleSlugs`/`retrievedKnowledgeSourceIds`, both `Map`s) — that becomes "append to `manifest.entries` as evidence is retrieved," same control flow.

### 3.3 Two consumption modes, one implementation

The `withLogging`-style decorator and the `loop.ts`-style inline check are both needed — not as a choice, but because the codebase has two genuinely different call shapes (§2.2's limitation):

**Single-shot callers** (§2.3's `summary.ts`, `judge.ts`, `generation.ts`, `enrichment.ts`, `synthesis.ts`, `journal/generate.ts` — the manifest is fully known before the one call happens): a decorator mirroring `withLogging`, applied at the same `registry.ts` resolution points:

```ts
export function withPolicyGate(provider: AIProvider, manifest: ContextManifest, context: PolicyContext): AIProvider
```

**Iterative callers** (Ember's tool loop today; future agent graphs, per the dev request's Phase 2 goal of covering "future agents"): the manifest grows across iterations, so the gate must be callable directly, re-evaluated before each model call with the manifest-so-far — exactly what `loop.ts` already does. The shared service should keep exposing this as a plain function, not force iterative callers through a decorator that can only wrap a provider once:

```ts
export async function evaluatePolicy(supabase, manifest: ContextManifest, subject: PolicySubject): Promise<PolicyDecision>
```

`withPolicyGate` is a thin wrapper around `evaluatePolicy` (build the manifest once, call it once, before each of the four provider methods) — one enforcement implementation, two ergonomic entry points, matching the fact that `withLogging` and `loop.ts`'s own gate already coexist today for the same reason.

### 3.4 `PolicySubject` and `PolicyDecision` — sized for today, shaped for later

```ts
// providerId is all Phase 1 needs (ai_provider_sensitivity_eligibility is
// keyed by provider only). modelId is optional and unused until Phase 2
// decision #3 below is acted on -- included now so the function signature
// doesn't change shape twice.
export interface PolicySubject {
  providerId: string
  modelId?: string
}

export interface PolicyDecision {
  // Only 'allow' | 'block' are possible outcomes until Phase 3. The type
  // includes the other three now so Phase 3 doesn't have to touch every
  // caller's switch/if again -- callers only need to handle the two
  // outcomes that can actually occur today.
  outcome: 'allow' | 'block' | 'redact' | 'route' | 'require_approval'
  effectiveSensitivity: InformationSensitivity
  reason?: string
}
```

## 4. Decisions required before Phase 2 (provisional answers)

The dev request lists eight open decisions. Phase 2 can start with these provisional answers; none of them require new infrastructure beyond what's already shipped or proposed in §3.

1. **Policy owner boundary before a native Organization tenant exists.** ADR-0001 committed to dedicated-instance-per-customer deployment, not a multi-org data model — so the policy owner is the deployment's own platform admin (`profiles.role = 'admin'`), one AI-processing policy per deployment. Projects only ever narrow via resource/project-level classification (already live), never redefine provider eligibility itself.
2. **Which AI services beyond conversational generation must be gated at launch.** Priority order from §2.3's inventory: `chat/summary.ts` first (§2.3's urgent finding), then `eval/judge.ts` + `eval/generation.ts` + `eval/retrieval.ts` (evaluation runs routinely process project evidence through arbitrary configured providers), then `journal/generate.ts` + `curator/enrichment.ts`, then the `embed()` call sites last (embeddings are one-directional and lower-risk, but still in-scope per the dev request's own principle 2 — don't defer them indefinitely).
3. **Provider, model, or deployment endpoint eligibility.** Keep provider as the coarse default (already implemented). Add an optional, nullable `model_id` to `ai_provider_sensitivity_eligibility` (or a sibling table mirroring the existing `ai_providers`/`ai_models` split) so a specific model can override its provider's ceiling — most-specific-match-wins, provider row remains the fallback. This is additive to the existing schema, not a redesign.
4. **Safe default for unclassified content.** Keep the already-implemented, already-tested default: unclassified defaults to `'internal'`, never `'public'`. No change for Phase 2.
5. **Who may raise/lower/approve a sanitized release.** Until Phase 5's formal workflow exists, keep this at the existing `can_manage_project` boundary (project owner or platform admin) already enforced by RLS on `resource_access_policies`. A lowered tier should require the existing `rationale` field to be filled and continue writing to the existing `resource_access_audit_log` — no new workflow needed yet.
6. **Which events may be aggregated for governance without exposing content.** Extend `ai_operation_logs`'s existing shape (provider/model/latency/tokens/success/error_code, zero prompt content) rather than inventing a new logging table — add `policy_outcome`, `effective_sensitivity`, and `policy_version` columns to it, or a narrow sibling table with the same non-content discipline.
7. **Retention period for policy decisions, redaction manifests, exceptions.** No retention precedent exists anywhere in this codebase today (nothing currently sets a TTL). This is a per-customer contractual question under the dedicated-instance model (ADR-0001), not a schema question — leave it as deployment configuration, don't hardcode a period in Phase 2.
8. **Which Sandz/private inference environment for the showcase.** Not yet answerable — Sandz edge deployment requirements are still being scoped (`docs/sandz-edge-deployment-requirements-lunch-agent.md`). Blocking external dependency; revisit when Phase 7 is actually scheduled.

## 5. What this note deliberately does not do

- Does not implement `ContextManifest`, `evaluatePolicy`, or `withPolicyGate` — that's Phase 2 implementation work, sequenced after this note per the dev request.
- Does not commit to the dev request's full conceptual data model (`AI processing policy`, `Policy rule`, `AI environment profile`, `Approval request`, `Exception`, `Environment evaluation profile`) — those stay conceptual until Phase 2/5 design actually needs them.
- Does not touch `chat/summary.ts` or any other ungated call site from §2.3 — flagging them is this note's job; closing them is Phase 2's.
- Does not resolve decision 7 (retention) or 8 (Sandz environment) beyond naming them as blocked on non-technical/external input.

## 5a. Coverage status (October 2026, branch `ccr-8b20ec22-local-llm-readiness`)

§2.3's inventory, updated. "Gated" means the call goes through `withPolicyGate`/`gateProvider` with a manifest built in `src/lib/ai/policy-manifests.ts`, and is blocked (`AISensitivityError`) when the manifest's effective sensitivity is above the provider's ceiling.

| Call site | Manifest | Status |
| --- | --- | --- |
| Ember turn loop | Retrieved evidence + Project | Gated (Phase 1) |
| Conversation summary | Transcript's retrieved resources + Project | Gated (Phase 2, increment 1) |
| Chunk enrichment on upload / "enrich more" | Document's knowledge source + inherited floor | **Gated** |
| Chunk embedding (approve, approve remaining, submission auto-approve) | Same | **Gated** |
| Project knowledge search query embedding (Ember and external MCP) | Project | **Gated** |
| Wiki AI draft from chunks / from an artifact | Source documents / artifact + its Project | **Gated** |
| Wiki approval embedding | Article + everything it was written from | **Gated** (a block skips embedding; the approval stands) |
| Presentation generation and comment triage | Project + every artifact on the Workstream | **Gated** |
| `eval/judge.ts`, `eval/generation.ts`, `eval/retrieval.ts` | — | Not yet |
| `graph/nodes.ts` (RAG Answer Agent) | — | Not yet |
| `journal/generate.ts` | — | Not yet |
| `search_wiki` query embedding (platform Wiki; no Project in the tool's context) | — | Not yet |
| Blog Word import | — | Not gated by design: authored for public release, no classified resource involved |

**Inherited floor (`ContextManifest.minimumSensitivity`).** A document is enriched as soon as it's uploaded, before anyone can classify its new knowledge source, so the source would read as unclassified (`internal`). The floor closes that window: a document carries at least the highest classification of any Project that uses its knowledge base, whether the base is attached to the Project, attached to one of its Workstreams, or owned by it.

**Block, not route.** A blocked call fails with the policy message. Enrichment records `ai_policy_blocked` on the chunk and stops; the rest stay pending. Nothing is re-sent to a different provider: that's Phase 3's `route` outcome. To process Confidential/Restricted material, an eligible model must be the deployment's default for that role (structured output, embeddings).

## 6. Related documents

- [Enterprise Shadow AI Governance — Later Phases](../dev-request-enterprise-shadow-ai-governance-later-phases.md) — the dev request this note answers step 2 of.
- [ADR-0001: Dedicated-Instance-First Deployment](../architecture-decisions/ADR-0001-dedicated-instance-first-deployment.md) — grounds decision 1 above.
- `src/lib/ai/sensitivity.ts`, `src/lib/ai/logging.ts`, `src/lib/ai/registry.ts` — the code this note builds on.
