# Ember Sandz — Customer and Contact Registry

*Ember Sandz: Solution Lifecycle Intelligence*

## Status

**Proposed, not built.** This is milestone **S4** in the revised SLI sequence, which now starts with Discovery ([Discovery design](dev-request-sandz-sli-discovery-and-triggers.md), S2–S3). It was milestone S2 in the original [Ember Sandz concept paper](ember-sandz/Ember_Sandz_Development_Concept_v0.1.md). It turns the S2 work package in the [S1 codebase assessment](ember-sandz/S1-EMBER-CODEBASE-ASSESSMENT.md) §6 into a buildable design. It follows [ADR-0002](architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md): SLI is a module in this codebase, switched on per instance.

Field choices are grounded in Sandz's current Zoho CRM, as seen on 23 October 2026 (§3). The open questions in §13 need Sandz's answers before Stage 2 is finalised.

## Delivery stages

1. **Module switch, departments and access foundation.** `EMBER_SLI_ENABLED`, departments and department membership, access helpers, change history.
2. **Customers.** The company record: classification, ownership with history, tags, notes.
3. **Contacts.** People, their contact methods and consent, and their links to customers over time.
4. **Duplicate detection and merge.** Checks on create, a merge with history, and no hard deletes.
5. **Restricted customers.** Sensitivity, explicit grants, access audit.
6. **Zoho import.** Dry run, field mapping, external IDs, duplicate report. Depends on the migration decision (§13).
7. **Ember and MCP read tools.** Customer summary and search through the sensitivity gate.

Stages 1–5 complete the registry milestone ("authorized users can create, search and maintain shared records"). Stages 6–7 can follow alongside S5 (Marketing workflows).

**Shared with Discovery:** stage 1 here (module switch, departments, access helpers, change history) is also the foundation for Discovery. Whichever is built first builds it once. Discovery Triggers link to customers through `sli_trigger_links` once this registry exists.

## 1. Problem

Sandz keeps customer information in Zoho CRM, alongside files, email and team knowledge. The concept paper's first objective is a **shared customer and contact registry** that every department uses, and which later lifecycle stages build on: Marketing campaigns, Sales leads, Presales requirements, Delivery projects and Maintenance assets.

The registry has to:

- give every authorised employee one record per company, without duplicates (the pilot's first success criterion);
- keep people (contacts) separate from companies, because people change jobs and companies outlive any one campaign;
- record who owns the relationship, and how that has changed over time;
- protect confidential commercial information and personal data;
- carry an audit history of material changes;
- stay distinct from Ember Projects: a customer persists across many engagements (concept paper §5).

## 2. Decision

- **The customer is the company Sandz sells to.** The table is `sli_customers`. "Organization" stays reserved for the future tenant record (ADR-0002).
- **Contacts are people, linked to customers over time.** One contact can have several customer links (current and past), each with a job title and dates.
- **One shared registry, department-scoped permissions.** Marketing and Sales maintain it; Presales, Delivery and Maintenance read it; restricted customers need an explicit grant.
- **Structured fields where Zoho uses tags with a consistent meaning.** Free tags stay for the rest.
- **Ownership is a history, not a field.** Account owner, ISR owner and account rep are dated assignments, so "who covered this account in 2024" can be answered. This replaces Zoho's region history related list.
- **Nothing is hard-deleted.** Records are archived or merged, with history.
- **Writes go through the service layer** (`src/lib/sli/`), so the UI, Ember tools and MCP tools share one authorization model (ADR-0002).

## 3. What we learned from Zoho

Observed in Sandz's Zoho CRM on 23 October 2026: the Campaigns list and one Company record. People's names, the customer's name and the Zoho organisation ID are deliberately left out of this document, because the repository is public.

### Modules in use

Under the CRM Team space: My Jobs, Leads, **Campaigns**, **Contacts**, **Company**, Campaign Tracker, Tasks, Meetings, Calls, Account Rep, Old Leads. Zoho also shows Home, Workqueue, Reports, Analytics, **Agents** and **MCP**. Zoho's own AI agents and MCP server are relevant to the coexistence question (§11).

### Company record ("Sandz Layout")

| Zoho field or element | Example | SLI field | Notes |
|---|---|---|---|
| Company Name | (a Philippine manufacturer) | `name` | Also `normalized_name` for duplicate checks |
| Website | company domain | `website`, `domain` | `domain` is normalised (lowercase, no `www.`) and is the strongest duplicate signal |
| Trunk Line | landline | `main_phone`, `main_phone_normalized` | |
| Company Industry | Manufacturing | `industry` | Controlled list |
| Sub-Industry | Semicon | `sub_industry` | Controlled list, per industry |
| Conglomerate | — | `parent_customer_id` | A group or parent company, modelled as a link to another customer |
| Top 1000 Rank | a number | `top1000_rank` | Source to confirm (§13) |
| BSP Rank | — | `bsp_rank` | Meaning to confirm (§13) |
| Status | Leads | `lifecycle_status` | Values to confirm (§13) |
| Company Owner | a person | assignment `account_owner` | Dated |
| ISR Owner | a person | assignment `isr_owner` | Inside sales representative; dated |
| Account Rep | a person | assignment `account_rep` | Dated |
| Call Status | Contacted | `call_status` | Kept on the customer for now; becomes derived from S5 telemarketing activities |
| Infra Status | Profiled | `infra_profile_status` | How well Sandz knows the customer's infrastructure; values to confirm |
| Tags | country, interest, programme, priority and stage tags (for example a country, "OpentoCloud", "Demand Gen", "Medium Priority Prospect", "With Lead") | `country_of_origin`, `priority`, tags | Tags with a consistent meaning become fields; the rest stay as tags (§13) |
| Created By / Modified By | person and date | `created_by`, `updated_by`, timestamps | Plus the change history |
| Related lists: Notes, Attachments, Emails, Contacts, Leads, Connected Records | | notes, contacts (this design); leads (S5–S6); attachments and email (later) | |
| Related list: Region 1 History | | assignment history | |
| Timeline | | change history plus activities | Activities arrive with S5 |

### Campaigns (recorded now for S5)

Campaign Name; Type (Email, Conference); Status (Planning, Active); Start Date; Actual Cost; Budgeted Cost; Campaign Owner; Campaign Subject; Connected To. Views by year ("2025 Campaigns", "2026 Campaigns"); 29 records in the 2026 view. Campaign names show recurring solution themes (virtualisation, private AI, data protection, disaster recovery) and industry targeting (supply chain, manufacturing). S3 should model campaign themes and target industries using the same industry list as customers.

## 4. Data model (indicative)

All tables are new, prefixed `sli_`, with RLS on. Each migration ends with `select apply_oauth_read_only_policies();` (enforced by `src/lib/mcp/read-only-migrations.test.ts`).

### Departments (Stage 1)

| Table | Key columns |
|---|---|
| `sli_departments` | `id`, `code` (unique: `management`, `marketing`, `sales`, `presales`, `delivery`, `maintenance`), `name`, `is_active`. Presales includes Sandz's engineering and procurement staff; management is the Discovery team |
| `sli_department_members` | `department_id`, `user_id`, `role` (`member`/`lead`/`viewer`), `status` (`active`/`inactive`), unique (department, user) |

Department names and codes are seeded per instance as data, not code (ADR-0002).

### Customers (Stage 2)

| Table | Key columns |
|---|---|
| `sli_customers` | `id`, `name`, `legal_name`, `normalized_name`, `website`, `domain`, `main_phone`, `main_phone_normalized`, `industry`, `sub_industry`, `country_of_origin`, `parent_customer_id`, `lifecycle_status`, `priority` (`low`/`medium`/`high`), `top1000_rank`, `bsp_rank`, `call_status`, `infra_profile_status`, `information_sensitivity` (`public`/`internal`/`confidential`/`restricted`, default `internal`), `source` (`manual`/`zoho_import`), `merged_into_id`, `archived_at`, `created_by`, `created_at`, `updated_by`, `updated_at` |
| `sli_customer_assignments` | `customer_id`, `role` (`account_owner`/`isr_owner`/`account_rep`), `user_id`, `valid_from`, `valid_to`, `assigned_by`; at most one current (`valid_to is null`) per customer and role |
| `sli_tags` | `id`, `name` (unique), `category` (optional), `is_active` |
| `sli_customer_tags` | `customer_id`, `tag_id` |
| `sli_reference_values` | `list` (`industry`, `sub_industry`, `lifecycle_status`, `call_status`, `infra_profile_status`), `code`, `label`, `parent_code` (sub-industry under industry), `sort_order`, `is_active` |
| `sli_notes` | `id`, `subject_type` (`customer`/`contact`), `subject_id`, `body`, `created_by`, `created_at`, `edited_at` |

Controlled lists live in `sli_reference_values` so Sandz can maintain them without a release.

### Contacts (Stage 3)

| Table | Key columns |
|---|---|
| `sli_contacts` | `id`, `first_name`, `last_name`, `display_name`, `preferred_channel`, `marketing_consent` (`unknown`/`given`/`withdrawn`), `consent_recorded_at`, `consent_source`, `do_not_contact`, `information_sensitivity` (default `internal`), `source`, `merged_into_id`, `archived_at`, audit columns |
| `sli_contact_methods` | `contact_id`, `kind` (`email`/`mobile`/`landline`/`viber`/`whatsapp`/`linkedin`/`other`), `value`, `normalized_value`, `is_primary`, `opted_out_at` |
| `sli_customer_contacts` | `customer_id`, `contact_id`, `job_title`, `department_text`, `is_primary`, `started_on`, `ended_on` (null = current) |

### Supporting tables

| Table | Purpose |
|---|---|
| `sli_external_ids` | `entity_type`, `entity_id`, `system` (`zoho`), `external_id`; unique (system, entity type, external ID). Import traceability (Stage 6) |
| `sli_access_grants` | `customer_id`, `grantee_user_id` or `grantee_department_id`, `granted_by`, `reason`, `expires_at`, `revoked_at` (Stage 5) |
| `sli_access_audit_log` | Append-only: grants, revocations, admin access to restricted customers, exports (Stage 5) |
| `sli_change_history` | Append-only: `entity_type`, `entity_id`, `action` (`create`/`update`/`archive`/`merge`/`assign`), `changed_by`, `changed_at`, `changes` (changed fields, before and after). Written by triggers, so no write path can skip it (Stage 1) |

## 5. Duplicate detection and merge (Stage 4)

Duplicate-free records are the pilot's first success criterion, and the Zoho import will test it hardest.

**Customers**

| Signal | Strength | On create |
|---|---|---|
| Same normalised domain | Strong | Blocked; open the existing record or ask a lead to merge |
| Same normalised main phone | Strong | Warning with the matching record; "create anyway" needs a reason |
| Similar name (after removing suffixes such as Inc., Corp., Corporation, Co., Ltd., Philippines, Phils.) | Possible | Shown as possible matches |

Name similarity uses the `pg_trgm` extension (included in the Supabase Postgres image, so it works on the self-hosted stacks). A function `sli_find_customer_duplicates(name, domain, phone)` returns candidates with the reason for each, and is used by the UI, the importer and Ember.

**Contacts**

| Signal | Strength | On create |
|---|---|---|
| Same email | Strong | Blocked |
| Same mobile number | Strong | Warning |
| Same name at the same customer | Possible | Shown |

**Merge** (`sli_merge_customers(keep_id, merge_id, reason)` and `sli_merge_contacts(...)`, both `SECURITY DEFINER`):

- Only department leads and platform admins.
- Moves contact links, assignments, tags, notes and external IDs to the kept record, fills empty fields from the merged one, and sets `merged_into_id` on the merged record.
- Writes one history entry on each record. Never hard-deletes.
- Links to a merged record (from later leads or campaigns) resolve to the kept record.

## 6. Authorization

Follows the draft permission matrix in the S1 assessment §4, which department heads still need to confirm.

**Helpers** (`SECURITY DEFINER`, platform-admin bypass built in, same pattern as `is_project_member`):

- `sli_is_department_member(uid, department_code)`, `sli_is_department_lead(uid, department_code)`
- `sli_can_view_customer(uid, customer_id)`, `sli_can_edit_customer(uid, customer_id)`
- `sli_can_view_contact(uid, contact_id)`, `sli_can_edit_contact(uid, contact_id)`

**Rules**

| Action | Who |
|---|---|
| Read a non-restricted customer | Any active member of any SLI department (including viewers) |
| Read a restricted customer | Holders of an active grant (user or department); platform admins, with the access logged |
| Create or update customers and contacts | Marketing and Sales members and leads; other departments read only |
| Assign owners, ISR owners and account reps | Marketing and Sales leads |
| Merge | Department leads, platform admins |
| Archive | Department leads, platform admins |
| Grant access to a restricted customer | Marketing and Sales leads; platform admins |
| Manage departments, members and reference lists | Platform admins |

- **Contacts follow their customers.** A contact is visible if any customer it is linked to (now or in the past) is visible. An unlinked contact is visible to its creator's departments.
- **Restricted wins.** A contact linked only to restricted customers is visible only to those with access to one of them.
- **No Project leakage.** Access to a customer gives no access to Ember Projects linked to it later (S1 assessment §4.3).
- **Defence in depth.** Service functions call `requireUser()` and the helpers; RLS is the backstop.

## 7. Personal data

Contact details are personal information under the Philippine Data Privacy Act (RA 10173).

- Contacts default to `internal` sensitivity, so the AI sensitivity gate (`src/lib/ai/sensitivity.ts`) blocks providers not approved for internal data.
- `marketing_consent`, `do_not_contact` and per-method `opted_out_at` are stored now; S5 telemarketing and campaigns must enforce them.
- **Exports** are permission-checked and logged in `sli_access_audit_log`.
- **Data subject requests:** a platform-admin function anonymises a contact (names and methods replaced, links and history kept with the personal values removed) and records why. Designed now; exact retention rules to confirm (§13).
- **Lab uses synthetic data only.** Real Zoho exports are imported into production only (moving guide, Phase 1).

## 8. User interface

Routes under `src/app/(app)/sli/`, hidden from navigation and returning not-found when `EMBER_SLI_ENABLED` is off. The `/sli/` prefix keeps the module boundary visible in the code and URLs.

| Route | Content |
|---|---|
| `/sli/customers` | Search by name, domain, phone or contact email. Filters: industry, sub-industry, lifecycle status, priority, owner, ISR owner, account rep, tags, call status, infra status. Saved views later (Zoho users rely on views such as "2026 Campaigns") |
| `/sli/customers/new` | Form with live duplicate check (§5) |
| `/sli/customers/[id]` | Header with classification badges (the equivalent of Zoho's tag strip). Tabs: **Overview** (company information, ownership), **Contacts** (current and past), **Notes**, **History** (changes and assignments). Leads and campaigns tabs arrive with S5–S6 |
| `/sli/contacts`, `/sli/contacts/[id]` | Contact search and detail: methods, consent, customer links over time, notes, history |
| `/sli/admin` | Departments and members, reference lists, tags (platform admins) |

Mobile-friendly layouts: ISRs may update call status from a phone.

## 9. Ember assistant and MCP (Stage 7)

- **Read tools** in the SLI module's registry (ADR-0002): `search_customers`, `get_customer_summary` (classification, ownership, current contacts, recent notes), `find_customer_duplicates`.
- **Drafts need acceptance:** Ember may draft a note or a contact update with `created_via = 'assistant'` and `awaiting_acceptance = true`, following the Ember-drafted requirements pattern. It never writes records directly.
- **Every call passes the sensitivity gate.** Customer and contact data enter the `ContextManifest` at their classification.
- **External MCP:** read-only `search_customers` and `get_customer_summary` in a separate SLI allowlist file, registered only when the module is on.

## 10. Zoho import (Stage 6)

- **Input:** CSV exports per Zoho module (Company, Contacts, and others if the migration decision includes them).
- **Dry run first:** a report of records to create, likely duplicates (§5), unmapped values for controlled lists, and rejected rows. Nothing is written until a lead approves the run.
- **Traceability:** every imported record gets an `sli_external_ids` row with its Zoho ID, so a later import can update instead of duplicating.
- **Owners:** Zoho owner names are matched to Ember accounts; unmatched names are reported, not guessed.
- **Not in the first import:** emails, attachments and the full timeline, unless the migration decision requires them.

## 11. Coexistence with Zoho

Until the migration decision is made, assume Zoho stays the system of record and SLI runs as a pilot on synthetic, then imported, data. Options for later:

1. **One-time cut-over:** import, freeze Zoho, switch.
2. **Parallel run:** periodic re-import by Zoho ID during the pilot, Zoho still authoritative.
3. **Read-through:** Ember reads Zoho through Zoho's API or its MCP server during the transition.

This is a Sandz decision (concept paper §11, "Which functions remain in external applications?").

## 12. Scope

### In scope

- Stages 1–5 as described.
- Behavioural RLS tests on PGlite for every row of the authorization table, following `src/lib/collaboration/database.test.ts`, plus migration-shape tests in the existing style.
- Change history on every customer, contact, link and assignment change.
- Seed data for lab: synthetic customers and contacts only.

### Out of scope

- Leads, opportunities and campaigns (S5), telemarketing activities (S5), handoff to Sales (S6, using the handoff mechanism from the Discovery design).
- Email and calendar sync, attachments.
- Bulk editing.
- Reports and dashboards beyond list counts.

## 13. Open questions for Sandz

1. **Tags:** what do "Staller", "Global-Sol. & Procurement", "With Lead", "Demand Gen" and "OpentoCloud" mean? Is the country tag the parent company's home country?
2. **Rankings:** what is the source of "Top 1000 Rank" (for example a published list of top corporations), and what is "BSP Rank"?
3. **Value lists:** the possible values of Company Status, Call Status and Infra Status.
4. **Roles:** how do Company Owner, ISR Owner and Account Rep differ in practice? Who may change each?
5. **Regions:** what does "Region 1 History" record? Does Sandz assign accounts by territory?
6. **Conglomerates:** should a group and its member companies be separate customers linked by parent, as proposed?
7. **Contacts:** do contacts move between companies often enough that history matters?
8. **Migration:** which Zoho modules and how much history to bring over? What happens to "Old Leads"?
9. **Coexistence:** cut-over, parallel run or read-through (§11)?
10. **Zoho AI:** are Zoho's Agents or MCP features in use today?
11. **Retention:** how long to keep contacts with no activity or consent?

## 14. Acceptance criteria

1. With `EMBER_SLI_ENABLED` off, no SLI route, navigation item, assistant tool or MCP tool is visible.
2. A Marketing or Sales member can create, search and update customers and contacts; a Presales viewer can only read.
3. Creating a customer with an existing domain is blocked; a similar name shows candidates; "create anyway" records a reason.
4. A lead can merge two customers; the merged record redirects, history is kept on both, nothing is deleted.
5. Ownership changes keep their history; the customer page shows current and past owners.
6. A restricted customer and its contacts are invisible to users without a grant, including in search, counts and Ember tools; admin access is logged.
7. Every change appears in the record's history with who, when and what.
8. Migrations apply cleanly on an empty lab stack; behavioural RLS tests cover every authorization rule; `npm run lint`, `npm run typecheck` and `npm test` pass.
9. The concept paper's acceptance test steps 1 ("register a prospective customer and contacts") and 9 ("unauthorized users cannot retrieve restricted records") pass for customers and contacts.
