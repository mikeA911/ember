# Ember Sandz
## Solution Lifecycle Intelligence (SLI)

**Development Concept Paper — Draft v0.1**  
**Date:** 22 October 2026  
**Status:** Proposed design; validate against the Ember codebase and remaining departmental workflows.

## 1. Project Overview

Ember Sandz is an AI-enabled enterprise application for Sandz's customer and solution lifecycle, beginning with Marketing and eventually extending through Sales, Presales, Project Delivery, and Maintenance.

It will be built from the existing Ember codebase, reusing knowledge management, RAG, ontology, agent orchestration, evaluation, and governance capabilities.

**Design principle:** Preserve existing departmental business workflows while replacing fragmented application usage with a unified operational platform.

Unlike a conventional CRM, Ember Sandz accumulates knowledge at every lifecycle stage for authorized employees, applications, and AI agents.

### Objectives

1. Establish a shared Customer and Contact Registry.
2. Digitize existing workflows without prematurely changing business rules.
3. Capture operational evidence and promote approved information into reusable knowledge.
4. Enable AI-assisted work through Ember's existing capabilities.
5. Maintain traceability across departmental handoffs.
6. Support future APIs and MCP integrations.
7. Prepare for eventual commercialization without requiring multi-customer SaaS in the first release.

## 2. Functional Scope

The shared Customer and Contact Registry supports all departmental modules.

| Module | Initial scope | Status |
|---|---|---|
| Marketing | Campaigns, telemarketing, reporting | First implementation |
| Sales | Lead acceptance and opportunities | Workflow pending |
| Presales | Solution engineering and proposals | Workflow pending |
| Project Delivery | Implementation and acceptance | Workflow pending |
| Maintenance | Installed assets and support | Workflow pending |
| Government Bidding / Accreditation | Specialized Marketing processes | Documented; later increment |

All modules will use Ember's evidence, retrieval, ontology, agent, evaluation, and approval capabilities where appropriate.

## 3. Marketing Module — Functional Requirements

The supplied **Sandz Marketing End-to-End Process** describes five stages: Discovery & Insight; Strategy & Positioning; Creative & Content Development; Execution & Activation; Measurement & Optimization. The document also describes telemarketing, government bidding, and accreditation.

| ID | Module | Initial requirement |
|---|---|---|
| MKT-01 | Discovery | Record market research, trends, campaign reviews and customer insights. |
| MKT-02 | Strategy | Define target markets, personas, use cases, value propositions and channels. |
| MKT-03 | Campaign Planning | Create campaigns with objectives, schedules, owners and KPIs. |
| MKT-04 | Content | Create, attach, version, review and approve campaign materials. |
| MKT-05 | Execution | Track campaign launches, activities, events and outreach. |
| MKT-06 | Telemarketing | Record contact attempts, outcomes, callbacks and lead qualification. |
| MKT-07 | Lead Endorsement | Transfer validated leads and supporting information to Sales. |
| MKT-08 | Reporting | Track campaign KPIs, outcomes and postmortems. |
| MKT-09 | Government Bidding | Manage tender requirements, submissions, reviews and outcomes. |
| MKT-10 | Accreditation | Manage applications, supporting documents and renewals. |

### Proposed priorities

- **Priority 1 — Operational foundation:** Customer/contact records, campaigns, telemarketing, lead endorsement, basic reporting.
- **Priority 2 — Knowledge-enabled Marketing:** Approved content, grounded drafting, retrieval and lessons learned.
- **Priority 3 — Specialized workflows:** Government bidding, accreditation, validity and compliance checklists.

These priorities sequence software delivery; they do not alter the documented business process.

## 4. Technical Architecture

**Recommended approach:** Create an `ember-sandz` repository based on the existing Ember application. Initially retain a modular monolith, not a premature microservice architecture. Extract reusable interfaces and services incrementally.

| Layer | Responsibility |
|---|---|
| Presentation | Next.js departmental interfaces, workflows and dashboards |
| Business services | Customer registry, campaigns, leads, workflow state and handoffs |
| Ember services | Knowledge, ontology, retrieval, agents, methods and evaluations |
| Integration | MCP, REST APIs, external systems and event adapters |
| Data | Supabase Postgres, pgvector and object storage |
| Security | Authentication, RBAC, RLS, resource grants and audit logs |

### Boundaries

- **Ember Core:** Generic knowledge processing, retrieval, evaluation and AI functions.
- **Ember Sandz:** Operational records and departmental workflows.
- **Shared services:** Identity, authorization, audit and integration contracts.
- **External systems:** Retain or integrate where required; do not assume everything must be replaced immediately.

Audit the actual Ember codebase before deciding which components are reusable without changes.

## 5. Proposed Data Model

Primary entities:

- Organization / Customer
- Contact
- Campaign
- Campaign Activity
- Lead / Opportunity
- Solution
- Project
- Installed Asset
- Service Case
- Knowledge Reference

### Modeling rules

1. A customer can have multiple contacts, opportunities, solutions and projects.
2. A campaign can target multiple contacts and generate multiple leads.
3. A lead retains campaign origin and qualification history when endorsed to Sales.
4. A solution can have multiple deployments, installed assets and maintenance cases.
5. Knowledge links to operational evidence and preserves provenance.
6. Draft operational information remains distinct from approved reusable knowledge.
7. Customer-specific knowledge cannot be exposed to unrelated customers or unauthorized users.

Do not use Ember's existing **Project** record as a substitute for every business entity. Customers and solutions persist across multiple engagements.

## 6. Workflow Engine and AI Integration

Business workflow transitions should be deterministic and auditable. AI may recommend actions, draft content and summarize interactions, but must not independently approve bids, qualify leads or publish canonical knowledge.

### Telemarketing example

1. Prepare call list, audience context and campaign guidance.
2. Attempt contact.
3. If the correct contact is reached, validate interest and arrange a meeting, callback or collateral follow-up.
4. If the correct contact is not reached, request contact information or an appropriate corporate address.
5. Record outcome, next action and relevant evidence.
6. Endorse validated leads to Sales with traceable context.

This preserves the decision branches in the Marketing workflow document (page 6).

### AI opportunities

| Capability | Example |
|---|---|
| Knowledge retrieval | Find approved product specifications and previous proposals. |
| Content drafting | Draft campaign copy grounded in approved solution information. |
| Lead assistance | Summarize requirements and suggest follow-up questions. |
| Bid assistance | Identify supporting documents and potential requirement gaps. |
| Knowledge capture | Suggest lessons learned for curator review. |
| Readiness evaluation | Assess whether knowledge sufficiently supports an answer. |

Reuse Ember's existing evaluation, provenance and human-approval mechanisms.

## 7. Security and Governance

The first release must provide:

- Authentication and department-specific permissions.
- Record-level authorization for customers, campaigns and projects.
- Restricted access to confidential commercial information.
- Human approval for externally published content and formal submissions.
- Audit history for material changes, approvals and handoffs.
- Provenance for AI-generated outputs and approved knowledge.
- Authorized read-only MCP retrieval before external write operations.

Review existing Ember RLS policies and Project access controls for the new operational entities.

## 8. Development Milestones

| Milestone | Deliverable | Completion criterion |
|---|---|---|
| S1 | Ember codebase assessment | Reusable services and modifications identified. |
| S2 | Customer and Contact Registry | Authorized users can create, search and maintain shared records. |
| S3 | Marketing workflows | Campaign and telemarketing paths work end-to-end. |
| S4 | Sales handoff | Qualified lead and history transfer without information loss. |
| S5 | Knowledge integration | Approved evidence is retrievable with citations and access controls. |
| S6 | Specialized Marketing | Bidding and accreditation workflows implemented and tested. |
| S7 | Department expansion | Additional workflows implemented following discovery. |

Each milestone should include migrations, automated tests, role-based acceptance tests and updated technical documentation.

## 9. Initial Acceptance Test

1. Register a prospective customer and contacts.
2. Create a marketing campaign for a target industry.
3. Attach approved product information and campaign materials.
4. Execute the documented telemarketing workflow.
5. Record customer interest and high-level requirements.
6. Qualify and endorse the lead to Sales.
7. Verify Sales can view the complete authorized history.
8. Ask Ember to summarize requirements using traceable evidence.
9. Confirm unauthorized users cannot retrieve restricted records.

**Pilot success:** The process completes without duplicate customer records, lost handoff information, unauthorized knowledge exposure or unapproved AI actions.

## 10. Development Deliverables

Maintain a version-controlled implementation package with:

- Domain model and database migrations
- Role/permission matrix
- API and MCP contracts
- Workflow definitions
- User stories and acceptance tests
- Deployment instructions
- Architecture decisions and open issues

Keep the existing Ember M1–M10 roadmap as the reference for generic AI capabilities; track SLI-specific work separately.

## 11. Open Decisions

- Separate Ember Sandz instance or initially shared deployment?
- Which Zoho records and history require migration?
- Who may create, edit, approve and endorse records?
- How does Sales formally accept a Marketing handoff?
- Which operational records may be retrieved by AI before approval?
- Which functions remain in external applications?

Record resolutions as architecture decisions, not undocumented assumptions.

## Recommendation

**Build Ember Sandz incrementally, beginning with the shared Customer and Contact Registry and documented Marketing workflow.** Preserve business processes, reuse Ember's proven capabilities, and separate operational records from approved institutional knowledge.

The first release should demonstrate a complete Marketing-to-Sales handoff while accumulating trustworthy, reusable knowledge. The same architecture can later support Presales, Project Delivery, Maintenance and external customers.

---

**Source documents:**
- *Sandz Marketing End-to-End Process*, 9-page supplied workflow, October 2026.
- *KB Sandbox / Ember Roadmap*, supplied internal roadmap updated 7 October 2026.

**Note:** This concept paper contains proposed software design choices as well as documented existing workflows. Validate the design against the actual repository and department owners before implementation.
