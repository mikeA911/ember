# KB Sandbox Roadmap

**Status:** Living internal roadmap; the public About page no longer mirrors it verbatim (see note below)  
**Last updated:** 5 October 2026

## How to read this roadmap

This document is the durable internal source of truth for the M1–M10 milestone structure -- names, order, and descriptions below are permanent regardless of what the public About page currently displays. Internal development labels such as M5A, M5F, M6D, and M6E describe implementation increments; they do not replace or renumber this roadmap.

**2026-08-29:** The public About page's "Roadmap" section (the M1–M10 milestone table with Live/Planned status) was replaced with a "What makes KB Sandbox different" section -- twenty differentiators plus a positioning statement, aimed at a general/prospect audience rather than an internal build-status view. The About page is no longer the roadmap's public display surface; this document is now the primary place the M1–M10 structure and status are recorded. The "Public status" column below keeps its Live/Planned values as a record of each milestone's actual delivery state, not as a claim about what's shown publicly.

**2026-10-04:** Added the work delivered between late August and early October 2026: Builder mode and agencies, Workstream promotion and presentations, Methods, the Builder Ontology, working knowledge, Project creation approval and the Live status, Project evidence access, the Agent Gateway and the read-only external MCP server. Dates in parentheses are when each item landed in the repository. The product is now presented as **Ember**; "KB Sandbox" remains the codebase and roadmap name.

**2026-10-05:** Added two proposed dev requests: Ember Readiness and knowledge gaps (M3) and solution conformance and acceptance evaluation (M7). They separate *AI evaluation* (does Ember understand a Project well enough to be trusted?) from *solution evaluation* (does the Project's delivered solution meet its standards and contract?). Both are Next items; neither is built.

Each milestone can continue to gain capabilities after its core is live. Internal work is placed under the public milestone whose product outcome it advances, even when the work spans several technical layers.

Status terms used below:

- **Live:** The public milestone's core capability is built and usable.
- **Recent:** Implemented recently or reported as implemented and validated in the current development environment.
- **Validate:** Implemented, but a specific behavior or operational assumption still needs direct confirmation.
- **Next:** A concrete development gap or near-term decision.
- **Future:** Directional work that needs further design before implementation.

## Roadmap at a glance

| Milestone | Public name | Public definition | Public status |
|---|---|---|---|
| M1 | Curate | Turn sources into approved evidence. | Live |
| M2 | Organize | Turn evidence into structured knowledge. | Live |
| M3 | Evaluate | Measure whether AI actually works. | Live |
| M4 | Orchestrate | Build controlled iterative workflows. | Live |
| M5 | Apply | Agents + consulting workstreams. | Live |
| M6 | Deploy | Cloud / local / private / hybrid. | Planned |
| M7 | Govern | Risk + controls + guardrails + approvals. | Planned |
| M8 | Communicate | Findings + executive reports. | Planned |
| M9 | Teach | Consultant learning paths. | Planned |
| M10 | Research | Advanced retrieval / knowledge / autonomy. | Planned |

---

## M1 — Curate

**Public definition:** Turn sources into approved evidence.  
**Public status:** Live

### Delivered foundation

- Authenticated curation workflow for uploading, parsing, chunking, enriching, reviewing, and embedding source material.
- Human approval boundaries and source-level provenance.
- Knowledge-base isolation, role-based access, and the AI provider abstraction used by later milestones.

### Recent internal development

- Workstream artifacts can serve as first-class evidence alongside uploaded documents and document chunks.
- The artifact model has expanded to cover structured engineering outputs, design notes, findings, evidence maps, and implementation handoffs.
- Versioned knowledge sources, knowledge-base classification and a curator-review lifecycle for knowledge bases (24–28 Aug).
- Project evidence access controls: access groups, per-resource classification and grants, member access requests decided by the Project owner, and an audit log of every change (25 Aug; requests 1 Sep).
- Member-submitted knowledge sources: any Project member can submit a file, artifact or working-knowledge item to a Project knowledge base for owner/curator approval (3–5 Sep).
- Knowledge bases can be attached to individual Workstreams as well as Projects (25 Sep).
- Clearer chunk review: per-chunk decisions, approve-all, approving a whole source from the Project page, rollback and a visible reason when an approval fails, and a "searchable" indicator per source (28 Sep).
- OpenAI `text-embedding-3-small` is the default embedding model (28 Sep).

### Next

- Define consistent evidence metadata for software repositories: repository URL/name, visibility, branch, commit SHA, scope, relevant paths, supporting documents, and external tool.
- Make evidence completeness visible before a method or workstream begins.
- Clarify which project records are eligible for retrieval before they have passed a promotion and approval process.

### Future

- Add richer evidence ingestion while retaining the distinction between raw evidence, reviewed knowledge, and conversational context.
- Support additional private and enterprise evidence sources without weakening project isolation or provenance.

---

## M2 — Organize

**Public definition:** Turn evidence into structured knowledge.  
**Public status:** Live

### Delivered foundation

- Versioned Wiki articles with draft, review, approval, archive, source-linking, and related-article lifecycles.
- Manual and AI-assisted authoring, with human approval determining the canonical version.
- Separate vectors for source chunks and approved Wiki knowledge.

### Recent internal development

- Added the Workbench Handbook Wiki category.
- Added dual-source Handbook authoring: manual methodology content and AI-assisted synthesis grounded in workstream artifacts.
- Added the 18-method Workbench catalog plus cross-cutting guidance and requirements sections to Assistant knowledge.
- Taught the Assistant to find a matching method, inspect its requirements, and identify prerequisite methods when required evidence is missing.
- Project-scoped Wiki articles, Project knowledge-base attach and detach, and a Product Handbook category (24–28 Aug).
- Project-bound Ember retrieval over a Project's attached knowledge, applying both membership and resource-level access before evidence reaches the model (24 Aug onward).
- Working Knowledge and research notebooks: private, Project-scoped notes a member can share with named teammates, and that Ember can save to and search (6 Sep).
- Builder Ontology: a per-Project tree of domain-object types, shown as an Ontology Map with SVG/PNG export; Ember can suggest or create it, or import an attached Turtle file (25–29 Sep).

### Next

- Complete project-scoped knowledge retrieval. Retrieval over a Project's attached knowledge bases is live; the remaining work is the full intended order inside a project:
  1. approved Project Knowledge;
  2. approved project evidence, artifacts, and findings where permitted;
  3. approved platform Handbook/Wiki knowledge;
  4. conversation context for interaction only, never silently as canonical knowledge.
- Build **Promote Conversation to Project Knowledge** as a selective, human-reviewed lifecycle with conversation and model provenance.
- Version, supersede, retire, chunk, and embed approved Project Knowledge.

### Future

- Add knowledge-quality and freshness signals so the Assistant can distinguish current, superseded, incomplete, and disputed knowledge.
- Support reusable knowledge across projects only through an explicit review and publication boundary.

---

## M3 — Evaluate

**Public definition:** Measure whether AI actually works.  
**Public status:** Live

### Delivered foundation

- Versioned evaluation datasets, cases, runs, results, deterministic retrieval metrics, optional LLM judging, human review, and baseline comparison.
- Evaluation across source chunks, Wiki knowledge, or both.
- Provider/model configuration snapshots so historical results remain interpretable.

### Recent internal development

- The Assistant can select generation-capable models from the AI registry rather than relying on hard-coded model names.
- Assistant messages retain durable provider/model snapshots, allowing model changes within one conversation without rewriting history.
- Guided-method reasoning has been tested against representative requirement-resolution scenarios.
- Ember Readiness, Stage 1: running evaluations, marking baselines and human review are now platform-admin work, enforced in the Server Actions and RLS; Admin → **Ember readiness** lists every dataset with its Project and latest run, and Evals is removed from non-admin navigation and dashboards. Curators keep authoring test questions (5 Oct).
- Ember Readiness, Stage 2: every Project page and dashboard shows how ready Ember is for each Project -- the curator's confidence, verdict and reason (append-only history, review date) beside the measured score from the latest admin run and the Project's knowledge coverage, with review-due and disagreement notices (5 Oct).
- Ember Readiness, Stage 3: Project members report Ember failures ("Report a problem" under an answer attaches the question, answer, sources and model automatically); the Project's curators triage, resolve by linking the source or Wiki article that now covers it, turn the question into a draft test question, or move a product problem to the feedback board. Open-gap counts appear in readiness (5 Oct).
- Ember Readiness, Stage 4: in Project chat Ember flags answers it couldn't ground in the Project's knowledge (its own declaration, or an empty Project search) and files them as knowledge gaps, grouping repeated questions; the person who asked can add details or withdraw it, and curators get one note per new gap plus milestone digests (5 Oct).
- Project knowledge scope: knowledge bases attached to a Project's workstreams now count as Project evidence in Ember's search and in readiness coverage (member read access extended accordingly, evidence-access restrictions unchanged); the gap Resolve form shows which sources are searchable and how to submit an approved artifact as a source (5 Oct).

### Validate

- Evaluate Assistant reliability on multi-step method and prerequisite reasoning, including tool-loop completion, grounding, latency, and fallback frequency.
- Confirm the best default Assistant model. The current smaller default has shown occasional iteration-budget failures in reported testing, while a larger model completed the same scenarios more reliably.

### Next

- Define a pre-beta Assistant evaluation rubric covering correctness, grounding, method fit, prerequisite detection, safe action boundaries, provenance, latency, and recovery from tool failure.
- Record basic Wizard/method outcomes so the product can learn which guided methods work in practice.
- Establish the evaluation criteria for the first external pilot.
- **Ember Readiness and knowledge gaps** (`docs/dev-request-ember-readiness-and-knowledge-gaps.md`): all four stages are done (see Recent internal development). Remaining follow-up: cross-Project gap trends on the admin dashboard. Gap grouping is now AI-based (embeddings, word overlap as fallback).

### Future

- Compare models, prompts, retrieval strategies, tools, and guided methods on shared project tasks rather than generic benchmarks alone.
- Add experiment views and leaderboards only where they preserve configuration, evidence, and review context.

---

## M4 — Orchestrate

**Public definition:** Build controlled iterative workflows.  
**Public status:** Live

### Delivered foundation

- Versioned, bounded graph execution with state, nodes, edges, conditional transitions, termination, retry limits, and traces.
- A controlled RAG retry graph that keeps execution policy outside the model.
- Versioned Agent foundations that execute through the graph runtime.

### Recent internal development

- Added a shared Workbench service layer for projects, workstreams, AI providers, and identity.
- Server Actions and internal AI tools call the same services and authorization rules.
- Added an in-process MCP-style tool contract with six tools: Wiki search, project-note listing, project creation, project approval, workstream creation, and artifact attachment.
- Added the bounded Assistant tool-calling loop and raised its iteration allowance to support legitimate multi-step requirement reasoning.
- Agent Gateway Milestone 1: Ember can call a registered external MCP server. Read-only calls run immediately and are audited; other calls are proposed and run only after the user confirms. This is the first code-level propose-confirm-execute boundary (31 Aug).
- Expanded Ember's tools: Project knowledge search, working-knowledge save and search, Project notes, member listing, Project description updates, ontology suggestion, creation and import, feedback reports and web search (Sep).

### Next

- Extend controlled tools only from concrete method needs; do not create broad autonomous permissions.
- Improve tool-loop diagnostics, error recovery, and evaluation traces.
- Decide which Assistant actions may be proposed, which require explicit confirmation, and which should never be executable.

### Future

- Add reusable orchestration patterns for implemented Wizards without hard-coding 18 separate flows.
- ~~Consider external MCP transport only when a real external consumer and authorization design justify it.~~ Delivered as a read-only server for builders' AI chatbots (30 Sep; see M6). Write access through external transport remains undecided.

---

## M5 — Apply

**Public definition:** Agents + consulting workstreams.  
**Public status:** Live

### Delivered foundation

- Agent Templates and a first formal RAG Answer Agent.
- Projects, membership, isolation, workstreams, deliverables, assessments, project notes, and external artifact capture.
- Support for native Workbench execution, externally performed workstreams, and document-first engineering handoffs.

### Recent internal development

- Added the first in-app Conversational Workbench Assistant with persisted conversations and messages.
- Added model identity, per-message provenance, next-message model selection, mid-conversation model switching, response details, and a real polling-based activity indicator.
- Added narrow Assistant provenance to the three writable record types currently exposed through tools: projects, workstreams, and workstream artifacts.
- Added `implementation_handoff` as a first-class artifact type.
- Established the document-first boundary: the Workbench investigates, compares, reviews, and produces implementation-ready artifacts; it does not default to modifying target repositories, committing code, opening pull requests, or deploying systems.
- Added conversational method-fit and requirement reasoning over the 18-method Handbook catalog.
- **Projects.** An Organization Home Project, a Project directory and join requests (4 Sep); Project curators manage their own team's membership (3 Sep); a per-Project Ember starter prompt (3 Sep); a `member` platform role below consultant (1 Sep); a Project status pipeline with history (28 Aug), a Live status and Reopen, and archive or delete (2 Oct); Project creation approval for Projects started below curator (2 Oct); a Project summary with a newcomer brief that can be viewed, copied or downloaded (30 Sep).
- **Workstreams.** Artifact validation states (1 Sep); Workstream promotion, where an approved Workstream becomes a new Project without exposing the original (6 Sep); Project and Workstream cloning for comparison (25 Sep).
- **Methods.** A reusable Method can be promoted from a Workstream that worked, published by a curator or admin, and instantiated as a new Workstream (25 Sep).
- **Ember chat.** Attach any text file, several files or a zip; save attachments as findings; choose which messages to save as a Project note (29 Sep–2 Oct).
- **External agents.** The External Agent Registry (27 Aug) was generalized into a Builder Registry with certification, capability evidence, capability evaluations and per-Project availability (31 Aug–6 Sep).
- **Builders and agencies.** Originally a second deployment mode (`KB_SANDBOX_PRODUCT_MODE=builder`), merged into the single product configuration on 4 Oct so an enterprise deployment acts as the agency. Each builder gets a workspace Project (and may work on others), and each client proposal is a Workstream (6 Sep). Agencies (curators) supervise their own builders through a metadata-only dashboard with completion tracking (1–3 Oct). Builders share progress updates by choice (6 Sep). Accepted proposals become client Projects through agency approval, with clients added as viewers (1 Oct). Client maintenance fees and the platform's share are recorded for invoicing (1 Oct). AI usage is metered against allowances, and builders can bring their own LLM (25 Sep).

### Validate

- Confirm specific live activity labels in the UI during sufficiently long tool calls. The label mapping and polling path exist, but reported live tests completed too quickly to observe more than the generic fallback.
- Complete pre-beta testing with a small set of authenticated users and realistic project questions.

### Next

- Implement project-level **Requirement Status** for method prerequisites, using at least: Available, Needed, Optional, and Can Be Produced Elsewhere.
- Decide whether the first Wizard experience remains conversation-led or gains a thin visual setup/review surface. Any UI should be metadata-driven rather than 18 bespoke flows.
- Select the first 2–4 methods for deeper guided support based on value and observed demand.
- Extend **Legacy Feature Introduction** and **MCP Architecture** with AI-accessible capability discovery, business-rule and authority mapping, and capability-to-API-to-MCP traceability. First validate the approach on KB Sandbox through a committed Capability and Navigation Catalogue; external MCP transport remains a later decision. See `docs/dev-request-ai-accessible-application-discovery-and-mcp-method-extension.md`.
- Instrument unmet-method demand without retaining unnecessary conversation content.
- Make Assistant-proposed state changes consistently reviewable before execution.

### Future

- Add more controlled tools only where service-layer authorization, provenance, confirmation, and evaluation are defined.
- Preserve external-workstream interoperability with Claude Code, Codex, Cursor, local/private models, specialist tools, and future integrations.
- Autonomous code-writing remains outside the current product boundary and would require a separate safety and architecture decision.

---

## M6 — Deploy

**Public definition:** Cloud / local / private / hybrid.  
**Public status:** Planned

### Current foundations

- Model-neutral provider registry separates generation models from embedding models.
- Cookie-based identity is live; bearer-token identity resolution is implemented and tested but intentionally unused until a non-cookie caller or external transport exists.
- Internal tools are transport-independent and currently invoked in-process.

### Recent internal development

- Read-only external MCP server at `/api/mcp` for builders' AI chatbots (30 Sep). Sign-in uses Supabase Auth's OAuth 2.1 server with user consent. Admins allowlist both users and client apps, each app with a maximum sensitivity. The connection is read-only at the database level, limited to 30 calls per minute and 500 per day, and every call is audited.
- Bring-your-own-LLM for builders: a hosted API key or a local OpenAI-compatible server such as Ollama or LM Studio (25 Sep).
- Vercel deployment pinned to Node 22 and the Next.js preset, with a cron route for scheduled presentation reviews (26 Sep).

### Next

- Define supported deployment profiles for hosted cloud, customer cloud, private network, local models, and hybrid configurations.
- Document capability differences, data boundaries, identity paths, observability, secrets, and operational responsibilities for each profile.
- ~~Decide when bearer-token callers and external MCP transport are justified by a real deployment need.~~ Resolved for read-only builder chatbots (30 Sep). Decide whether any write path is ever justified.

### Future

- Add deployment validation, health checks, provider failover policy, and environment-specific model availability.
- Support private/local providers without presenting deployment location as a proxy for quality, security, or compliance.

---

## M7 — Govern

**Public definition:** Risk + controls + guardrails + approvals.  
**Public status:** Planned

### Current foundations

- Human review gates for curated chunks and canonical Wiki knowledge.
- Project roles, RLS isolation, evidence provenance, evaluation history, Agent/workstream guardrail fields, and Assistant creation-path provenance.
- Controlled tool registry and a bounded Assistant loop.

### Recent internal development

- Added Information Sensitivity Classification: a governed AI-processing axis (Public/Internal/Confidential/Restricted) kept deliberately separate from the existing human evidence-access classification -- "who may see this" and "which AI providers may process this" are independent decisions. Applies to knowledge sources, Wiki articles, workstream artifacts, and a project's own name/goal.
- Enforced pre-inference in the Assistant's tool-calling loop: a blocked request never reaches the model, and Ember explains the block in plain language instead of failing silently. Closed a follow-up gap where project metadata embedded in the system prompt bypassed the check entirely.
- Built a shared policy-enforcement service (`ContextManifest`/`evaluatePolicy`/`withPolicyGate`, mirroring the existing per-call operation-logging decorator) and used it to close the first concrete multi-path gap: the background conversation-summary refresh was resending full transcripts to a separately-resolved model with no eligibility check.
- Added admin (max sensitivity a provider may receive) and project-owner (a resource's or project's own sensitivity) controls for the new axis.
- Project governance: approval policies (one per approval type) and named authority assignments, owner-managed and visible to members, with unassigned required policies reported as gaps (24 Aug).
- Project creation approval: a Project started by someone below curator stays pending until a curator, the builder's agency or an admin approves it, and nobody approves their own Project. The same no-self-approval rule applies to Workstream promotions and presentations (2 Oct).
- Resource-level evidence access with an audit log (see M1), kept separate from AI-processing sensitivity.
- Produced a phased design (`docs/dev-request-enterprise-shadow-ai-governance-later-phases.md`) and an architecture note (`docs/design-notes/ai-policy-enforcement-service-and-context-manifest.md`) covering the remaining AI-processing-boundary coverage, versioned org-level policy, and deterministic redact/route/approve outcomes -- paused after the first increment pending customer feedback before continuing.
- Solution conformance, Stage 1: a requirements register per Project -- requirements traced to standards, regulation, contract terms, customer needs and vendor claims (linked to Project knowledge where possible), scoped to workstreams and Project objects, with verification methods and pass criteria; editable only while draft (5 Oct).
- Solution conformance, Stage 2: append-only verification records -- results (pass, fail, conditional pass, not run, not applicable) against an identified solution state, evidenced by workstream artifacts (a pass needs at least one), corrected only by superseding records; verification status per requirement in the register (5 Oct).
- Solution conformance, Stage 3: frozen, versioned evaluation baselines; waivers and deviations; conformance decisions approved by the Project's assigned authorities under its approval policy (no self-approval by the requester or evidence recorder unless allowed), each keeping a snapshot of the records it rested on; superseding a baselined requirement with a linked new draft (6 Oct).
- Solution conformance, Stage 4: re-verification triggers -- component changes recorded by the team, new versions of cited sources and operational measures outside their threshold (both automatic), and review schedules mark requirements re-verification due until each method has a new result or a curator resolves it; production-change approvals wait for re-verification (6 Oct).
- Solution conformance, Stage 5: Ember tools -- Ember reports requirement status (verification, missing evidence, re-verification) and, for curators and after confirmation, drafts requirements and verification methods from Project knowledge citing their clauses; Ember drafts await a curator's acceptance before they can be baselined; Ember can never record results, waive, baseline or approve (6 Oct).

### Next

- Define the governance foundation: AI system inventory, accountable ownership, model inventory, data classification, risk classification, control definitions, evaluation gates, approval records, and audit evidence.
- Replace free-text-only guardrails with reusable, versioned guardrail templates where runtime enforcement is meaningful.
- Define the confirmation and approval policy for each Assistant tool.
- Define retention and privacy boundaries for demand events, conversations, project knowledge, tool records, and model provenance.
- **Solution conformance and acceptance evaluation** (`docs/dev-request-solution-conformance-and-acceptance-evaluation.md`): All five stages (requirements register, verification records, baselines and decisions, re-verification triggers, Ember tools) are done. Govern evaluation of a Project's delivered solution, separate from AI evaluation. Requirements traced to standards (e.g. NENA), regulation, contract and vendor claims; verification methods with explicit pass criteria; append-only verification records with artifact evidence; frozen evaluation baselines; conformance decisions and waivers through existing approval policies; re-verification during management and maintenance. Worked example: `cebu-ng911`.
- Extend the AI-processing sensitivity gate to the remaining outbound AI call sites (evaluation judging/generation/retrieval, journal generation, curator enrichment, embedding calls) using the shared policy service already built -- deferred pending customer feedback on priority.

### Future

- Connect governance records to existing configurations, evaluations, evidence, and approvals instead of requiring duplicate documentation.
- Add risk-tier-aware controls and promotion gates for Agents, models, knowledge, and deployment profiles.
- Model/deployment-level AI-processing eligibility (today's ceiling is provider-only), versioned organization-level AI-processing policy, and Phase 3's deterministic redact/route/require-approval outcomes.

---

## M8 — Communicate

**Public definition:** Findings + executive reports.  
**Public status:** Planned

### Current foundations

- Workstream artifacts, findings, evidence maps, assessments, project notes, public project examples, design notes, and implementation handoffs.
- Provider/model and creation-path provenance for Assistant-generated records.

### Recent internal development

- Workstream Presentation & Review (26 Sep–1 Oct). A Project owner or curator generates slides from a Workstream and opens a review, either straight away or on a schedule, with a deadline. Members comment per slide, and comments are classified into tracked actions. The presentation then goes through builder revision and curator review to approval, with notifications at each step.
- Project summary with a newcomer brief, and a client proposal summary for builders (30 Sep–1 Oct).

### Next

- Define reviewed report types for technical findings, management briefs, comparison reports, decision records, and implementation handoffs.
- Generate reports from approved evidence and findings while preserving citations, uncertainty, model/tool provenance, and human sign-off.
- Make project status, unresolved questions, decisions, and deliverables easy to summarize without treating raw chat as authoritative.

### Future

- Add audience-specific report views and export formats.
- Support recurring portfolio and governance reporting once ownership, risk, and approval records exist.

---

## M9 — Teach

**Public definition:** Consultant learning paths.  
**Public status:** Planned

### Current foundations

- Workbench Handbook, approved Wiki lifecycle, curated public examples, visible methods, evaluations, artifacts, and review history.
- The 18-method catalog provides a shared vocabulary for applied AI engineering and consulting work.

### Recent internal development

- The Assistant can map a stated objective to a documented method, identify missing required inputs, and point to a prerequisite method rather than pretending unavailable automation exists.
- Methods can now be promoted from proven Workstreams and instantiated in new Projects (see M5), which gives future learning paths reusable, evidence-backed starting points.

### Next

- Turn selected methods into guided learning projects with goals, prerequisites, evidence, steps, deliverables, assessments, human review points, and reusable handoffs.
- Define role-appropriate learning paths for practitioners, consultants, curators, reviewers, and project owners.
- Use evaluation and reviewed artifacts to assess demonstrated capability, not course completion alone.

### Future

- Add reusable templates, mentoring/review workflows, and sanitized case studies.
- Preserve the distinction between training exercises and client/project evidence.

---

## M10 — Research

**Public definition:** Advanced retrieval / knowledge / autonomy.  
**Public status:** Planned

### Current foundations

- Separate source and Wiki vector stores, RAG evaluation, graph orchestration, versioned Agents, and controlled tool calling.
- Multi-model workstreams make independent findings and blind spots comparable against shared evidence.

### Next

- Research project-scoped retrieval across approved knowledge, artifacts, findings, and platform knowledge with explicit source labeling.
- Compare chunking, embeddings, reranking, retrieval strategies, models, and tool-use policies on representative workloads.
- Establish research protocols, reproducibility requirements, evaluation rubrics, and promotion gates before introducing more autonomy.

### Future

- Bounded research and knowledge-maintenance Agents that propose claims or Wiki updates for human approval.
- Advanced retrieval, knowledge-quality, and multi-agent comparison methods.
- Any expansion toward autonomous action must remain permissioned, observable, reversible where possible, evaluated, and subject to explicit human review.

---

## Product North Star — Ember as the Workbench Interface

**This is a north star, not a scheduled feature or milestone.** It does not map to a single M-number and is not committed for implementation on any timeline; it is a direction the M1–M10 milestones above should keep moving toward when a design choice could go either way.

KB Sandbox should ultimately support two interfaces to the same Enterprise AI Workbench:

**Workbench** — the current structured interface, providing direct access to Organizations, Projects, Knowledge, Workstreams, Methods, Evaluations, Artifacts, and Administration. This remains the transparent, inspectable interface for administrators, curators, and power users.

**Ember** — a conversational interface where a user can begin with their objective rather than needing to understand KB Sandbox's information architecture. For example: *"Ember, help me onboard our company knowledge."* Ember should eventually be capable of: understand intent → identify appropriate Method → gather requirements → use Workbench tools → guide navigation where necessary → request human decisions/approval → validate the result → produce artifacts.

Users should be able to move between Ember and the full Workbench at any time. The long-term UX may allow users to select Ember as their default interface, potentially presenting only Ember over a simple background or user-selected image.

**Guiding principle:** *The better KB Sandbox becomes, the less ordinary users should need to understand KB Sandbox itself.*

Do not implement a simplified Ember-only UI on the strength of this entry alone — it names a direction, not a request.

---

## Recent cross-cutting platform work

Work that serves the whole product rather than one milestone:

- **Rebrand to Ember** (27 Sep): site title, logo, icon and copy, with a new login page and loading screen (3 Oct).
- **Role-directed shell.** Curators and admins keep the classic Workbench navigation; members, consultants and viewers get an Ember-first shell.
- **Accounts.** Self-service registration was removed; admins create accounts, and new accounts join the Organization Home Project.
- **Feedback board and roadmap register** (25 Aug). Users file feedback, including through Ember, and the platform owner triages it and maintains the register.
- **Public Examples** are hidden until Ember has its own showcase Projects (27 Sep).

## Near-term cross-milestone priorities

These priorities span the roadmap but should remain attached to the public milestone outcomes above:

1. **Stabilize the Assistant:** complete pre-beta validation, verify activity feedback, measure tool-loop reliability, and decide the default model.
2. **Add project knowledge:** implement reviewed promotion, project-scoped retrieval, provenance, versioning, and retirement.
3. **Make requirements durable:** persist method prerequisite status and use it to drive conversation, setup, and review.
4. **Pilot thin Wizards:** choose 2–4 high-value methods, add only the reusable UI and automation they need, and retain manual guidance for the rest.
5. **Measure demand and outcomes:** record privacy-conscious unmet-method demand and basic method/Wizard results.
6. **Run a real pilot:** use one sanitized modernization or organizational-knowledge problem and let observed gaps influence prioritization.

## Roadmap maintenance rules

- This document owns the M1–M10 names, order, descriptions, and status (see the 2026-08-29 note above -- the public About page no longer displays this table, so it is not the alignment target it once was).
- Add internal development beneath these milestones; do not create a competing top-level milestone sequence.
- Mark capabilities as live only when their core path is usable, not merely designed or migrated.
- Separate repository implementation, deployed database/content state, validation evidence, and future intent.
- Record deliberate deferrals as deferrals, not defects; record unverified behavior as validation work, not completion.
- Preserve provenance, evidence boundaries, project isolation, and human approval in every milestone.
- Treat later build evidence and direct product decisions as higher-priority than older design notes.

## Supporting references

- Public About page (positioning copy, no longer the milestone table): `src/app/(public)/about/page.tsx`
- Current implementation architecture: `docs/CURRENT-ARCHITECTURE.md`
- Product brief and earlier roadmap history: `docs/KB Sandbox.md`
- Workbench service layer and Assistant design: `docs/design-notes/workbench-service-layer-and-assistant-design.md`
- Assistant identity, provenance & document-first principle: `docs/design-notes/assistant-identity-provenance-design.md`
- Guided methods design: `docs/design-notes/guided-workbench-methods-design.md`
- Shadow AI governance phased design: `docs/dev-request-enterprise-shadow-ai-governance-later-phases.md`
- AI policy-enforcement service and context manifest architecture note: `docs/design-notes/ai-policy-enforcement-service-and-context-manifest.md`
- User stories by role and module: `docs/USER-STORIES.md`
- Builder product: `docs/dev-request-kb-sandbox-builder-product.md`
- External MCP server: `docs/dev-request-ember-external-mcp-server.md`
- Ember Readiness and knowledge gaps: `docs/dev-request-ember-readiness-and-knowledge-gaps.md`
- Solution conformance and acceptance evaluation: `docs/dev-request-solution-conformance-and-acceptance-evaluation.md`
