# Ember Sandz — Discovery: Triggers, Decisions and Handoffs

*Ember Sandz: Solution Lifecycle Intelligence*

## Status

**S2 stages 1 and 2 built (29 October 2026); the rest proposed.** Built: the tenant and departments (ADR-0005), the SLI shell, and the Trigger registry with stages, history and archiving (`supabase/migrations/20261101100001_sli_organizations_and_departments.sql`, `20261101100002_sli_triggers.sql`, `src/app/(sli)/`, tests in `src/lib/sli/database.test.ts`). Next: the research workspace on Workstreams (stage 3) and the two Methods (stage 4).

Discovery becomes the **first stage** of Solution Lifecycle Intelligence (SLI), before Marketing. This document covers milestones **S2** (Discovery workspace and Triggers) and **S3** (management decisions, handoffs and send-backs). It follows [ADR-0002](architecture-decisions/ADR-0002-ember-sandz-as-a-domain-module.md): Discovery is part of the SLI module and is switched on with it.

The customer registry ([design](dev-request-sandz-sli-customer-and-contact-registry.md)) is mostly S4, but its **customer core** (customers, duplicate checks, rankings) moves into S3, because the handoff to Marketing is a list of **candidate customers** defined by the Discovery team (§7).

**Naming.** The module is presented as **Ember Sandz**, with **Solution Lifecycle Intelligence** as its byline. The assistant inside it is still called **Ember**. SLI may later be sold to other customers, so the product name, byline, departments, Trigger types and reference lists are instance configuration and data, not code (ADR-0002).

**Sandz's answers (26 October 2026)** are recorded in §12.

## Delivery stages

| Milestone | Stage | Requirements |
|---|---|---|
| S2 | 1. SLI shell: SLI users see SLI screens only | — |
| S2 | 2. Trigger registry and stage history | DISC-01 |
| S2 | 3. Research workspace per Trigger (built on Workstreams) | DISC-02, DISC-06 |
| S2 | 4. Concept and feasibility Methods and artifacts | DISC-03 |
| S3 | 5. Management review and recorded decisions | DISC-04 |
| S3 | 6. Handoffs: promote forward, return, send back | DISC-05 |
| S3 | 7. Candidate customers for the Marketing handoff, on the registry's customer core | DISC-05 |
| Later | Comparison and prioritisation; AI-assisted assessment; portfolio dashboard; lessons learned | DISC-07 to DISC-10 |

## 1. Purpose

Discovery is where Sandz decides **what is worth pursuing**. Marketing decides how to bring an approved solution to market.

Discovery is both the starting point of the lifecycle and a continuous function. Ideas can come from management, from any department, or from outside events.

```text
Discovery (Triggers) → Marketing → Sales & Presales → Project Delivery → Maintenance & Support
        ↑                                                                              │
        └──────────────────── send-backs and new Triggers (continuous learning) ───────┘
```

## 2. Vocabulary

| Term | Meaning |
|---|---|
| **Trigger** | Something that may justify a new or changed Sandz solution: a management idea, a market event, a customer problem, a technology development, a partner offering, an employee suggestion, or a lesson from a later stage |
| **Stage** | Where a Trigger is in Discovery (§4) |
| **Decision** | A recorded management outcome with its rationale and evidence (§6) |
| **Handoff** | Moving work between stages with a package of approved material. Three kinds: **promote** (forward), **return** (the receiver refuses a handoff before accepting it), **send back** (a later stage reopens earlier work after accepting it) (§7) |
| **Handoff package** | The selected, approved artifacts and claims passed to the next owner; never the whole research workspace |
| **Candidate customers** | The companies the Discovery team judges most likely to need an approved solution, with the reason for each. The core of every handoff to Marketing |

"Opportunity" is not used in Discovery. It stays free for Sales opportunities later.

## 3. What a user sees: the SLI shell

**Why.** Ember Core was built for builders and app developers. When Sandz staff tried it, its vocabulary and screens (Projects, Workstreams, Methods, Evals, Wiki administration) confused or overwhelmed them. Each audience should get a UI that fits its purpose and skills:

| Audience | UI |
|---|---|
| Builders and app developers (the Builders instance, ADR-0004) | Ember Core's existing UI |
| Discovery (management) and Marketing | **Purpose-built Ember Sandz screens**, in business language. Ember Core screens are never shown |
| Later SLI stages (Presales, Delivery, Maintenance) | May reuse Ember Core screens where they suit a technical audience (for example requirements and verification), decided per stage |

- On an instance with `EMBER_SLI_ENABLED`, users whose only access is through SLI departments get the **SLI shell**. Its navigation is SLI only: **Home** (my work), **Discovery**, and later **Customers**, **Marketing**, **Sales** and so on. This extends the existing role-directed shell in `src/components/Header.tsx`.
- **Ember's features are used underneath, presented in SLI terms.** A Trigger's research space *is* an Ember Workstream, but the user sees a "Research" tab on the Trigger, not a Workstream page. The assistant appears inside SLI pages, with the instance's branding.
- **Core routes are not linked** from the SLI shell. Opening one directly sends an SLI-only user back to SLI Home.
- **Platform admins and knowledge curators** keep the full Ember navigation for administration, knowledge curation and evaluations.

The shell itself applies to every SLI stage; what differs per stage is whether its screens are purpose-built or reused from Ember Core.

## 4. Trigger lifecycle

```text
New ──► Researching ──► Concept ──► Feasibility ──► Under review ──► Approved ──► Targeting ──► Promoted
 │           ▲              ▲             ▲              │                                         │
 │           └──────────────┴─────────────┴── Revise ────┤                                         │
 │                                                       ├──► Deferred (shelved)                   │
 └──► Declined (not worth researching)                   └──► Rejected                             │
             ▲                                                                                     │
             └──────────────────────────── send back (§7) ─────────────────────────────────────────┘

Deferred ──► revisit any time ──► Researching / Concept / Feasibility
Any Trigger ──► Archive (hidden from active lists) ◄──► Unarchive
```

- **New:** raised and visible to the Discovery team. A sponsor accepts it into research, or declines it with a reason.
- **Researching, Concept, Feasibility:** work happens in the research workspace (§5). Each stage's output is an artifact: research notes and candidate concepts, a concept paper, a feasibility assessment.
- **Under review:** the sponsor submits the Trigger for a management decision, with the evidence.
- **Decision outcomes** (§6): *Approve* (with a destination, for example "prototype first"), *Revise* (back to a named earlier stage), *Defer* (shelved, with no review date), *Reject*.
- **Deferred:** shelved. There is no review date; a Discovery team member can **revisit** it at any time, moving it back to Researching, Concept or Feasibility with a reason. It then needs a new decision.
- **Targeting:** after a *Go*, the Discovery team chooses the market segments and builds the **candidate customer list** in rounds: existing customers first, then companies related to customers (for example through a conglomerate), then new prospects (§7). A Trigger approved for a destination that needs no candidates (for example an Engineering prototype) skips Targeting.
- **Promoted:** a handoff has been accepted by the destination owner (§7).
- **Archive:** any Trigger, at any stage, can be archived with one button. Archived Triggers disappear from the Discovery board and active lists but stay searchable, keep their history, and can be unarchived. Archiving is separate from the stage: an archived Deferred Trigger is still Deferred when unarchived. A Trigger with an open handoff or send-back cannot be archived until that is settled.
- **Reopened:** a send-back moves a promoted or approved Trigger back to an earlier stage. The earlier decision is marked superseded, never deleted.

Every stage change is recorded in an append-only history (who, when, from, to, reason). Stage changes go through one database function that checks the allowed transitions. Clients never set the stage directly, following Ember's existing pattern for Project status.

## 5. Research workspace (built on Ember)

| Need | Ember feature used underneath |
|---|---|
| A private space per Trigger | One **Discovery Project** per instance (confidential, management and appointed analysts). Each Trigger gets its own **Workstream** in it |
| Research and brainstorming | The assistant in the Trigger's Research tab, Tavily web search (ADR-0002, "Web search"), source uploads to the Workstream's own knowledge base, working knowledge notes |
| Concept and feasibility work | Two published **Methods** written for Sandz: *Concept development* and *Feasibility assessment*. Starting a Trigger's concept stage instantiates the Method in its Workstream |
| Outputs | **Workstream artifacts**: research dossier, concept paper, feasibility assessment, presentation |
| Using Sandz knowledge | Enterprise, market and technical knowledge bases attached read-only to the Discovery Project (shared, not copied) |
| Keeping speculation contained | Project privacy, evidence access groups and the sensitivity gate. The Discovery Project is **confidential**, so financial assumptions go only to AI providers approved for confidential data |
| Contributors outside management | Added to a single Trigger through an evidence access group, without seeing other Triggers |

### Fit check

The first question for any Trigger is whether it suits Sandz. In the Research tab, the sponsor asks Ember for a **fit check**. Ember answers from Sandz's own knowledge (Enterprise Solutions: partner products, capabilities, past Triggers) and from the web through Tavily (market, regulation, competitors, news), under five headings:

| Heading | Question | Typical sources |
|---|---|---|
| Strategic fit | Does it match Sandz's direction and partners? | Enterprise Solutions knowledge, past decisions |
| Capability fit | Can Sandz and its partners deliver it today? What is missing? | Partner product knowledge, Presales and Engineering input |
| Market attractiveness | How many companies are affected in the Philippines, and how urgently? | Tavily: news, industry publications, BSP data |
| Competition | Who else is offering this, and how is Sandz different? | Tavily, partner material |
| Risks and unknowns | Technical, commercial and delivery risks; what Ember could not find | All of the above |

Every point shows its source, and Ember lists what it could not find. The fit check is saved as a note on the Trigger and refreshed as research continues. Web results are leads, not facts, until the team saves them with their sources.

### Brainstorming with other departments

The sponsor can add people from other departments to one Trigger, for example Presales and Engineering to check technical fit. They join the Research tab for that Trigger only, contribute notes and documents, and see no other Triggers (§9).

**Discovery does not get its own large knowledge base.** Each Trigger's evidence lives in its Workstream. Findings become reusable knowledge only after approval, through Ember's source submission and curator review.

## 6. Management review and decisions (S3)

- **Review:** the sponsor submits the Trigger with its evidence (concept paper, feasibility assessment, key sources). The review can use Ember's **presentation** flow (slides generated from the Workstream, comments, revision).
- **Who contributes:** the Country Manager, the CTO and the Head of Engineering research, develop and assess Triggers, and each records a **recommendation** (approve, revise, defer or reject, with comments) before the decision.
- **Who decides:** the **Managing Director** makes the final decision, as holder of the `discovery_decision` authority (Ember's approval policies and authority assignments: `project_approval_policies`, `holds_project_authority()`). The authority is configuration, so another organisation could name a committee instead. Because the MD is the sole authority, the policy allows the MD to decide Triggers they sponsored; the contributors' recommendations are recorded alongside the decision.
- **Delegate:** when the MD is unavailable, the **Country Manager** decides as delegate. The delegation is a dated authority assignment (from and to dates), so each decision records whether it was made by the MD or by the delegate, and the Country Manager's own recommendation on that Trigger stays visible. The delegate cannot decide a Trigger they sponsor; it waits for the MD.
- **What is recorded:** outcome, rationale, conditions (for example "prototype must reach 95% detection accuracy"), the evidence relied on, the destination if approved, and who decided under which authority.
- **Revisions do not overwrite:** a new decision supersedes the previous one, and both stay visible.

## 7. Handoffs: forward, return and send back

Promotions happen at several points in the lifecycle: Discovery to Marketing, Marketing to Sales, Sales to Delivery and so on. **One handoff mechanism serves all of them**, so going back works the same way everywhere.

### Promote (forward)

1. After an *Approve* decision, the sponsor proposes a handoff to a destination: **Marketing** (campaign or market validation), **Presales** (solution design, systems integration proof of concept, product and partner sourcing; Sandz's engineering and procurement sit here), **Engineering** (an app prototype, led by the Head of Engineering; later, devices such as IoT sensors), **Sales** (a customer-specific pursuit), or **Project Delivery** (implementation, or an approved internal initiative). Destinations are configurable departments.
2. The handoff names the destination owner and attaches a **package**: selected approved artifacts, approved claims, target industries, conditions from the decision. Package artifacts are **copied** into the destination, as Ember's Workstream promotion already does, so the confidential Discovery workspace is never exposed.
3. The destination department lead **accepts** it. Acceptance creates the destination record or Workstream, links it to the Trigger, and moves the Trigger to *Promoted*.

Until the Marketing and Sales modules exist, the destination is a new Workstream in the destination department's SLI workspace.

### Candidate customers: the handoff to Marketing

A handoff to Marketing is **the list of candidate customers defined by the Discovery team**, with the approved material Marketing needs to approach them. Discovery decides *who* the solution is for; Marketing decides *how* to reach them.

- **Building the list.** During **Targeting** (after the MD's *Go*), the Discovery team builds the list in rounds, trimming as it goes: **existing customers** first (ordered by how well the solution fits what they already run, from their technology profile in the registry), then **related companies** (members of the same group as a customer, found through conglomerate links), then **new prospects** found through research. Ember may suggest candidates earlier, during research, but the list is settled in Targeting. The Discovery team adds candidate customers to the Trigger. Each has a **fit rationale** (why this company), a priority, the target industry and sub-industry, any known contacts or relationships, and the evidence used. Rankings such as Top 1000 and BSP, which the Discovery team maintains (registry design §4), help choose and order them. Ember can suggest candidates from the registry, attached knowledge and Tavily research, as drafts the team accepts.
- **Existing or new companies.** A candidate is either an existing registry customer or a new prospect. New prospects go through the registry's duplicate check (registry design §5) before they are added, so the list never creates a second record for a company Sandz already knows.
- **What Marketing receives.** The candidate list (a snapshot at handoff, with each customer linked to the registry), plus the value proposition, target industries, validated capabilities, approved claims and campaign recommendations. When the Marketing module exists (S5), accepting the handoff creates the campaign's target list from the candidates.
- **Marketing can push back.** If the list is too thin, poorly targeted or missing contacts, Marketing **returns** the handoff with a reason, and the Discovery team revises the list.
- **Confidentiality.** Marketing sees the candidates and their fit rationale, but not the Discovery research, financial assumptions or decision deliberations behind them.

Handoffs to Presales, Sales or Delivery may also carry candidate customers (for example a specific customer for a proof of concept), but for them it is optional.

### Return (before acceptance)

The destination owner can **return** a proposed handoff instead of accepting it, with a reason, for example "value proposition not specific enough to market". The Trigger stays *Approved*, and the sponsor revises the package or seeks a new decision.

### Send back (after acceptance)

A later stage can find that the solution is not adequate. This is the "go back" case.

1. The current owner (for example Engineering, building a prototype app) raises a **send-back** to an earlier stage. It includes a reason category (*solution inadequate*, *insufficient evidence*, *market changed*, *customer feedback*, *cost or risk higher than assessed*), the evidence (test results, customer feedback), and the stage it proposes to return to.
2. The Trigger's sponsor, or a decision authority, accepts the send-back. The Trigger moves back to the agreed stage (*Researching*, *Concept* or *Feasibility*) and the previous decision is marked **superseded**.
3. The downstream work is **paused or closed**, as the send-back states. Nothing is deleted. The destination record keeps its link and history.
4. The Trigger goes through review again and gets a new decision, which may promote it to the same or a different destination.

Send-backs and their reasons are counted. They feed lessons learned (DISC-10) and show where Discovery's feasibility checks need strengthening.

**When a send-back is not the right tool:** a problem found later that doesn't change the original solution (for example a different customer need) becomes a **new Trigger**, linked to the original as its source.

## 8. Data model (indicative)

All tables are prefixed `sli_`, with RLS on and `select apply_oauth_read_only_policies();` at the end of each migration.

| Table | Key columns |
|---|---|
| `sli_triggers` | `id`, `code` (`TRG-nnn`), `title`, `trigger_type` (`management_idea`/`market_event`/`customer_problem`/`technology`/`partner_offering`/`employee_suggestion`/`downstream_lesson`), `source_department_id`, `raised_by`, `sponsor_id`, `summary`, `event_date`, `event_reference` (link or source for market events), `strategic_objective`, `stage`, `priority`, `information_sensitivity` (default `confidential`), `workstream_id`, `source_trigger_id` (for Triggers raised from another), audit columns, `archived_at`, `archived_by`, `archive_reason` |
| `sli_trigger_stage_history` | Append-only: `trigger_id`, `from_stage`, `to_stage`, `reason`, `changed_by`, `changed_at`, related `decision_id` or `handoff_id` |
| `sli_trigger_links` | `trigger_id`, `link_type` (`industry`/`customer`/`partner`/`related_trigger`), reference |
| `sli_decisions` | `id`, `trigger_id`, `share_rationale_with_raiser`, `outcome` (`approve`/`revise`/`defer`/`reject`), `destination` (if approve), `return_to_stage` (if revise), `rationale`, `conditions`, `decided_by`, `authority_type`, `decided_as` (`authority`/`delegate`), `decided_at`, `supersedes_id`, `superseded_by_id`, `superseded_reason` |
| `sli_decision_evidence` | `decision_id`, artifact or source reference |
| `sli_recommendations` | `trigger_id`, `recommended_by`, `recommendation` (`approve`/`revise`/`defer`/`reject`), `destination` (if approve), `comments`, `recorded_at`; the latest per person counts, earlier ones stay in history |
| `sli_handoffs` | `id`, `trigger_id`, `kind` (`promote`/`send_back`), `from_stage`, `to_stage` or `destination`, `destination_owner_id`, `destination_workstream_id`, `status` (`proposed`/`accepted`/`returned`/`withdrawn`), `reason_category` and `reason` (send-backs and returns), `downstream_action` (`pause`/`close`, send-backs), `proposed_by`, `decided_by`, `decided_at`, `previous_handoff_id` |
| `sli_trigger_candidate_customers` | `trigger_id`, `customer_id` (registry customer), `tier` (`existing_customer`/`related_company`/`new_prospect`), `relationship_path` (for example "sister company of a Zadara storage customer in the same group"), `solution_fit` (`strong`/`partial`/`poor`/`unknown`), `trimmed_reason` (when removed), `fit_rationale`, `priority`, `target_industry`, `target_sub_industry`, `known_relationships`, `evidence_reference`, `status` (`proposed`/`accepted`/`removed`), `added_by`, `created_via` (`manual`/`assistant`), `accepted_by`, audit columns |
| `sli_handoff_package_items` | `handoff_id`, artifact reference, copied artifact reference, `item_type` (`artifact`/`claim`/`condition`/`target_industry`/`candidate_customer`) |

Writes go through `SECURITY DEFINER` functions (`sli_transition_trigger()`, `sli_record_decision()`, `sli_propose_handoff()`, `sli_decide_handoff()`). Each checks the caller's authority and the allowed transitions, and writes history in the same transaction.

The same `sli_handoffs` table is reused, with other subject types, for the Marketing → Sales handoff in S6.

## 9. Permissions

| Action | Who |
|---|---|
| Raise a Trigger | Any active member of any SLI department (a short form: title, type, summary, evidence) |
| See your own submitted Triggers, their stage and outcome | The person who raised them, always |
| See other people's Triggers (title, type, stage, outcome) | Configurable per instance (`trigger_visibility`: `own` or `all_members`). Sandz: **all SLI members**. Research, financial assumptions and decision rationale stay with the Discovery team unless the MD shares the rationale with the raiser |
| See all Triggers and their research | Discovery team: the Managing Director, Country Manager, CTO and Head of Engineering (members of the Discovery Project), plus anyone they appoint |
| Record a recommendation | Discovery team members other than the decision authority |
| Contribute to one Trigger | People added to that Trigger's access group |
| Accept or decline a new Trigger; sponsor its research | Discovery team members with the sponsor role |
| Revisit a Deferred Trigger; archive or unarchive a Trigger | Discovery team members |
| Submit for review; propose a handoff | The Trigger's sponsor |
| Decide | Holder of the `discovery_decision` authority: the Managing Director, or the Country Manager as dated delegate |
| Add, accept or remove candidate customers | Discovery team members |
| Accept or return a handoff | The destination department's lead |
| Raise a send-back | The current owner of the downstream work |
| Accept a send-back | The Trigger's sponsor or a decision authority |

Platform admins keep their bypass in the helpers, with access to confidential Triggers logged.

## 10. Worked example: VMware licensing changes

*Illustrative. Customer names are fictional.* An interactive simulation of this flow accompanies this design.

1. **Trigger (market event):** after Broadcom's acquisition of VMware, VMware licensing moved to subscription bundles and many customers face much higher renewal costs. The Head of Engineering raises **TRG-014 "VMware licensing changes: migration opportunity"** with a link to the announcements. The CTO takes it on as sponsor.
2. **Fit check:** Ember combines Sandz's knowledge (Zadara storage and compute, existing partners) with Tavily research (cost complaints, migration interest in the Philippines, competing offers such as other hypervisors and hyperscalers). Verdict: strong strategic and market fit; capability fit to confirm, because some customers use VMware features that may have no direct equivalent.
3. **Brainstorming:** Presales and Engineering are added to the Trigger. They list the VMware features customers depend on (high availability, live migration, distributed switching, backup and disaster recovery integrations) and compare them with Zadara compute. Notes are saved, partner documents uploaded.
4. **Concept and feasibility:** a concept paper, "Exit VMware to Zadara" (assessment, migration and managed service tiers), and a feasibility assessment (migration path, feature gaps, Zadara capacity, pricing against typical VMware renewals).
5. **Recommendations and decision:** the Country Manager, CTO and Head of Engineering recommend *Go*. The MD approves with destination **Marketing** and a condition: start with existing Zadara storage customers.
6. **Targeting, round 1: existing customers.** Ember lists registry customers whose technology profile shows Zadara storage and VMware in use (14). Presales reviews each customer's VMware footprint: 8 are a strong fit, 3 partial (features with no equivalent yet), 3 poor (renewal just signed or heavy dependence on unsupported features). The list is trimmed to the 8, with reasons recorded for the rest.
7. **Targeting, round 2: related companies.** Ember follows conglomerate links: a group whose parent is not yet a Sandz customer, but whose logistics subsidiary uses Zadara storage. Its sister companies are added as warm prospects, with the relationship recorded (5 added, 2 trimmed).
8. **Targeting, round 3: new prospects.** Ember searches with Tavily for Philippine companies likely to be running VMware in the target industries, ranked with the Top 1000 list. Each is checked against the registry for duplicates. The team keeps 10 with the clearest fit.
9. **Promote to Marketing:** 23 candidates in three tiers, each with a fit rationale, plus the value proposition, approved claims, and a campaign recommendation (VMware cost assessment offer; Tier 1 first). Marketing accepts.
10. **Continuous learning:** campaign responses show several prospects also want disaster recovery. That becomes a **new Trigger**, linked to TRG-014.

## 10b. Second worked example: AI warehouse monitoring (send-back)

*Illustrative.*

1. **Trigger (management idea):** "AI-powered warehouse monitoring using Zadara GPU infrastructure." Sponsor: Sandz management. Objective: expand the AI solutions business. Industries: warehousing, logistics.
2. **Researching:** the team uses the assistant and web search on computer-vision vendors and warehouse safety needs, uploads partner material, and records candidate concepts.
3. **Concept:** the *Concept development* Method produces a concept paper: solution, target market, business model, partners, dependencies.
4. **Feasibility:** the *Feasibility assessment* Method produces technical, commercial, cost and risk findings, including GPU capacity on Zadara.
5. **Recommendations and decision:** the Country Manager, CTO and Head of Engineering record recommendations. The MD decides: *Approve* with destination **Engineering**: "limited technical prototype before marketing launch", with a condition on detection accuracy.
6. **Promote:** Engineering accepts the handoff. A prototype Workstream is created with the copied package. Presales is consulted on the camera and GPU hardware from Sandz's partners.
7. **Send back:** the prototype misses the accuracy condition at the lighting levels found in real warehouses. Engineering sends back to *Feasibility* with test results, reason *solution inadequate*, downstream action *pause*. The sponsor accepts, and the first decision is superseded.
8. **Revise and decide again:** feasibility is updated (different camera placement, a better model). New decision by the MD: *Approve*, Engineering again. The second prototype meets the condition.
9. **Promote to Marketing:** the Discovery team has built a list of candidate customers (for example 15 logistics operators and warehouse owners, ordered by Top 1000 rank, each with a fit rationale). Marketing receives that list with the value proposition, target industries, validated capabilities, approved claims, demonstrations and campaign recommendations. The original research, both decisions and the send-back stay linked to the Trigger for traceability.

## 11. Scope

### In scope (S2–S3)

- SLI shell (§3); Trigger registry, lifecycle and history; research workspace on Workstreams; two Methods; decisions; promote, return and send back; permissions as in §9.
- Behavioural RLS tests on PGlite for every permission rule and every allowed and refused transition.

### Out of scope (for now)

- Comparison and prioritisation, AI-assisted assessment, the portfolio dashboard, lessons-learned patterns (DISC-07 to DISC-10).
- Marketing, Sales and Delivery records as destinations. Until those modules exist, destinations are Workstreams.
- Notifications beyond Ember's existing Project notes.

## 12. Open questions for Sandz

**Answered (26 October 2026):**

| Question | Answer |
|---|---|
| Who is on the Discovery team? | Management: the Managing Director, the Country Manager, the CTO and the Head of Engineering |
| Who decides? | The **Managing Director** makes the final decision. The other three contribute to research, concept and feasibility and record recommendations |
| Engineering as a destination? | Yes: **Engineering** is a department led by the Head of Engineering, for app prototypes (later possibly IoT devices). Sandz's work is mainly systems integration, so solution design and proofs of concept go to **Presales** and implementation to **Delivery** |
| Prototypes? | Today only the apps built by the Head of Engineering, so app prototypes go to **Engineering**, led by the Head of Engineering. Devices such as IoT sensors may follow |
| Can other employees see Triggers? | Configurable. For Sandz, yes: all SLI members see Triggers' titles, stages and outcomes, and the person who raised one always sees it |
| Previous initiatives? | Not in SLI yet; they can be entered as Triggers later |
| Who decides when the MD is unavailable? | The **Country Manager**, as the MD's delegate |
| Review dates for deferred Triggers? | None. Deferred Triggers are shelved and can be revisited at any time. An **Archive** button hides any Trigger from active lists without deleting it |
| Procurement? | Part of **Presales**, because procurement knows the partner products Sandz sells |
| Assistant name? | Still **Ember** |
| Module name? | **Ember Sandz**, with **Solution Lifecycle Intelligence** as the byline. SLI may be sold to other customers later |

All Discovery questions are answered. The customer registry's open questions wait for the Marketing team ([registry design](dev-request-sandz-sli-customer-and-contact-registry.md) §13).

## 13. Acceptance criteria

1. An SLI-only user sees only SLI navigation. Opening an Ember Core route directly returns them to SLI Home.
2. Any SLI department member can raise a Trigger and follow its stage. They cannot see other Triggers' research unless added.
3. A sponsor moves a Trigger through Researching, Concept and Feasibility, with history recorded. An illegal transition is refused by the database.
4. The two Methods produce a concept paper and a feasibility assessment as artifacts on the Trigger.
5. A decision authority records approve, revise, defer and reject outcomes with rationale and evidence. A sponsor cannot decide their own Trigger unless the policy allows it.
6. An approved Trigger is promoted. The destination lead accepts, and a destination Workstream is created with copied package artifacts. The Discovery workspace stays inaccessible to the destination team.
7. A handoff to Marketing cannot be proposed without at least one accepted candidate customer. Every candidate is a registry customer (no duplicates created), with a fit rationale. Marketing sees the candidates and rationale but not the Discovery research.
8. Candidate lists are built in the Targeting stage, in tiers (existing customers, related companies, new prospects). Existing customers can be found from their technology profile, related companies from group links, and trimmed candidates keep their reason.
9. A destination lead can return a proposed handoff with a reason.
10. A downstream owner can send back. The Trigger reopens at the agreed stage, the earlier decision shows as superseded, the downstream work is paused or closed, and nothing is deleted.
11. A Deferred Trigger can be revisited at any time and moved back to an earlier stage. Any Trigger can be archived and unarchived; archived Triggers leave active lists but remain searchable with their history.
12. The worked examples (§10 and §10b) runs end to end on lab with synthetic data.
13. With `EMBER_SLI_ENABLED` off, none of this is visible.
