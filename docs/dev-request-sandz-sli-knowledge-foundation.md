# Ember Sandz — Knowledge Foundation (Marketing first)

*Ember Sandz: Solution Lifecycle Intelligence*

## Status

**Proposed, not built.** This design brings the knowledge part of milestone S5 forward, so it runs **alongside S2–S3** (Discovery) while the customer registry waits for the Marketing team's answers. It is mostly configuration and content work on Ember's existing knowledge features, plus a small build (§11).

It adopts the *Ember Sandz — Knowledge Base Strategy* (Phase 1: Marketing), with the adjustments in §1 that come from checking it against how Ember actually works.

## 1. What we adopt, and what we adjust

**Adopted from the strategy:**

- Knowledge is organised as **shared enterprise knowledge, departmental knowledge and customer knowledge**, not one large knowledge base per department.
- **One governed source, referenced wherever authorised.** Shared knowledge is attached, never copied.
- **Three knowledge classes:** source evidence, approved knowledge and working knowledge (§4).
- **Start with three knowledge bases**, not six, and split them when volume, ownership or permissions justify it (§3).
- **Inventory before ingestion.** Start with a controlled set of documents that support real Marketing work (§10).
- **A departmental knowledge curator**, not every employee as an administrator. Contributors can submit without being able to approve.
- **A readiness benchmark before relying on the assistant**, including questions that deliberately have no supported answer (§9).

**Adjusted:**

| Strategy says | Adjustment | Why |
|---|---|---|
| Knowledge bases for each department | Each department gets a **department workspace**: an Ember Project, hidden from SLI users, that its knowledge bases attach to | In Ember, knowledge retrieval and permissions work through Project membership and attachment. Discovery already uses one hidden Project the same way |
| Codes MKT-01 to MKT-06 for knowledge collections | Knowledge bases use `KB-` codes (`KB-ENT-SOL`, `KB-MKT-OPS`, `KB-CORP`) | MKT-01 to MKT-10 are already the Marketing *requirement* IDs in the concept paper |
| A new metadata set for every source | Most fields already exist; add four generic fields to Ember and SLI links for department, process and solution (§5) | Avoids a duplicate metadata system, as the strategy itself asks |
| Customer / engagement knowledge as a knowledge scope | Stays in the customer registry and per-customer records (S4 onward). Only reviewed, anonymised lessons become shared knowledge | Customer-specific knowledge must not become retrievable by unrelated users |
| Curators run the AI benchmarks | Curators write the questions, expected answers and evidence; a platform admin runs the evaluation; the curator records the readiness verdict | Since October 2026, running evaluations is platform-admin work in Ember |
| Restricted accreditation documents in the knowledge base | Tax, banking and similar records are classified **restricted**: stored and access-controlled, but never sent to an external AI provider. Safe summaries are published as internal Wiki articles | Ember's AI policy gate sends restricted material only to a private model, and Sandz has none yet |

**Sandz documents never go into the GitHub repository.** The repository is public. The Marketing process document, product briefs and everything in the inventory are uploaded into the Ember Sandz instance's knowledge bases, where access controls apply.

## 2. Knowledge architecture in Ember terms

| Logical scope (strategy) | In Ember |
|---|---|
| Sandz Enterprise Knowledge | Shared knowledge bases (starting with `KB-ENT-SOL`), attached to several department workspaces and to the Discovery Project |
| Marketing, Sales, Presales, Delivery, Maintenance, Compliance knowledge | Knowledge bases owned by each department's workspace. Marketing starts with `KB-MKT-OPS` and `KB-CORP` |
| Customer / Engagement knowledge | Customer registry records and per-customer workspaces (S4 onward), not a shared knowledge base |
| Approved knowledge | Approved sources and Wiki articles in the department workspace |
| Working knowledge | Ember's working knowledge (private notebooks, shareable) and Workstream artifacts |

**Attaching never copies.** A knowledge base attached to several workspaces has one set of sources, one curator and one approval history (`project_knowledge_bases`).

## 3. The first three knowledge bases

Created per instance by a setup script (data, not a migration, because other SLI customers will choose their own; ADR-0002).

| Code | Name | Owner (curator) | Attached to | Contents | Becomes later |
|---|---|---|---|---|---|
| `KB-ENT-SOL` | **Enterprise Solutions Knowledge** | Marketing curator for the pilot; Presales co-curator later | Marketing workspace, Discovery Project; later Sales, Presales, Maintenance | Sandz company and solution profiles, vendor and partner product descriptions, approved value propositions, use cases, differentiators | Stays shared; may split by solution area |
| `KB-MKT-OPS` | **Marketing Operations Knowledge** | Marketing curator | Marketing workspace | The Marketing process, campaign plans and reports, messaging and approved copy, personas and segments, telemarketing guides, qualification criteria, endorsement procedures | Market & Customer Intelligence; Campaigns & Content; Lead Qualification & Handoffs |
| `KB-CORP` | **Corporate & Compliance Knowledge** | Marketing curator, with restricted access | Marketing workspace | Government bidding procedures and checklists, accreditation procedures and renewal requirements, corporate credentials | Government Bidding; Accreditation & Corporate Credentials |

**Sensitivity defaults:** `KB-ENT-SOL` and `KB-MKT-OPS` are **internal**. `KB-CORP` is **confidential**, and its tax, banking and financial records are **restricted** and visible only to an access group (for example *Corporate documents*) inside the Marketing workspace, using Ember's evidence access controls.

## 4. Knowledge classes

| Class | What it is | In Ember | Who can make it |
|---|---|---|---|
| **A — Source evidence** | Original documents with source, version, owner, date and provenance. Uploading does not make a document authoritative | Knowledge sources with immutable versions | Contributors submit (source submissions); curators accept into the knowledge base |
| **B — Approved knowledge** | Reviewed procedures, current solution briefs, validated claims, official guidelines, reusable methods | Approved sources (approved chunks are searchable) and approved Wiki articles | Curators approve |
| **C — Working knowledge** | Research notes, campaign ideas, AI drafts, preliminary findings, proposed lessons | Working knowledge notebooks and Workstream artifacts | Anyone in the workspace; never authoritative until submitted and approved |

## 5. Metadata

| Strategy field | Where it lives |
|---|---|
| Title | Existing: knowledge source title |
| Version | Existing: immutable source versions with change notes |
| Classification | Existing: information sensitivity (`public`/`internal`/`confidential`/`restricted`) |
| Status (draft, reviewed, approved, retired) | Existing, mapped: *pending review* (submitted, not yet approved), *approved* (current version approved), *retired* (source lifecycle). Ember has no separate "reviewed" step; the curator's approval is the review |
| Approver | Existing: recorded by the approval |
| Knowledge ID (for example `MKT-LEAD-001`) | **New, generic:** `knowledge_sources.knowledge_code` |
| Source type (process, guideline, brochure, report, template…) | **New, generic:** `knowledge_sources.source_type` |
| Effective and review dates | **New, generic:** `knowledge_sources.effective_on`, `review_on`. A source past its review date shows as *review due* to its curator |
| Owner | **New, SLI:** owning department (`sli_knowledge_source_links.department_id`) |
| Related process | **New, SLI:** process from a reference list (discovery, positioning, content, execution, measurement, telemarketing, government bidding, accreditation) |
| Related solution | **New, SLI, optional:** free text now; a link to a solution record when solutions exist |

The four generic fields go into Ember Core because every Ember instance can use them. The SLI links stay in the SLI module.

## 6. Department workspaces and roles

Each SLI department has a hidden Ember Project (its **department workspace**). Membership is kept in step with SLI department membership, so nobody manages two lists:

| Strategy role | SLI | Ember underneath |
|---|---|---|
| Department Head | Department lead | Workspace owner: accountable for quality and approval policy |
| Knowledge Curator | Named per department (Marketing to nominate one) | Workspace curator: approves sources and Wiki articles, retires knowledge, sets the readiness verdict |
| Contributor | Department member | Workspace member who can submit sources and findings but not approve them |
| Knowledge Consumer | Department viewer, and members of departments the knowledge base is attached to | Workspace viewer, or member of another workspace with the knowledge base attached |
| AI / Platform Administrator | Platform admin (Head of Engineering for the pilot) | Platform admin: ingestion settings, AI models, running evaluations |

On an SLI instance the builder programme is off, so Ember's platform `curator` role means knowledge curator, not agency (ADR-0002).

## 7. Creating new knowledge bases

Marketing can create its own knowledge bases as needs grow.

- **Who:** the department's knowledge curator, from the SLI Knowledge workspace (§8).
- **How:** name, purpose, sensitivity and owning department. The new knowledge base starts **pending** and is attached to that department's workspace.
- **Approval:** the department head or a platform admin approves it. Uploads can start while it is pending, as in Ember today, but nothing in it is searchable until it is approved.
- **Change needed:** today only platform curators and admins can create knowledge bases, and only platform admins approve them. SLI adds creation by department curators and approval by department heads, through `SECURITY DEFINER` functions, without loosening the Core policies.
- **When to split:** guidance shown when creating one: split when a collection has a different owner, different access rules, or enough documents that searching it separately helps (as a rule of thumb, more than about 200 active sources).

## 8. The Knowledge workspace (purpose-built for Marketing)

Marketing gets purpose-built screens in the SLI shell, not Ember Core's knowledge pages (ADR-0002, "UI per audience"). The functions underneath are Ember's.

| Screen | What it does | Ember function underneath |
|---|---|---|
| **Collections** | The department's knowledge bases and the shared ones attached to it, with counts, owner and status; **New collection** for curators | Knowledge bases and attachments |
| **Sources** | Upload with the metadata in §5; see versions; upload a new version; retire | Curator pipeline: upload, parse, chunk, enrich, embed; versioned sources |
| **Review queue** | Submissions and drafts waiting for the curator, and sources past their review date | Source submissions; document approval; Wiki draft approval |
| **Knowledge gaps** | Questions the assistant could not answer from approved knowledge, and failure reports | Knowledge gaps (automatic and reported) |
| **AI readiness** | Benchmark questions, latest results, curator verdict | Eval datasets, Ember readiness |

Labels use business language: "collection" rather than "knowledge base", "check" rather than "evaluation".

## 9. Readiness benchmark

Before Marketing relies on the assistant, the curator writes a small benchmark, with an expected answer and supporting evidence for each question:

1. What are Sandz's approved value propositions for a particular solution?
2. What steps must Marketing follow before launching a campaign?
3. What happens when the telemarketing contact is unavailable?
4. What qualifies a lead for endorsement to Sales?
5. Which approvals are required for campaign content?
6. What documents are needed for a particular government bid?
7. What is the accreditation renewal process?
8. What information is missing to answer this customer question?

At least two further questions have **no supported answer** in the knowledge bases, to test that the assistant says so rather than inventing one.

- **Who does what:** the curator writes the questions (Ember dataset authoring). A platform admin runs the evaluation. The curator records the readiness verdict.
- **What is measured:** grounding, correctness, whether only authorised sources were used, and unanswered questions. Failures become knowledge gaps.
- **Ready for controlled use** when critical procedures have approved sources, restricted-document access passes testing, and the curator has reviewed the benchmark results. This does not mean the assistant can act on its own.

## 10. Ingestion plan and knowledge inventory

**Inventory first.** Marketing lists the documents it actually uses before anything is uploaded. Columns:

| Column | Example |
|---|---|
| Document title | Telemarketing Qualification Guide |
| Current location | Shared drive folder, Zoho, email |
| Owner | Marketing |
| Source type | Guideline |
| Related process | Telemarketing |
| Proposed collection | `KB-MKT-OPS` |
| Sensitivity | Internal |
| Approval status | Current, outdated, draft |
| Version and date | 1.0, March 2026 |
| Notes | Replaces the 2024 script |

**Ingestion order:**

| Priority | Documents | Collection |
|---|---|---|
| 1 | The Marketing End-to-End Process document | `KB-MKT-OPS` (the first source) |
| 2 | Sandz corporate and solution profiles | `KB-ENT-SOL` |
| 3 | Vendor brochures and approved product descriptions | `KB-ENT-SOL` |
| 4 | Campaign plans and previous campaign reports | `KB-MKT-OPS` |
| 5 | Telemarketing scripts and lead endorsement forms | `KB-MKT-OPS` |
| 6 | Sample government tender packages and checklists | `KB-CORP` |
| 7 | Accreditation checklists and current credentials | `KB-CORP` (restricted where needed) |

The Marketing process document sets the process baseline but not all the operational detail. Endorsement forms, field definitions, targets and approval responsibilities still have to be collected.

## 11. What is configuration and what is build

| Work | Type |
|---|---|
| Create the three knowledge bases, the Marketing workspace and its access group; attach `KB-ENT-SOL` to the Discovery Project | Setup script (data) |
| Inventory, upload, curate, write Wiki articles | Content work by Marketing and the curator |
| Benchmark questions and expected answers | Content work by the curator |
| Four generic source fields (§5) | Small Core migration and form change |
| SLI source links: department, process, solution (§5) | Small SLI migration |
| Department workspaces kept in step with SLI department membership (§6) | SLI build; shares the department foundation with the Discovery and registry designs |
| Department curators create knowledge bases; department heads approve (§7) | SLI build |
| Purpose-built Knowledge workspace screens (§8) | SLI build (the largest item) |

The department foundation (departments, membership, access helpers) is shared with the Discovery and registry designs, and is built once by whichever comes first.

## 12. Four-week pilot

Planning assumption, not a committed estimate.

| Week | Activity | Output |
|---|---|---|
| 1 | Confirm the collections, owners and access rules; Marketing nominates its curator; inventory started | Approved knowledge structure |
| 2 | Collect and ingest the priority documents | Initial searchable evidence |
| 3 | Curate key Wiki articles and procedures | Approved Marketing knowledge |
| 4 | Run the benchmark; review knowledge gaps | Readiness report and improvement backlog |

Weeks 1–4 need the lab (or production) Supabase stack and the setup script. The purpose-built screens can follow; in the meantime the curator and platform admin use Ember Core's knowledge pages, which is acceptable for those two technical roles but not for Marketing staff in general.

## 13. Open questions for Sandz

1. Who is Marketing's knowledge curator for the pilot?
2. Who owns Enterprise Solutions Knowledge long term: Marketing, Presales, or product management?
3. Where do Marketing's documents live today (shared drive, Zoho, email), and can the curator produce the inventory?
4. Which accreditation and bidding documents count as restricted (tax, banking, financial statements, others)?
5. Who besides Marketing should see Corporate & Compliance Knowledge (for example Presales for technical compliance)?

## 14. Acceptance criteria

1. The three collections exist on the instance with their owners, sensitivity and attachments, created by the setup script.
2. A Marketing member can submit a source but not approve it; the curator can approve it, and only then is it searchable.
3. `KB-ENT-SOL` is searchable from the Marketing workspace and the Discovery Project, with one copy of each source.
4. Restricted documents in `KB-CORP` are invisible to anyone outside the access group, including through the assistant, and are never sent to an external AI provider.
5. Sources carry the §5 metadata, and a source past its review date appears in the curator's review queue.
6. A department curator can create a new collection; it stays pending and unsearchable until the department head or a platform admin approves it.
7. The benchmark runs, unanswerable questions are acknowledged as unanswerable, and failures appear as knowledge gaps.
8. Marketing staff use only the purpose-built Knowledge workspace, not Ember Core screens.
