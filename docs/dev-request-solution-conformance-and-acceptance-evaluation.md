# Solution Conformance and Acceptance Evaluation

## Status

Stages 1 (requirements register) and 2 (verification records) built 5 October 2026, Stages 3 (baselines and conformance decisions) and 4 (re-verification triggers) 6 October 2026; Stage 5 proposed. Worked example: the `cebu-ng911` Project.

## Delivery stages

1. **Requirements register** — requirements with sources, scope and verification methods; the Project's Requirements area. *Built.*
2. **Verification records** — append-only results with artifact evidence, against an identified solution state. *Built.*
3. **Baselines and conformance decisions** — frozen baselines, verdict roll-up, waivers, decisions through approval policies and authorities. *Built.*
4. **Re-verification triggers** — component changes, new source versions, review dates, threshold breaches. *Built.*
5. **Ember tools** — `propose_requirements`, `list_requirement_status`, `propose_verification_method`.

**As built (Stage 1, 5 October 2026):**

- **Tables** (`20261017100001_solution_requirements.sql`): `solution_requirements` (code unique per Project, category, priority, `applies_from`, status `draft`/`baselined`/`superseded`/`withdrawn`), `solution_requirement_sources` (kind, optional linked knowledge source and/or Project Wiki article, clause locator, requester for a customer need), `solution_requirement_scope_links` (a workstream or a Project object, each checked to be in the same Project) and `solution_verification_methods` (method, pass criteria, threshold and window required for an operational measure, performer).
- **Rules:** every Project member reads the register; the Project's owner/curators and platform admins write it. A requirement and its sources, scope and methods change only while it is a draft; afterwards it can only be withdrawn or superseded and never reopened. A draft can be deleted. A new requirement needs at least one source; a customer need needs a named requester, and any other source needs a linked source, Wiki article or clause locator. A cited knowledge source records its current version for Stage 4.
- **Evidence access:** a source row citing a restricted knowledge source or Wiki article is hidden from anyone without a grant, curators included (the write policies are split by command so none of them also grants read).
- **What can be cited:** sources in the Project's and its workstreams' knowledge bases (the same scope as Ember's Project search) and Wiki articles attached to the Project. A standard held elsewhere can still be cited by clause locator.
- **UI:** `/projects/[id]/requirements` (filters by status, workstream and category; counts of drafts, baselined, requirements without a verification method, and vendor-claim citations), `/requirements/new` (code suggested as the next `REQ-nnn` if left blank), and `/requirements/[requirementId]` (sources, scope, verification methods, edit while draft, withdraw, delete draft). A *Requirements* summary on the Project page.
- **Not yet:** setting `baselined` (Stage 3); superseding with a linked replacement (Stage 3); requirements on the workstream page.

**As built (Stage 2, 5 October 2026):**

- **Tables** (`20261019100001_solution_verification_records.sql`): `solution_verification_records` (requirement, method, result, conditions, rationale, measured value, environment `lab`/`factory`/`staging`/`site`/`production`/`vendor`/`other`, build or component versions, configuration reference, date performed, observations, issue reference, `supersedes_id`, recorded by/at) and `solution_verification_evidence` (record ↔ workstream artifact).
- **Append-only:** RLS has read policies only; writes go through `record_solution_verification()`, which saves a record and its evidence together, and a trigger refuses any update (except the method link clearing when a draft's method is removed). A correction is a new record superseding the old one; a record can be superseded once (unique index), and the history stays readable.
- **What it was judged against:** each record copies the method kind, pass criteria, threshold and window, so editing a draft's method later never changes what a past result meant.
- **Rules:** the Project's owner, curators and consultants (and platform admins) record (`can_run_project_evals`); viewers read. Results can be recorded on draft and baselined requirements, not withdrawn or superseded ones. A pass or conditional pass needs at least one evidence artifact; a conditional pass needs conditions; not applicable needs a rationale; an operational measure needs the measured value; the date can't be in the future. Evidence must be an artifact in one of the Project's workstreams that the recorder can see. A requirement with records can't be deleted, only withdrawn.
- **Evidence access:** evidence citing a restricted artifact is hidden from anyone without a grant; the record itself (result, solution state) stays visible to members.
- **Roll-up** (`src/lib/projects/verification.ts`): the current result per method is the latest in effect (not superseded) by date performed; a requirement is *failed* if any method's current result failed, *passed* if every method passed or is not applicable, *conditional* if every method passed, conditionally passed or is not applicable, *partly verified* if some have results, otherwise *not verified* (or *no method*).
- **UI:** on a requirement, each method shows its current result and **Record result**; a **Verification history** lists every record with evidence links, corrections and what they superseded, with **Correct** on records in effect. The register gains a *Verification* column and passed/failed/not-verified counts; the Project page's *Requirements* section shows passed and failed.
- **Not yet:** results rolled up into baselines and decisions (Stage 3); re-verification due (Stage 4); linking a system assessment answer as `inspection` evidence.

**As built (Stage 3, 6 October 2026):**

- **Tables** (`20261020100001_solution_baselines_and_decisions.sql`): `solution_evaluation_baselines` (name, purpose, lifecycle stage, version, previous version, status `draft`/`active`/`superseded`), `solution_evaluation_baseline_items`, `solution_waivers` (waiver or deviation, rationale, conditions, approval type, status), `solution_conformance_decisions` (decision type, approval type, approvals needed and mode copied from the policy, status, snapshot) and `solution_conformance_decision_approvals` (one verdict per approver).
- **Baselines:** curators create a draft and choose its requirements. Activating needs at least one requirement, each open and with a verification method; it moves draft requirements to `baselined` (fixing their content, sources, scope and methods) and freezes the baseline and its items (RLS and triggers). A new version is a draft copy with the next version number; requirements that were superseded are carried over as their replacements, withdrawn ones left out. Activating the new version supersedes the old one, which stays readable with its decisions.
- **Authority:** `holds_project_authority()` — an active, in-date assignment of the approval type held by an active member. Platform admin status alone is never authority. Self-approval (the requester, or for decisions anyone who recorded evidence in effect for the baseline) is refused unless both the Project's policy and the approver's assignment allow it.
- **Waivers:** owners, curators and consultants request one per requirement per active baseline, with a rationale; a holder of the named authority approves or rejects; the requester or a curator can withdraw a pending one. Approved waivers show as *waived* in every roll-up of that baseline (a pass still shows as passed).
- **Decisions:** curators request a decision over an active baseline (presales claim validation, factory, site or customer acceptance, go-live, post-change re-verification) for an approval type the policy doesn't mark not applicable; one pending decision of each kind per baseline. Each holder gives one verdict; a rejection (with a reason) decides it, otherwise it is approved at the policy's minimum approvals, or when every current holder has approved for `all_assigned`. On deciding, the decision keeps a snapshot of each requirement's methods, the verification records in effect and any approved waiver, so its roll-up reads the same forever. Decided waivers and decisions can't change.
- **Superseding a requirement:** a baselined requirement can be superseded by a new draft copying its content, sources, scope and methods (code suggested as `<code>-R2`); the old one is marked superseded and links to it.
- **Notifications:** current holders of the approval type get a Project note when a waiver or decision needs them.
- **UI:** `/projects/[id]/requirements/baselines` (list with latest decision), `/baselines/new`, and `/baselines/[baselineId]` (requirements with live roll-up, versions, activate, new version, waivers, decisions with approvals and the roll-up each rested on). Requirement pages show the baselines they are in, the replacement link, and **Supersede with a new version**.
- **Not yet (at Stage 3):** re-verification due and blocking a `production_change` decision until re-verified — built in Stage 4.

**As built (Stage 4, 6 October 2026):**

- **Tables** (`20261021100001_solution_reverification.sql`): `solution_reverification_events` (kind `component_change`/`source_revision`/`threshold_breach`/`other`, summary, versions or configuration, detail, component and workstream, cited source and its new version, the triggering record, recorded by/at) and `solution_reverification_event_requirements` (the requirements each event affects, with an optional curator resolution and note). `solution_requirements.review_interval_months` (1–120) sets a review schedule; it is operational, so it stays editable after baselining.
- **When a requirement is due** (`project_reverification_due()`, the one definition used by the app and the decision check): an affected link is unresolved and some current verification method has no result other than *not run* recorded after the event (or the requirement has no method); or it is baselined with a review interval and its least recently verified method was last performed longer ago than that.
- **Triggers:**
  - *Component and other changes:* owners, curators and consultants record a change and the open requirements it affects. Choosing a component (Project object) preselects requirements scoped to it or its sub-components; choosing a workstream preselects requirements scoped to it. Owners and curators get a Project note.
  - *New source version:* when a knowledge source's current version changes, every open requirement citing an earlier version is flagged, one event per Project (a failure only warns and never blocks the upload).
  - *Threshold breach:* recording a fail on an operational measure creates an event for that requirement.
  - *Scheduled review:* derived from the review interval; no job needed.
- **Clearing:** recording a new result for each method clears the event for that requirement; a curator can instead resolve it with a reason (e.g. "revised clause doesn't affect us"). Past records, baselines and decisions are untouched.
- **Production changes:** `decide_solution_conformance_decision()` refuses to approve a `production_change` decision while any requirement in the baseline is due; other approval types are unaffected.
- **UI:** `/projects/[id]/requirements/changes` (what needs re-verification, **Record a change**, the change history with each requirement's state: needs re-verification, re-verified, resolved or requirement closed). Requirement pages show *Re-verification due* with the open events, **Resolve without re-verifying** (curators) and the review schedule. The register, baseline pages and the Project page's *Requirements* section show what needs re-verification.


## Problem

Ember's only scored evaluation surface today is `/evals` (Milestone 3). It measures **the AI**: whether Ember, an Agent or a retrieval configuration answers questions correctly and grounds its answers in the Project's knowledge. That is valuable, but it is not what most Projects need to govern.

Ember is a governance workbench for Projects of any kind, including systems integration and implementation work. In those Projects the thing that must be evaluated is **the delivered solution**, not Ember. For NG911:

- in **presales**, vendor claims must be validated (is K-Safety NENA i3 conformant? does its AVL engine support the radio fleet's protocol?);
- in **deployment**, the integrated system must pass acceptance against requirements drawn from standards (NENA), regulation and the contract;
- in **management and maintenance**, the live solution must keep meeting those requirements and its service levels, and must be re-verified after vendor upgrades or configuration changes.

Ember does not build or test the NG911 system. Integrators, vendors and testers do that outside Ember. Ember's job is to **govern** the evaluation: turn standards and contract terms into requirements, define how each will be verified, hold the evidence, route the pass/fail decision to the right human authority and keep the record current through the solution's life.

Today the pieces exist but are not connected:

| Existing feature | What it gives us | What it lacks for this purpose |
|---|---|---|
| System assessments (`20260816110001_system_assessments.sql`) | Versioned question sets per Project, responses with `CONFIRMED / INFERRED / UNKNOWN` and evidence text | Framed around assessing "the Project's AI system"; no link to requirements, standards clauses or approvals; evidence is free text |
| Capability evaluations (`20260906110001_capability_evaluations_schema.sql`) | Evidence-gated promotion ladder with staff decisions | Scoped to external AI agent integrations only |
| Workstream artifacts (`test_results`, `evidence_map`, `findings`) | A place to attach test reports and evidence | Not tied to a requirement or a verdict |
| Project approval policies (`technical`, `customer_acceptance`, `production_change`, …) | Authority, sequencing and no-self-approval rules | Nothing to approve against at requirement level |
| Workstream `lifecycle_stage` (`presales / deployment / management_maintenance`) | The Project lifecycle Ember already models | No evaluation behavior changes between stages |
| Knowledge bases and Wiki | NENA and vendor documents as retrievable evidence | No way to cite a specific clause as the origin of a requirement |

The missing piece is the traceability thread:

```text
source clause (NENA, contract, regulation, customer need)
  -> requirement
    -> verification method (acceptance test, inspection, analysis, demonstration, operational measure)
      -> execution with evidence
        -> verdict
          -> human decision (approval)
            -> re-verification when something material changes
```

## Decision

Add a **Solution Evaluation** capability to Projects, distinct from `/evals`:

- `/evals` stays as **AI evaluation**: "can we trust Ember's answers on this Project?"
- **Solution evaluation** answers: "does the Project's solution meet its standards, requirements and contract, and does it keep meeting them?"

Both are evaluation, but they judge different subjects and must never share result tables. An AI eval score is never evidence that the solution conforms, and a solution verdict is never an automatic score.

Build on existing tables and patterns wherever possible: Project membership and evidence access for authorization, workstream artifacts for evidence, approval policies and authority assignments for decisions, `lifecycle_stage` for phase behavior, and the assessments versioning pattern for frozen baselines.

## Concepts

### Requirement

A single verifiable statement the solution must satisfy.

- `code` (e.g. `NG911-LOC-003`), `title`, `statement`, `rationale`.
- `category`: functional, interface, performance, security, privacy, operational, regulatory, contractual.
- `priority`: must / should / could.
- `origin`: one or more **source references** (see below). A requirement without an origin is allowed only as `customer_need` with a named requester.
- `scope`: optional links to workstreams (e.g. *Mitel PBX Integration*) and to Project objects (`project_objects`), reusing `workstream_object_links`' approach.
- `applies_from`: the lifecycle stage from which it must be verified (`presales`, `deployment`, `management_maintenance`).
- `status`: draft / baselined / superseded / withdrawn.

### Source reference

A pointer from a requirement to the authority that created it.

- Kind: `standard` (e.g. NENA i3), `regulation` (e.g. national 911 rules, the Data Privacy Act), `contract` (clause or SLA schedule), `customer_need`, `vendor_claim`.
- Points at an existing knowledge resource where one exists (source document version, chunk or Wiki article) plus a human-readable clause locator (section, table, page).
- Respects evidence access: a requirement whose source is restricted shows the locator only to members with access to that resource.

`vendor_claim` matters in presales. A vendor statement ("K-Safety is NENA i3 conformant") is recorded as a claim to verify, never as a satisfied requirement.

### Verification method

How a requirement will be shown to be met. One requirement can have several.

- `method`: `test` (executed acceptance test), `demonstration`, `inspection` (document or configuration review), `analysis`, `vendor_evidence` (certificate or third-party report), `operational_measure` (a metric observed over time).
- `procedure`: steps, preconditions and environment.
- `pass_criteria`: explicit and checkable. For an operational measure, a threshold and window (e.g. "≥ 90% of calls answered within 15 s, measured monthly"; take the exact figures from the governing standard or contract in the knowledge base).
- `performed_by`: role expected to execute it (vendor, integrator, customer, independent tester).

### Verification record

One execution of a verification method against an identified solution state.

- Solution reference: environment (lab, staging, production), component versions or build, configuration reference, date.
- Result: `pass`, `fail`, `conditional_pass` (with conditions), `not_run`, `not_applicable` (with rationale).
- Evidence: linked workstream artifacts (`test_results`, `evidence_map`, `findings`, file or link) — a narrative assertion alone is not evidence.
- Observations and defects (free text plus an optional external issue reference).
- Recorded by, recorded at. Records are append-only; a correction is a new record that supersedes the old one.

### Evaluation baseline

A frozen, versioned set of requirements and verification methods for a purpose and stage, e.g. *Cebu NG911 Phase 1 Site Acceptance*. Mirrors the assessment and eval-dataset rule: once a baseline leaves `draft`, its contents are frozen by RLS, so an acceptance decision can always be read against exactly what was agreed. Changing scope means a new baseline version.

### Conformance decision

A human decision over a baseline (or a subset of it) at a point in time: *presales claim validation*, *factory/site acceptance*, *customer acceptance*, *go-live*, *post-change re-verification*.

- Uses `project_approval_policies` / `project_authority_assignments` for who may decide (`technical`, `security_compliance`, `customer_acceptance`, `production_change`).
- Shows the verdict roll-up: requirements passed, failed, conditional, not yet verified, waived.
- Waivers and deviations are explicit, carry a rationale and an authority, and appear in every later report.
- No self-approval, matching the rest of Ember.

### Re-verification trigger

In `management_maintenance`, a decision is a point-in-time statement. These events reopen the affected requirements (status becomes *re-verification due*) while keeping prior records readable:

- a component version, firmware or configuration change recorded on the Project;
- a new version of a source document (e.g. a revised NENA standard or a contract amendment) that a requirement cites;
- an operational measure falling outside its threshold;
- a scheduled review date passing.

## Ember's role

Ember assists but never decides.

- **Draft requirements from sources.** Given a NENA document, contract schedule or meeting notes in the Project's knowledge, Ember proposes draft requirements, each citing the clause it came from. Drafts need curator acceptance before they enter a baseline.
- **Propose verification methods** and pass criteria for a requirement, drawing on the Workbench handbook and the source.
- **Identify gaps:** requirements with no verification method, methods never executed, failed or stale records, vendor claims not yet substantiated, source clauses with no requirement.
- **Answer traceability questions:** "Which requirements does the Mitel PBX integration still owe?", "What evidence supports caller-location delivery?", "What changed since the last acceptance?"
- **Summarise evidence** attached to a record, flagging when it does not match the pass criteria.

Ember must not: record a `pass` on its own authority, approve a conformance decision, treat a vendor claim as verified, or present web search results as evidence. These rules follow the existing policy gate and provenance rules for the assistant.

New assistant tools (names indicative):

- `propose_requirements` — creates draft requirements with source references; visible as a created record for review.
- `list_requirement_status` — read-only traceability and gap view for the bound Project.
- `propose_verification_method` — draft method attached to an existing requirement.

All three respect Project membership, evidence access and the AI policy gate.

## Lifecycle behavior (NG911 worked example)

### Presales

- Import NENA i3 and related documents into the Project knowledge base (already done for `cebu-ng911` sources).
- Ember drafts requirements for the three integration workstreams (CCTO Motorola radio, Mitel PBX, KabatOne K-Safety) and records vendor claims as `vendor_claim` sources: i3 conformance, regional hub gateway mapping, offline map caching, AVL protocol support.
- Verification methods at this stage are mostly `vendor_evidence`, `inspection` and `demonstration`.
- A *Presales claim validation* decision tells the proposal team which claims are substantiated, which are conditional and which remain open, before pricing and proposal release approvals.

### Deployment

- The requirement set is baselined as e.g. *Phase 1 Site Acceptance v1*.
- Integrators run tests outside Ember (SIP trunking and location delivery from Mitel to K-Dispatch, AVL positions from the radio gateway on the operational map, TDoS protection, call recording, failover to the regional hub) and attach results as artifacts.
- The customer-acceptance authority decides acceptance against the baseline, with any deviations explicitly waived.

### Management and maintenance

- Operational measures (call answer times, availability, AVL update latency) are recorded periodically against their thresholds.
- A vendor upgrade or configuration change creates a re-verification set covering the affected requirements; a `production_change` approval requires those records first.
- Revisions to cited standards or contract amendments raise the affected requirements for review.

## Relationship to `/evals`

- Keep `/evals` unchanged. In navigation and copy, label it **AI evaluation** so it is not confused with solution evaluation.
- A Project may use both: AI evaluation to confirm Ember answers NG911 questions correctly from the NENA sources; solution evaluation to confirm the NG911 system meets them.
- Never link `eval_results` rows as evidence on a verification record.

## Data model (indicative)

New tables, each with `project_id` for RLS using the existing helpers (`is_project_member`, `can_curate_project`, `can_run_project_evals`, `has_evidence_access`):

- `solution_requirements`
- `solution_requirement_sources` (requirement ↔ document version / chunk / Wiki article / contract clause, with locator text)
- `solution_requirement_scope_links` (requirement ↔ workstream / project object)
- `solution_verification_methods`
- `solution_verification_records` (append-only; `supersedes_id`)
- `solution_verification_evidence` (record ↔ workstream artifact)
- `solution_evaluation_baselines` and `solution_evaluation_baseline_items` (frozen after `draft`)
- `solution_conformance_decisions` and `solution_waivers`
- `solution_reverification_events`

Reuse rather than duplicate: workstream artifacts for files and links, approval policies for authority, `lifecycle_stage` for phase, `ai_operation_logs` for any AI drafting.

Whether system assessments should be migrated onto this model or kept as a lighter questionnaire is an open question. The recommended first step is to keep them and allow an assessment answer to be linked as `inspection` evidence.

## Authorization

- Curators (Project owner/curator) author requirements, methods and baselines.
- Consultants record verification results and attach evidence; they cannot approve decisions.
- Customer representatives (`business_function = customer_representative`) can be assigned `customer_acceptance` authority.
- Viewers read requirements, verdicts and decisions, subject to evidence access on sources and artifacts.
- Nobody approves a decision over evidence they recorded themselves where the approval policy forbids self-approval.
- Every create, verdict, waiver and decision is audited with actor, time and the baseline version.

## Scope

### In scope

- Requirements with source references, scope links and lifecycle applicability.
- Verification methods, append-only verification records and artifact evidence.
- Frozen, versioned evaluation baselines.
- Conformance decisions and waivers through existing approval policies.
- Re-verification triggers for component changes, source document revisions, threshold breaches and review dates.
- Traceability and gap views per Project and per workstream.
- Ember tools to draft requirements and methods and answer traceability questions.
- The `cebu-ng911` Project as the reference implementation and seed data.

### Out of scope

- Executing tests against customer systems from Ember.
- Live telemetry ingestion from production systems (operational measures are entered or imported, not streamed).
- Formal certification on behalf of a standards body; Ember records evidence of conformance, it does not certify.
- A full requirements-management or ALM replacement (no change-request workflow beyond baselines, no bi-directional sync with Jira, Azure DevOps or DOORS in this phase).
- Changes to `/evals` behavior.

## Acceptance criteria

1. A curator can create a requirement with at least one source reference pointing at a document version, chunk or Wiki article in the Project and a clause locator.
2. A requirement can be linked to one or more workstreams and Project objects.
3. A curator can attach verification methods with explicit pass criteria; a method of kind `operational_measure` requires a threshold and window.
4. A consultant can record a verification result with solution reference and at least one evidence artifact; a `pass` without evidence is rejected.
5. Verification records are append-only; corrections supersede, and the history stays readable.
6. A baseline can be activated only with at least one requirement, and its items are frozen by RLS once it leaves draft.
7. A conformance decision shows the roll-up for its baseline and can be approved only by an authority assigned for its approval type, never by its own requester where self-approval is disallowed.
8. Waivers require a rationale and an authorized approver and appear in all later reports for that baseline.
9. Recording a component change, a new source document version, a threshold breach or a passed review date marks the affected requirements as re-verification due without altering past decisions.
10. Ember can draft requirements from a NENA source in the Project, each citing its clause, and the drafts are not part of any baseline until a curator accepts them.
11. Ember can list a workstream's open requirements and missing evidence, and refuses to mark a requirement as passed or approve a decision.
12. Restricted sources and artifacts stay hidden from members without evidence access in every requirement, traceability and decision view.
13. `/evals` behavior and data are unchanged, and the navigation distinguishes AI evaluation from solution evaluation.

## Required live validation

### Presales claim validation (`cebu-ng911`)

Load the existing NG911 sources, have Ember draft requirements for the K-Safety workstream, record the four vendor claims, attach vendor evidence for at least one, and confirm the decision view shows the rest as unverified.

### Site acceptance

Baseline a Phase 1 requirement set across the three integration workstreams, record pass, fail and conditional results with artifacts, waive one deviation with authority, and complete a customer-acceptance decision assigned to a customer representative.

### Maintenance change

After acceptance, record a K-Dispatch version change and confirm the affected requirements become re-verification due, a `production_change` approval is blocked until they are re-verified, and the original acceptance remains readable.

### Source revision

Upload a new version of a cited NENA document and confirm requirements citing it are flagged for review.

### Access boundary

Restrict one source document and one evidence artifact, and confirm a member without access sees the requirement but not the restricted locator or artifact.
