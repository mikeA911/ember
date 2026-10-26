# Ember Sandz — S1 Ember Codebase Assessment

**Milestone:** S1 (concept paper §8: "Reusable services and modifications identified")  
**Status:** Draft v0.1, for review  
**Date:** 23 October 2026  
**Inputs:** [Ember Sandz concept paper v0.1](Ember_Sandz_Development_Concept_v0.1.md), `docs/CURRENT-ARCHITECTURE.md` (7 October 2026), `supabase/migrations/` (157 files through `20261031100001`), `src/lib/`  
**Decision record:** [ADR-0002: Ember Sandz as a domain module](../architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md)

This document checks each capability and entity the concept paper relies on against what Ember actually implements today, and classifies it:

- **Reuse:** works for Sandz without change.
- **Extend:** the pattern or table exists but needs new columns, helpers or coverage.
- **New:** nothing comparable exists; build in the Sandz module.

The draft role and permission matrix at the end is for department owners to correct.

## 1. Summary

1. **Ember Core is a strong base for the knowledge, AI and governance layers.** Retrieval with access control, provenance, the AI sensitivity gate, human-acceptance of AI drafts, curator-reviewed promotion into knowledge, and a read-only, audited MCP server all exist and can be reused.
2. **The CRM layer is almost entirely new.** Ember has no customer, contact, campaign, activity or lead records. Priority 1 Marketing (S2–S4) is mostly new build.
3. **Presales, Delivery and Maintenance have a large head start.** The solution conformance model (requirements, verification records with evidence, baselines, waivers, conformance decisions and scheduled re-verification) maps closely onto proposal requirements, acceptance and maintenance re-verification. The Sandz data model should link to it from S2 rather than plan a second requirements system.
4. **Authorization is the main design gap.** Ember authorizes through platform role, Project membership and evidence access inside a Project. Shared records that sit outside any Project (customers, contacts) and department-based permissions have no current model. This needs designing in S1/S2, not after.
5. **Testing must go beyond what exists.** Most `*-rls.test.ts` suites assert the *shape* of migrations. The pilot's success criterion ("unauthorized users cannot retrieve restricted records") needs behavioural RLS tests, which the PGlite harness in `src/lib/collaboration/database.test.ts` already shows how to write.

## 2. Capability mapping

### 2.1 Identity and authorization

| Need (concept paper) | What exists | Class | Notes |
|---|---|---|---|
| Authentication | Supabase Auth, admin-created accounts only (`20261009`), `requireUser()`/`requireRole()` in `src/lib/auth.ts` | Reuse | Fine for an internal Sandz instance. |
| Platform roles | `profiles.role`: `anonymous`/`member`/`consultant`/`curator`/`admin` | Reuse (with care) | These describe Ember's builder programme (curator = agency, consultant = builder). Sandz staff need a mapping, see §4. |
| Department permissions | None | **New** | Needs `sli_departments` and `sli_department_members` (with a department role), plus `SECURITY DEFINER` helpers in the style of `is_project_member`. |
| Record-level authorization for customers, campaigns | Project-scoped helpers: `is_project_member`, `can_manage_project`, `can_curate_project`, `can_run_project_evals` | Extend | Customers are cross-department and outside Projects. New helpers such as `sli_can_view_customer(customer_id)` and `sli_can_edit_customer(customer_id)`. |
| Restricted commercial information | `information_sensitivity` (`public`/`internal`/`confidential`/`restricted`); `project_access_groups`, `resource_access_policies`, `resource_access_grants`, `has_evidence_access()` | Extend | Copy the model: a sensitivity column on customers, opportunities and attachments, with explicit grants for restricted accounts. `has_evidence_access()` is Project-bound today, so Sandz needs its own equivalent. |
| Audit history | `project_status_history`, `resource_access_audit_log`, `ai_operation_logs`, MCP call logging | Extend | There is no generic audit table. Each Sandz workflow gets its own history table, following `project_status_history`. Decide in S2 whether a shared `sli_audit_events` table is also needed for field-level changes. |
| Approval authority | `project_approval_policies`, `project_authority_assignments` (owner-managed, gaps reported) | Extend | The model "who may approve what" is right; it is per Project. Sandz needs the same idea per department (who may endorse a lead, approve a bid submission). |

### 2.2 Knowledge, retrieval and provenance

| Need | What exists | Class | Notes |
|---|---|---|---|
| Approved reusable knowledge | Knowledge bases, versioned `knowledge_sources`, curator pipeline, Wiki with approvals | Reuse | Product specifications, approved collateral, previous proposals. |
| Draft operational information kept distinct | Working knowledge (private, Project-scoped notebooks), Project notes, Workstream artifacts | Reuse (pattern) | Sandz operational records are a third kind of draft information; they stay out of retrieval until promoted. |
| Promote evidence into knowledge | `project_source_submissions` (file, artifact or working-knowledge item → owner/curator decides) | Extend | Add a submission kind for Sandz records (call summary, lessons learned, postmortem). Target knowledge bases must belong to a Project today; decide which Project owns Sandz's shared knowledge bases (§5). |
| Retrieval with citations and access control | Project-scoped retrieval applying membership and evidence access before the model sees anything; `chat_message_retrieved_resources` records what was retrieved | Reuse | Covers S5's "approved evidence retrievable with citations and access controls" for knowledge bases and the Wiki. |
| Customer-specific knowledge never crosses customers | Evidence access groups and grants | Extend | Needs a customer link on knowledge references (`sli_knowledge_references`) and a retrieval filter that respects the customer's sensitivity and grants. |
| Ontology | `project_objects` (per-Project domain object types), Turtle import (`src/lib/ontology/`) | Reuse | Useful for solution taxonomy and product catalogue structure. Not a substitute for operational tables. |
| Knowledge readiness | Ember Readiness per Project, failure reports, automatic knowledge-gap detection | Reuse | Directly serves "Readiness evaluation" in the paper's AI table. |

### 2.3 Assistant and AI governance

| Need | What exists | Class | Notes |
|---|---|---|---|
| AI recommends and drafts, never approves | Ember-drafted requirements: `created_via = 'assistant'`, `awaiting_acceptance`, `accepted_by`/`accepted_at` (`20261022`) | Reuse (pattern) | Apply the same columns to AI-drafted call summaries, lead qualification suggestions, campaign copy and bid gap lists. |
| Assistant tools over Sandz records | Bounded tool loop (`src/lib/chat/loop.ts`, 8 iterations); Project-only tools intercepted in the loop, as `src/lib/chat/requirements-tool.ts` does | Extend | New tools (for example `summarize_customer_history`, `draft_call_summary`, `suggest_follow_up_questions`) call `src/lib/sli/` services so RLS applies unchanged. |
| AI provider eligibility for sensitive data | `src/lib/ai/sensitivity.ts`: `ContextManifest`, `evaluatePolicy`, `assertProviderEligible`; provider maximum sensitivity | Extend | Every Sandz tool must add its records to the manifest. Contact personal data should default to at least `internal`, and commercial terms to `confidential`. |
| AI provenance | Provider/model snapshot per assistant message; creation-path provenance on records Ember creates | Reuse | Record `created_via` on every Sandz record the assistant creates. |
| Evaluation | Eval datasets, runs and scoring (`/evals`, admin-only operations since `20261012`) | Reuse | Build a Sandz benchmark (for example "summarize this lead's requirements with citations") before enabling assistant tools for Sales. |

### 2.4 Workflow

| Need | What exists | Class | Notes |
|---|---|---|---|
| Deterministic, auditable transitions | Project status pipeline + `project_status_history`; `SECURITY DEFINER` decision functions (`decide_solution_conformance_decision()`, `activate_solution_baseline()`, `record_solution_verification()`) that validate caller and transition | Reuse (pattern) | Use for campaign status, telemarketing outcomes, lead qualification and endorsement, Sales acceptance, bid submission. No separate workflow engine. |
| Frozen records after approval | `BEFORE UPDATE` triggers that freeze requirements once out of draft and baselines once active | Reuse (pattern) | Endorsed leads and submitted bids should be frozen the same way, with corrections as new versions. |
| Handoff between departments | None | **New** | `sli_handoffs` (from department, to department, subject record, package snapshot, status `proposed → accepted / returned`), so "Sales formally accepts" is an explicit transition with history. |
| Scheduled follow-ups | `vercel.json` cron for presentation reviews; re-verification due dates | Extend | Callbacks, accreditation renewals and bid deadlines need a due-date query and, later, a cron reminder. |

### 2.5 Integration

| Need | What exists | Class | Notes |
|---|---|---|---|
| Read-only MCP retrieval before external writes | `/api/mcp`: OAuth 2.1 via Supabase Auth, user JWT so RLS applies, restrictive `client_id` policies make it read-only at the database level, allowlists, rate limits, every call logged | Reuse | Add read-only Sandz tools (`get_customer_summary`, `list_open_leads`) behind the module switch. The paper's "read-only before write" requirement is already how this server works. |
| External agents | External agent registry and gateway | Reuse | For later integrations. |
| REST APIs | None beyond MCP and internal routes | **New** (later) | Not needed for the pilot. |
| Zoho migration | None | **New** | Scope depends on the open decision in §5. Needs an import path with deduplication before S2 is accepted. |

### 2.6 Lifecycle stages after Marketing

| Concept paper stage | Existing Ember capability | Class |
|---|---|---|
| Presales: solution engineering, proposals | `solution_requirements` with sources and scope links; `solution_verification_methods`; Ember-drafted requirements; Workstreams and artifacts for proposal drafting; Methods and assessments | Extend |
| Project Delivery: implementation, acceptance | Verification records with evidence (`record_solution_verification()`), evaluation baselines, waivers, conformance decisions with approvals, verification criteria checks | Extend |
| Maintenance: installed assets, support | Re-verification events, `review_interval_months`, `project_reverification_due()`, the rule that a `production_change` decision cannot be approved while re-verification is due | Extend (assets and service cases are **New**) |

The extension needed in each row is the same: these tables hang off an Ember Project today, and the Sandz `Solution` must be able to own or link to them across several engagements for one customer.

## 3. Entity mapping

| Concept paper entity | Ember equivalent | Class | Proposed table(s) |
|---|---|---|---|
| Organization / Customer | None (and "Organization" is reserved for the future tenant, see ADR-0002) | New | `sli_customers` |
| Contact | None (`profiles` are users, not customer contacts) | New | `sli_contacts`, `sli_contact_methods` |
| Campaign | None | New | `sli_campaigns`, `sli_campaign_targets`, `sli_campaign_kpis` |
| Campaign Activity | None | New | `sli_activities` (launches, events, outreach, call attempts), `sli_activity_history` |
| Lead / Opportunity | None | New | `sli_leads` (retains campaign origin), `sli_lead_qualifications`, `sli_handoffs` |
| Solution | Partly: an Ember Project with solution requirements | Extend | `sli_solutions`, linked to one or more Ember Projects and their requirements and baselines |
| Project (delivery) | Ember `projects` as a workspace | Extend | `sli_engagements` linking customer + solution + Ember Project; the Ember Project is not the customer record |
| Installed Asset | None | New | `sli_installed_assets` |
| Service Case | None | New | `sli_service_cases` |
| Knowledge Reference | `project_source_submissions`, knowledge sources, Wiki sources | Extend | `sli_knowledge_references` linking an operational record to a knowledge source or Wiki article, with provenance |

Campaign content (MKT-04) should reuse knowledge sources and Workstream artifacts for files and versions rather than adding a separate document store.

## 4. Draft role and permission matrix

For department owners to correct. **C** create, **R** read, **U** update, **A** approve or decide, **—** no access. "Own" means records the user owns or is assigned to.

### 4.1 Department roles (new)

Each Sandz user has one or more department memberships, each with a role: `member`, `lead` (department head or supervisor) or `viewer`. Platform `admin` keeps its bypass, as in every existing helper.

### 4.2 Matrix

| Record / action | Marketing member | Marketing lead | Sales member | Sales lead | Presales / Delivery / Maintenance | Knowledge curator | Admin |
|---|---|---|---|---|---|---|---|
| Customer (non-restricted) | C R U | C R U | C R U | C R U | R | R | C R U A |
| Customer (restricted) | R if granted | R U if granted | R if granted | R U if granted | R if granted | — | C R U A |
| Merge duplicate customers | — | A | — | A | — | — | A |
| Contact | C R U | C R U | C R U | C R U | R | — | C R U |
| Campaign | C R U own | C R U A | R | R | — | R | C R U A |
| Campaign content for external publication | C U draft | A | R | R | — | R | A |
| Telemarketing activity | C R U own | R U | R | R | — | — | R |
| Lead qualification | C (propose) | A | R | R | — | — | A |
| Lead endorsement to Sales | C (propose) | A | R | A (accept / return) | — | — | A |
| Opportunity (after acceptance) | R | R | C R U own | C R U A | R | — | C R U A |
| Bid / tender submission | C U draft | A | R | R | R | — | A |
| Accreditation | C U | A | — | — | — | — | A |
| Promote record to knowledge | C (submit) | C (submit) | C (submit) | C (submit) | C (submit) | A | A |

### 4.3 Rules the matrix assumes

1. **Nobody approves their own submission**, matching the existing rule for Project creation approval.
2. **The assistant can only create drafts** (`awaiting_acceptance`). Acceptance requires a human with update rights on the record; approval requires the A right.
3. **Restricted customers** are visible only through an explicit grant, logged like `resource_access_audit_log`. Admin bypass is logged too.
4. **Contact personal data** is classified `internal` at least, so the sensitivity gate blocks providers not approved for it.
5. **Read access to a customer does not imply access to its Ember Project workspaces.** Project membership still governs those.

### 4.4 Mapping to existing platform roles

Sandz staff accounts could all be `member` at platform level, with Sandz rights coming from department membership. Knowledge curators keep the platform `curator` role, which Ember uses for knowledge base review. The builder-programme meaning of `curator` (agency) and `consultant` (builder) does not apply on the SLI instance. It applies on the separate Sandz Builders instance (ADR-0002), which runs the builder programme for internal and external builders.

## 5. Open decisions for S2

Carried from the concept paper §11, with what the codebase adds:

| Decision | Codebase consideration |
|---|---|
| Separate instance or shared deployment? | **Proposed: separate instance, shared codebase** (ADR-0002). |
| Which Zoho records and history migrate? | Decides the scope of the importer and the deduplication rules. Must be settled before the S2 completion criterion can be tested. |
| Who may create, edit, approve and endorse? | Draft answer in §4; needs department owners' sign-off. |
| How does Sales formally accept a Marketing handoff? | Proposed: an explicit `sli_handoffs` transition (`proposed → accepted / returned`, with reason), following the conformance-decision pattern. |
| Which operational records may AI retrieve before approval? | Proposed default: the assistant may read records the user can read, inside a conversation, through the sensitivity gate; operational records are **not** indexed into knowledge retrieval until promoted. |
| Which functions remain in external applications? | Affects whether email, telephony and calendar integration are in pilot scope. |
| **New:** Which Ember Project owns Sandz's shared knowledge bases? | Knowledge base attachment and source submissions are Project-scoped today. Options: a "Sandz Knowledge" Project per department, or one shared one. |
| **New:** Department switches | One `EMBER_SLI_ENABLED` switch, or per-department switches? (ADR-0002 open question.) |

## 6. Proposed S2 work package

**Revised sequence (26 October 2026).** Discovery now comes first. S2–S3 are Discovery ([design](../dev-request-sandz-sli-discovery-and-triggers.md)), and the registry below becomes S4 ([design](../dev-request-sandz-sli-customer-and-contact-registry.md)):

| Milestone | Focus |
|---|---|
| S1 | Ember codebase assessment (this document) |
| S2 | Discovery workspace: SLI shell, Triggers, research on Workstreams, concept and feasibility Methods |
| S3 | Management decisions and handoffs: promote, return, send back; **candidate customers** for the Marketing handoff, on the registry's customer core (customers, duplicate checks, rankings) |
| S4 | Rest of the customer and contact registry: contacts, merge, restricted customers, Zoho import, Ember tools (the work package below) |
| S5 | Marketing workflows. The Marketing **knowledge foundation** is brought forward to run alongside S2–S3 ([design](../dev-request-sandz-sli-knowledge-foundation.md)) |
| S6 | Marketing-to-Sales handoff (reusing the S3 handoff mechanism) |
| S7 onward | Presales, Delivery, Maintenance and continuous learning |

The work package below is unchanged and now describes S4.

1. Migrations: `sli_departments`, `sli_department_members`, `sli_customers`, `sli_contacts`, `sli_contact_methods`, access helpers, sensitivity and grant tables, history tables.
2. Service layer `src/lib/sli/customers.ts` and `contacts.ts` with duplicate detection (name normalisation, registration number, email domain).
3. Routes for search, create, view and edit; navigation behind the module switch.
4. Behavioural RLS tests on PGlite covering every row of the §4 matrix for customers and contacts, plus migration-shape tests in the existing style.
5. `docs/CURRENT-ARCHITECTURE.md` gains a "Solution Lifecycle Intelligence" section once S2 lands.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Building a second requirements system for Presales | Link `sli_solutions` to existing solution requirements from S2. |
| RLS defects expose restricted commercial records | Behavioural RLS tests per matrix row; restricted-by-grant default for sensitive accounts. |
| Builder-programme behaviour appears on the SLI instance (workspace provisioning, metering, fees) | The builder programme runs on the separate Sandz Builders instance (ADR-0002). On SLI, switch it off and test that account creation does not provision `builder_lab` workspaces. |
| Operational chatter pollutes approved knowledge | Keep operational records out of retrieval until promoted through curator review. |
| Shared migrations affect other Ember deployments | Sandz tables are additive and inert when the module is off; no changes to Core RLS without review. |
